"""Real-time protocol regression tests; all provider traffic is mocked."""
import asyncio
import gzip
import hashlib
import json
import os
import ssl
import struct
import time
from uuid import uuid4

os.environ["LOCAL_DEV"] = "true"

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import Base
from app.models.db_models import Token, User, WorkspaceInterview
from app.routers import audio
from app.services.llm_service import LLMService
from app.services import llm_service as llm_module
from app.services import stt_streaming as stt_module
from app.services.stt_streaming import ASRProtocolError, ASRResponse, StreamingASRSession, parse_server_frame


def frame(payload, flags=1, compressed=True, error=None):
    body = json.dumps(payload).encode()
    if compressed:
        body = gzip.compress(body)
    result = bytes((0x11, (0xF0 if error is not None else 0x90) | flags, 0x10 | int(compressed), 0))
    if error is not None:
        result += struct.pack('>I', error)
    elif flags & 1:
        result += struct.pack('>i', -3 if flags & 2 else 3)
    return result + struct.pack('>I', len(body)) + body


def test_protocol_gzip_sequence_final_and_error():
    payload = {"result": {"text": "为什么用 Redis？"}}
    decoded = parse_server_frame(frame(payload, flags=3))
    assert decoded.payload == payload and decoded.is_last and decoded.sequence == -3
    assert parse_server_frame(frame(payload, flags=0, compressed=False)).sequence is None
    error = parse_server_frame(frame({"message": "bad format"}, flags=0, compressed=False, error=45000151))
    assert error.error_code == 45000151 and "result" not in error.payload
    with pytest.raises(ASRProtocolError):
        parse_server_frame(frame(payload)[:-1])


@pytest.mark.parametrize("question, expected", [
    ("解释一下 Node.js 的事件循环", "zh"),
    ("請解釋快取與資料一致性", "zh"),
    ("Explain the Node.js event loop", "en"),
])
def test_auto_language_follows_selected_question(question, expected):
    normalized = audio.normalize_query({"request_id": "auto-language", "question_text": question, "language": "auto"})
    assert normalized["language"] == expected
    assert normalized["question_text"] == question
    messages = llm_module.build_messages(question, None, normalized["language"])
    assert f"用{'中文' if expected == 'zh' else 'English'}回答" in messages[0]["content"]


@pytest.mark.parametrize("language", ["de", "AUTO", "", None, 1])
def test_invalid_answer_language_is_rejected(language):
    with pytest.raises(audio.ProtocolError, match="invalid language"):
        audio.normalize_query({"question_text": "有效问题", "language": language})


@pytest.mark.asyncio
async def test_utterance_revisions_replace_not_append():
    queue = asyncio.Queue()
    session = StreamingASRSession("test", "system", queue)
    def response(text, final=False, start=100, end=700):
        return ASRResponse({"result": {"utterances": [{"text": text, "start_time": start,
                             "end_time": end, "definite": final}]}})
    await session._consume(response("闭包是"))
    first = await queue.get()
    await session._consume(response("闭包是什么？", start=110, end=1200))
    second = await queue.get()
    assert first["utterance_id"] == second["utterance_id"]
    assert second["revision"] == 2 and second["text"] == "闭包是什么？" and not second["is_final"]
    await session._consume(response("闭包是什么？", True, start=110, end=1200))
    final = await queue.get()
    assert final["utterance_id"] == first["utterance_id"] and final["revision"] == 3
    assert final["provider_final"] and final["is_final"]
    await session._consume(response("闭包是什么？", True, start=110, end=1200))
    assert queue.empty()
    assert list(session._all_text.values()) == ["闭包是什么？"]


class Recorder:
    def __init__(self):
        self.events = []
        self.first = asyncio.Event()
    async def send_json(self, event):
        self.events.append(event)
        self.first.set()


@pytest.mark.asyncio
async def test_transcription_queues_are_isolated():
    a, b = Recorder(), Recorder()
    qa, qb = asyncio.Queue(), asyncio.Queue()
    tasks = [asyncio.create_task(audio._transcription_sender(a, qa)),
             asyncio.create_task(audio._transcription_sender(b, qb))]
    await qa.put({"type": "transcription", "text": "用户一问题", "source": "system"})
    await qb.put({"type": "transcription", "text": "用户二问题", "source": "mic"})
    await asyncio.wait_for(asyncio.gather(qa.join(), qb.join()), 2)
    assert a.events[0]["text"] == "用户一问题" and b.events[0]["text"] == "用户二问题"
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


@pytest.mark.asyncio
async def test_llm_wire_thinking_disabled_context_and_truncation(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-only")
    captured = {}
    def transport(request):
        captured.update(json.loads(request.content))
        return httpx.Response(200, headers={"Content-Type": "text/event-stream"}, content=(
            'data: {"choices":[{"delta":{"content":"核心结论"},"finish_reason":null}]}\n\n'
            'data: {"choices":[{"delta":{"content":"。"},"finish_reason":"length"}]}\n\n'))
    service = LLMService()
    service._client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    recorder = Recorder()
    await audio._llm_single(recorder, "为什么？", "zh", "javascript", service, {}, "q1",
                            context={"resume_text": "做过组件库", "answer_length": "short"},
                            source_message_ids=["m1"], source_revisions=[4], context_version=2)
    assert captured["thinking"] == {"type": "disabled"}
    assert "做过组件库" in captured["messages"][1]["content"]
    assert captured["max_tokens"] == 1800
    assert [x["delta"] for x in recorder.events[:-1]] == ["核心结论", "。"]
    done = recorder.events[-1]
    assert done["full_answer"] == "核心结论。" and done["status"] == "truncated"
    assert done["source_refs"] == [{"message_id": "m1", "revision": 4}]
    assert all(x["request_id"] == "q1" for x in recorder.events)
    await service.close()


@pytest.mark.parametrize("style", ["conversational", "structured", "written"])
@pytest.mark.parametrize("length", ["brief", "standard", "detailed"])
def test_answer_format_and_output_budget_are_consistent(style, length):
    context = {"answer_style": style, "answer_length": length, "resume_text": "负责订单系统，不提供虚构指标"}
    prompt, background = llm_module.build_messages("如何保证订单幂等？", "java", "zh", context)
    assert json.loads(background["content"])["context"]["resume_text"] == context["resume_text"]
    assert "简历或项目里没有的事实不要编造" in prompt["content"]
    if style == "written":
        assert "标准书面回答" in prompt["content"] and "实现步骤" in prompt["content"]
        assert "控制在约 150 字" not in prompt["content"]
        assert "控制在约 300 字" not in prompt["content"]
        assert llm_module.answer_token_budget(context) == 6500
        assert "可进一步补充" in prompt["content"]
    else:
        assert "标准书面回答" not in prompt["content"]
        assert llm_module.answer_token_budget(context) == {"conversational": 1800, "structured": 2400}[style]


@pytest.mark.parametrize("style", ["conversational", "structured", "written"])
def test_mode_depth_cannot_be_silently_shortened_by_old_preferences(style):
    # Installed clients and historical sessions can still send a hidden brief value.
    prompts = [llm_module.build_messages("解释缓存一致性", None, "zh", {
        "answer_style": style, "answer_length": length}) for length in [None, "brief", "standard", "detailed"]]
    assert all(messages == prompts[0] for messages in prompts)
    assert "answer_length" not in json.loads(prompts[0][1]["content"])["context"]
    assert "不只列追问标题" in prompts[0][0]["content"]
    assert "假设例子要明确标注" in prompts[0][0]["content"]


@pytest.mark.parametrize("style", ["conversational", "structured", "written"])
@pytest.mark.parametrize("language", ["zh", "en"])
def test_code_examples_include_candidate_explanation_rules(style, language):
    prompt = llm_module.build_messages("实现 LRU 缓存并解释", "backend", language,
                                       {"answer_style": style})[0]["content"]
    assert "在关键步骤旁写有解释价值的注释" in prompt
    assert "解释为什么这样写、数据如何流转" in prompt
    assert "该编程语言合法的注释语法" in prompt
    assert "JSON 等不支持注释的格式保持合法" in prompt
    assert "注释必须符合当前语言和实现的实际语义" in prompt
    assert "不重复所有注释，不输出内部思考过程" in prompt


def test_written_english_and_legacy_preferences():
    prompt = llm_module.build_messages("Explain idempotency", None, "en", {
        "answer_style": "标准书面", "answer_length": "balanced"})[0]["content"]
    assert "1400～1800 个英文单词" in prompt
    assert llm_module.answer_token_budget({"answer_length": "short"}) == 1800
    assert llm_module.answer_preferences({"answer_style": "untrusted instructions"}) == ("conversational", "standard")


@pytest.mark.asyncio
async def test_written_answer_streams_before_completion_with_larger_budget(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-only")
    gate = asyncio.Event()
    captured = {}

    class ProviderStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield 'data: {"choices":[{"delta":{"content":"先给核心结论。"},"finish_reason":null}]}\n\n'.encode()
            await gate.wait()
            yield 'data: {"choices":[{"delta":{"content":"然后解释原理、步骤与例子。"},"finish_reason":"stop"}]}\n\n'.encode()

    def transport(request):
        captured.update(json.loads(request.content))
        return httpx.Response(200, headers={"Content-Type": "text/event-stream"}, stream=ProviderStream())

    service = LLMService()
    service._client = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    recorder = Recorder()
    task = asyncio.create_task(audio._llm_single(recorder, "如何保证订单幂等？", "zh", None, service, {}, "written",
        context={"answer_style": "written", "answer_length": "detailed"}))
    try:
        await asyncio.wait_for(recorder.first.wait(), 1)
        assert not task.done()
        assert recorder.events[0]["delta"] == "先给核心结论。"
        assert captured["max_tokens"] == 6500
        assert captured["stream"] is True and captured["thinking"] == {"type": "disabled"}
        gate.set()
        await asyncio.wait_for(task, 1)
        assert recorder.events[-1]["status"] == "completed"
        assert recorder.events[-1]["full_answer"] == "先给核心结论。然后解释原理、步骤与例子。"
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await service.close()


@pytest.mark.asyncio
async def test_llm_cancel_preserves_partial_and_request_id():
    gate = asyncio.Event()
    closed = asyncio.Event()
    class SlowLLM:
        async def stream_answer(self, *args, **kwargs):
            try:
                yield "已收到", False
                await gate.wait()
            finally:
                closed.set()
    recorder = Recorder()
    task = asyncio.create_task(audio._llm_single(recorder, "问题", "zh", "javascript", SlowLLM(), {}, "old"))
    await recorder.first.wait()
    task.cancel()
    await task
    assert closed.is_set()
    assert recorder.events[-1]["status"] == "cancelled"
    assert recorder.events[-1]["request_id"] == "old"
    assert recorder.events[-1]["full_answer"] == "已收到"


@pytest.mark.asyncio
async def test_llm_failure_keeps_prior_text():
    class BrokenLLM:
        async def stream_answer(self, *args, **kwargs):
            yield "第一部分", False
            raise RuntimeError("连接中断")
    recorder = Recorder()
    await audio._llm_single(recorder, "问题", "zh", "javascript", BrokenLLM(), {}, "broken")
    assert recorder.events[-1]["status"] == "failed"
    assert recorder.events[-1]["full_answer"] == "第一部分"


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["before_first", "after_first", "total_limit", "slow_consumer"])
async def test_llm_content_deadlines_ignore_keepalives_and_preserve_partial(monkeypatch, mode):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-only")
    monkeypatch.setattr(llm_module, "FIRST_CONTENT_TIMEOUT", 0.03 if mode == "before_first" else 0.5)
    monkeypatch.setattr(llm_module, "CONTENT_IDLE_TIMEOUT", 0.03 if mode in ("after_first", "slow_consumer") else 0.5)
    monkeypatch.setattr(llm_module, "TOTAL_ANSWER_TIMEOUT", 0.03 if mode == "total_limit" else 0.5)

    class KeepAliveStream(httpx.AsyncByteStream):
        closed = False
        packets = 0

        async def __aiter__(self):
            if mode != "before_first":
                yield b'data: {"choices":[{"delta":{"content":"usable answer"}}]}\n\n'
            while True:
                await asyncio.sleep(0.005)
                self.packets += 1
                if mode == "total_limit":
                    yield b'data: {"choices":[{"delta":{"content":" more"}}]}\n\n'
                else:
                    yield b': keepalive\n\ndata: {"choices":[{"delta":{}}]}\n\n'

        async def aclose(self):
            self.closed = True

    incoming = KeepAliveStream()
    service = LLMService()
    service._client = httpx.AsyncClient(transport=httpx.MockTransport(
        lambda _: httpx.Response(200, stream=incoming, headers={"Content-Type": "text/event-stream"})))
    class SlowRecorder(Recorder):
        async def send_json(self, event):
            await super().send_json(event)
            if mode == "slow_consumer" and event["type"] == "llm_chunk":
                await asyncio.sleep(0.06)

    recorder = SlowRecorder()
    await asyncio.wait_for(audio._llm_single(recorder, "question", "zh", None, service, {}, mode), 1)
    done = recorder.events[-1]
    assert done["status"] == "failed" and "超时" in done["error"]
    assert done["request_id"] == mode and incoming.closed
    if mode != "slow_consumer":
        assert incoming.packets > 0
    if mode == "before_first":
        assert done["full_answer"] == ""
    else:
        assert done["full_answer"].startswith("usable answer")
    assert not any(event.get("status") == "completed" for event in recorder.events)
    await service.close()


class SocketHarness:
    def __init__(self, app, token=None):
        self.inbound, self.outbound = asyncio.Queue(), asyncio.Queue()
        headers = [(b'authorization', f'Bearer {token}'.encode())] if token else []
        scope = {"type": "websocket", "asgi": {"version": "3.0"}, "scheme": "ws",
                 "path": "/api/ws/audio/stream", "raw_path": b"/api/ws/audio/stream",
                 "query_string": b"", "headers": headers, "client": ("test", 1),
                 "server": ("test", 80), "subprotocols": [], "root_path": ""}
        self.inbound.put_nowait({"type": "websocket.connect"})
        self.task = asyncio.create_task(app(scope, self.inbound.get, self.outbound.put))
    async def start(self):
        assert (await self.outbound.get())["type"] == "websocket.accept"
    async def send(self, payload):
        await self.inbound.put({"type": "websocket.receive", "text": json.dumps(payload)})
    async def recv(self):
        message = await asyncio.wait_for(self.outbound.get(), 2)
        return json.loads(message["text"]) if message["type"] == "websocket.send" else message
    async def close(self):
        await self.inbound.put({"type": "websocket.disconnect", "code": 1000})
        await asyncio.wait_for(self.task, 5)


@pytest.mark.asyncio
async def test_websocket_auth_ownership_and_connection_storage(monkeypatch, tmp_path):
    import app.db as database
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    session_id = uuid4()
    async with factory() as db:
        for name in ("one", "two"):
            email = f"{name}@test.local"
            db.add(User(email=email))
            db.add(Token(email=email, token_hash=hashlib.sha256(name.encode()).hexdigest(), expires_at=time.time()+100))
        db.add(WorkspaceInterview(id=session_id, owner_email="one@test.local", revision=0, snapshot_json="{}"))
        await db.commit()
    monkeypatch.setattr(database, "async_session", factory)
    monkeypatch.setattr(audio, "storage_root", lambda: tmp_path)
    monkeypatch.setattr(audio, "_ASR_READY", False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(audio.router, prefix="/api")
    anon = SocketHarness(app)
    await anon.start()
    assert (await anon.recv())["code"] == "E_AUTH"
    assert (await anon.recv())["code"] == 4401
    await anon.close()
    other = SocketHarness(app, "two")
    await other.start()
    await other.send({"type": "client_hello"})
    assert (await other.recv())["type"] == "ready"
    await other.send({"type": "session_start", "session_id": str(session_id), "source_mode": "mic"})
    assert (await other.recv())["code"] == "E_SESSION_ACCESS"
    assert (await other.recv())["code"] == 4404
    await other.close()
    for _ in range(2):
        owner = SocketHarness(app, "one")
        await owner.start()
        await owner.send({"type": "client_hello"})
        assert (await owner.recv())["type"] == "ready"
        await owner.send({"type": "session_start", "session_id": str(session_id), "source_mode": "mic"})
        assert (await owner.recv())["type"] == "session_ready"
        assert (await owner.recv())["code"] == "E_ASR_UNAVAILABLE"
        await owner.close()
    directory = tmp_path / hashlib.sha256(b'one@test.local').hexdigest() / str(session_id) / 'captures'
    assert len(list(directory.glob('*/session.json'))) == 2
    assert not (tmp_path / hashlib.sha256(b'two@test.local').hexdigest()).exists()
    await engine.dispose()


@pytest.mark.asyncio
async def test_multiple_utterances_sources_and_reconnect_namespaces():
    queue = asyncio.Queue()
    system = StreamingASRSession("test", "system", queue)
    mic = StreamingASRSession("test", "mic", queue)
    response = ASRResponse({"result": {"utterances": [
        {"text": "Node.js 的事件循环是什么？", "start_time": 0, "end_time": 1200, "definite": True},
        {"text": "HTTP 2.0", "start_time": 1400, "end_time": 1800, "definite": False},
    ]}})
    await system._consume(response)
    events = [await queue.get(), await queue.get()]
    assert len(events) == 2 and events[0]["text"] == "Node.js 的事件循环是什么？"
    assert events[0]["is_final"] and not events[1]["is_final"]
    await mic._consume(response)
    mic_events = [await queue.get(), await queue.get()]
    assert set(e["utterance_id"] for e in events).isdisjoint(e["utterance_id"] for e in mic_events)
    original_id = events[1]["utterance_id"]
    await system._consume(ASRResponse({"result": {"utterances": [
        {"text": "HTTP 2.0 为什么多路复用？", "start_time": 1400, "end_time": 2200, "definite": True}
    ]}}))
    final = await queue.get()
    assert final["utterance_id"] == original_id and final["revision"] == 2
    system._stream_id = str(uuid4())  # same lifecycle namespace reset as connect()
    system._segments = {}
    await system._consume(response)
    assert (await queue.get())["utterance_id"] not in {e["utterance_id"] for e in events}


@pytest.mark.asyncio
async def test_finish_waits_for_confirmed_tail_not_silence():
    queue = asyncio.Queue()
    session = StreamingASRSession("test", "mic", queue)
    session._running = True
    sent = []
    class FakeSocket:
        async def send(self, packet):
            sent.append(packet)
            if packet[1] & 0xF == 3:
                await session._consume(ASRResponse({"result": {"utterances": [
                    {"text": "最后一句完整文本", "start_time": 0, "end_time": 1000, "definite": True}
                ]}}, is_last=True))
                session._finished.set()
                session._response_done.set()
        async def close(self):
            pass
    session._ws = FakeSocket()
    session._send_task = asyncio.create_task(session._send_loop())
    session.feed(bytes(1280))
    result = await session.finish()
    assert result == "最后一句完整文本"
    event = await queue.get()
    assert event["is_final"] and event["provider_final"]
    assert sent[-1][1] & 0xF == 3


@pytest.mark.asyncio
async def test_audio_buffered_while_initial_provider_connects():
    queue = asyncio.Queue()
    session = StreamingASRSession("test", "mic", queue)
    entered, release = asyncio.Event(), asyncio.Event()
    async def connecting():
        entered.set()
        await release.wait()
        session._running = True
    session._connect = connecting
    task = asyncio.create_task(session.connect())
    await entered.wait()
    session.feed(bytes(1280))
    assert session._reconnect_task is None
    assert session._send_queue.qsize() == 1
    release.set()
    await task
    assert not session._connecting


@pytest.mark.asyncio
@pytest.mark.parametrize("trust_env, explicit, expected", [
    (None, None, None), ("true", None, True),
    ("true", "http://proxy.example:8080", "http://proxy.example:8080"),
])
async def test_asr_proxy_is_explicit_not_accidentally_inherited(monkeypatch, trust_env, explicit, expected):
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:1")
    for name, value in (("ASR_TRUST_ENV", trust_env), ("ASR_PROXY_URL", explicit)):
        if value is None: monkeypatch.delenv(name, raising=False)
        else: monkeypatch.setenv(name, value)
    captured = {}
    class StopProbe(Exception): pass
    async def connect(*args, **kwargs):
        captured.update(kwargs)
        raise StopProbe()
    monkeypatch.setattr(stt_module.websockets, "connect", connect)
    with pytest.raises(StopProbe):
        await StreamingASRSession("test-only", "mic", asyncio.Queue()).connect()
    assert captured["proxy"] == expected
    assert captured["ssl"].verify_mode == ssl.CERT_REQUIRED
    assert captured["ssl"].check_hostname is True
    assert captured["ssl"].cert_store_stats()["x509_ca"] > 0


@pytest.mark.asyncio
async def test_websocket_rapid_new_query_cancels_only_old_request(monkeypatch, tmp_path):
    async def authenticate(_):
        return "owner@test.local"
    async def authorize(*_):
        return None
    class FakeLLM:
        ready = False
        async def close(self):
            pass
        async def stream_answer(self, question, **kwargs):
            yield f"{question}答案", False
            if question == "旧":
                await asyncio.Event().wait()
            kwargs["result_metadata"]["finish_reason"] = "stop"
            yield "", True
    monkeypatch.setattr(audio, "authenticate_socket", authenticate)
    monkeypatch.setattr(audio, "authorize_audio_session", authorize)
    monkeypatch.setattr(audio, "LLMService", FakeLLM)
    monkeypatch.setattr(audio, "_ASR_READY", False)
    monkeypatch.setattr(audio, "storage_root", lambda: tmp_path)
    app = FastAPI()
    app.include_router(audio.router, prefix="/api")
    socket = SocketHarness(app, "test")
    await socket.start()
    await socket.send({"type": "client_hello"})
    await socket.recv()
    await socket.send({"type": "session_start", "session_id": str(uuid4()), "source_mode": "mic"})
    await socket.recv()
    await socket.recv()
    await socket.send({"type": "llm_query", "question_text": "旧", "request_id": "old"})
    assert (await socket.recv())["request_id"] == "old"
    assert (await socket.recv())["delta"] == "旧答案"
    await socket.send({"type": "llm_query", "question_text": "新", "request_id": "new"})
    events = [await socket.recv() for _ in range(4)]
    terminal = {e["request_id"]: e for e in events if e["type"] == "llm_done"}
    assert terminal["old"]["status"] == "cancelled"
    assert terminal["old"]["full_answer"] == "旧答案"
    assert terminal["new"]["status"] == "completed"
    assert terminal["new"]["full_answer"] == "新答案"
    await socket.close()


@pytest.mark.asyncio
async def test_untimed_partial_adopts_provider_utterance_without_duplicate_bubble():
    queue = asyncio.Queue()
    session = StreamingASRSession("test", "system", queue)
    await session._consume(ASRResponse({"result": {"text": "什么是"}}))
    draft = await queue.get()
    await session._consume(ASRResponse({"result": {"utterances": [
        {"text": "什么是 Node.js？", "start_time": 120, "end_time": 1100, "definite": True}
    ]}}))
    final = await queue.get()
    assert final["utterance_id"] == draft["utterance_id"]
    assert final["revision"] == draft["revision"] + 1
    assert len(session._segments) == 1


@pytest.mark.asyncio
async def test_untimed_next_question_cannot_overwrite_a_final_segment_at_zero():
    queue = asyncio.Queue()
    session = StreamingASRSession("test", "system", queue)
    await session._consume(ASRResponse({"result": {"utterances": [
        {"text": "第一句。", "start_time": 0, "end_time": 800, "definite": True}
    ]}}))
    first = await queue.get()
    await session._consume(ASRResponse({"result": {"text": "第一句。第二句"}}))
    draft = await queue.get()
    assert draft["text"] == "第二句" and draft["utterance_id"] != first["utterance_id"]
    await session._consume(ASRResponse({"result": {"utterances": [
        {"text": "第二句完整问题？", "start_time": 1000, "end_time": 1800, "definite": True}
    ]}}))
    second = await queue.get()
    assert second["utterance_id"] == draft["utterance_id"]
    assert list(session._all_text.values()) == ["第一句。", "第二句完整问题？"]


@pytest.mark.asyncio
async def test_distinct_overlapping_utterances_in_one_response_keep_distinct_ids():
    queue = asyncio.Queue()
    session = StreamingASRSession("test", "mic", queue)
    await session._consume(ASRResponse({"result": {"utterances": [
        {"text": "先说明原理", "start_time": 0, "end_time": 1000, "definite": False},
        {"text": "再举个例子", "start_time": 900, "end_time": 1800, "definite": False}
    ]}}))
    first, second = await queue.get(), await queue.get()
    assert first["utterance_id"] != second["utterance_id"]
    assert len(session._segments) == 2


@pytest.mark.asyncio
async def test_stop_during_provider_handshake_drains_pending_tail_once(monkeypatch):
    queue = asyncio.Queue()
    session = StreamingASRSession("test", "mic", queue)
    entered, release = asyncio.Event(), asyncio.Event()
    incoming = asyncio.Queue()
    packets = []

    class Socket:
        async def send(self, packet):
            packets.append(packet)
            if packet[1] >> 4 == 2 and packet[1] & 0xF == 3:
                await incoming.put(frame({"result": {"utterances": [
                    {"text": "短句也要保留", "start_time": 0, "end_time": 40, "definite": True}
                ]}}, flags=3))
        def __aiter__(self): return self
        async def __anext__(self): return await incoming.get()
        async def close(self): pass

    async def connect(*_, **__):
        entered.set()
        await release.wait()
        return Socket()
    monkeypatch.setattr(stt_module.websockets, "connect", connect)
    connecting = asyncio.create_task(session.connect())
    await entered.wait()
    session.feed(bytes(1280))
    first_stop = asyncio.create_task(session.finish())
    second_stop = asyncio.create_task(session.finish())
    await asyncio.sleep(0)
    assert not first_stop.done()
    release.set()
    await connecting
    assert await first_stop == await second_stop == "短句也要保留"
    audio_packets = [packet for packet in packets if packet[1] >> 4 == 2]
    assert len(audio_packets) == 1 and audio_packets[0][12:] == bytes(1280)
    assert struct.unpack_from('>i', audio_packets[0], 4)[0] == -2
    assert (await queue.get())["is_final"]


@pytest.mark.asyncio
async def test_stop_reports_unconfirmed_tail_if_pending_connection_never_opens(monkeypatch):
    queue = asyncio.Queue()
    session = StreamingASRSession("test", "mic", queue)
    entered = asyncio.Event()
    async def never_connects():
        entered.set()
        await asyncio.Event().wait()
    monkeypatch.setattr(session, "_connect", never_connects)
    monkeypatch.setattr(stt_module, "FINISH_CONNECT_TIMEOUT", 0.01)
    connecting = asyncio.create_task(session.connect())
    await entered.wait()
    session.feed(bytes(1280))
    await session.finish()
    await asyncio.gather(connecting, return_exceptions=True)
    assert (await queue.get())["code"] == "E_ASR_FINAL_TIMEOUT"


@pytest.mark.asyncio
@pytest.mark.parametrize("provider_code, details, code, reason, message", [
    (45000151, "invalid audio parameters", "E_ASR_PROVIDER", "invalid_audio", "音频格式"),
    (45000292, "quota exceeded for types: concurrency", "E_ASR_CONCURRENCY", "concurrency", "并发额度已满"),
    (45000292, "quota exceeded for types: audio_duration_lifetime", "E_ASR_QUOTA", "audio_duration", "时长额度不足"),
])
async def test_provider_rejection_does_not_reconnect_or_hide_error_with_final_timeout(
    monkeypatch, caplog, provider_code, details, code, reason, message,
):
    queue = asyncio.Queue()
    session = StreamingASRSession("test-only", "system", queue)
    incoming = asyncio.Queue()
    closed = asyncio.Event()
    class Socket:
        async def send(self, packet):
            if packet[1] >> 4 == 2:
                await incoming.put(frame({"error": details, "message": "secret-key and private interview text"},
                                         flags=0, error=provider_code))
        def __aiter__(self): return self
        async def __anext__(self): return await incoming.get()
        async def close(self): closed.set()
    calls = 0
    async def connect(*_, **__):
        nonlocal calls
        calls += 1
        return Socket()
    monkeypatch.setattr(stt_module.websockets, "connect", connect)
    await session.connect()
    session.feed(bytes(6400))
    await asyncio.wait_for(session._response_done.wait(), 1)
    assert session._provider_error_code == provider_code
    assert session._reconnect_task is None
    assert closed.is_set() and session._send_task.done()
    session.feed(bytes(6400))
    assert session._send_queue.empty()
    await asyncio.wait_for(session.finish(), 0.1)
    error = queue.get_nowait()
    assert error["code"] == code and str(provider_code) in error["message"] and message in error["message"]
    assert error["recoverable"] is False and error["provider_code"] == provider_code
    assert f"reason={reason}" in caplog.text and "request_id=" in caplog.text
    assert "secret-key" not in caplog.text and "private interview text" not in json.dumps(error)
    assert queue.empty() and not session._finished.is_set() and calls == 1


@pytest.mark.parametrize("payload, expected", [
    ({"message": "quota exceeded for types: concurrency"}, "E_ASR_CONCURRENCY"),
    ({"error": {"message": "Quota exceeded for types: concurrency"}}, "E_ASR_CONCURRENCY"),
    ({"error": "quota exceeded for types: audio_duration_lifetime"}, "E_ASR_QUOTA"),
    ({"error": "quota exceeded for types: other"}, "E_ASR_QUOTA"),
    ({"error": None, "message": ["not a valid message"]}, "E_ASR_QUOTA"),
])
def test_quota_reason_is_classified_from_payload_not_numeric_code_alone(payload, expected):
    code, _, _ = stt_module.provider_failure(ASRResponse(payload, error_code=45000292))
    assert code == expected


@pytest.mark.parametrize("resource", ["", "volc.seedasr.sauc.duration", "volc.seedasr.sauc.concurrent",
                                     "volc.bigasr.sauc.duration", "volc.bigasr.sauc.concurrent"])
def test_asr_resource_can_match_purchased_service(monkeypatch, resource):
    monkeypatch.setenv("VOLC_ASR_RESOURCE_ID", resource)
    assert stt_module.configured_resource_id() == (resource or "volc.seedasr.sauc.duration")
    monkeypatch.setenv("VOLC_ASR_RESOURCE_ID", "volc.seedasr.auc")
    with pytest.raises(ValueError, match="VOLC_ASR_RESOURCE_ID"):
        stt_module.configured_resource_id()


@pytest.mark.asyncio
async def test_initial_request_failure_releases_provider_connection(monkeypatch):
    closed = asyncio.Event()
    class Socket:
        async def send(self, packet): raise OSError("socket closed")
        async def close(self): closed.set()
    async def connect(*_, **__): return Socket()
    monkeypatch.setattr(stt_module.websockets, "connect", connect)
    session = StreamingASRSession("test", "mic", asyncio.Queue())
    with pytest.raises(OSError):
        await session.connect()
    assert closed.is_set() and session._recv_task is None and session._send_task is None
    await session.finish()


@pytest.mark.asyncio
@pytest.mark.parametrize("cause", ["local_delete", "remote_delete", "token_revoked"])
async def test_active_capture_stops_and_closes_files_on_delete_or_revocation(monkeypatch, tmp_path, cause):
    owner = "owner@test.local"
    session_id = str(uuid4())
    permission = {"token": True, "session": True}
    captures = []
    original_session = audio.V1AudioSession

    class RecordingSession(original_session):
        def __post_init__(self):
            super().__post_init__()
            captures.append(self)

    async def authenticate(_): return owner if permission["token"] else None
    async def authorize(*_):
        if not permission["session"]:
            raise audio.ProtocolError("E_SESSION_ACCESS", "deleted")
    monkeypatch.setattr(audio, "authenticate_socket", authenticate)
    monkeypatch.setattr(audio, "authorize_audio_session", authorize)
    monkeypatch.setattr(audio, "V1AudioSession", RecordingSession)
    monkeypatch.setattr(audio, "_ASR_READY", False)
    monkeypatch.setattr(audio, "SESSION_AUTH_INTERVAL", 0.01)
    monkeypatch.setattr(audio, "storage_root", lambda: tmp_path)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(audio.router, prefix="/api")
    socket = SocketHarness(app, "test")
    await socket.start()
    await socket.send({"type": "client_hello"})
    await socket.recv()
    await socket.send({"type": "session_start", "session_id": session_id, "source_mode": "mic"})
    await socket.recv()
    await socket.recv()
    await socket.send({"type": "track_start", "session_id": session_id, "source": "mic",
                       "format": {"sample_rate": 16000, "bit_depth": 16, "channels": 1}})
    assert (await socket.recv())["type"] == "track_ready"
    capture = captures[0]
    track = capture.tracks["mic"]
    handle = track.realtime_path.open("ab")
    track.realtime_file = handle
    handle.write(b"test audio")
    if cause == "local_delete":
        await audio.stop_active_audio_session("different-owner", session_id)
        assert not socket.task.done() and not handle.closed
        await asyncio.wait_for(audio.stop_active_audio_session(owner, session_id), 1)
    else:
        permission["session" if cause == "remote_delete" else "token"] = False
    expected_code = "E_AUTH" if cause == "token_revoked" else "E_SESSION_DELETED"
    assert (await socket.recv())["code"] == expected_code
    closed = await socket.recv()
    assert closed["type"] == "websocket.close"
    assert closed["code"] == (4401 if cause == "token_revoked" else 4404)
    await asyncio.wait_for(asyncio.gather(socket.task, return_exceptions=True), 1)
    assert handle.closed and (owner, session_id) not in audio._active_sessions
    await audio.stop_active_audio_session(owner, session_id)  # repeat deletion is idempotent


@pytest.mark.asyncio
@pytest.mark.parametrize("terminator", ["[DONE]", '{"choices":[{"delta":{},"finish_reason":"stop"}]}'])
async def test_provider_empty_completion_is_failed_not_a_blank_completed_answer(monkeypatch, terminator):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-only")
    service = LLMService()
    service._client = httpx.AsyncClient(transport=httpx.MockTransport(
        lambda _: httpx.Response(200, content=f"data: {terminator}\n\n", headers={"Content-Type": "text/event-stream"})))
    recorder = Recorder()
    await audio._llm_single(recorder, "问题", "zh", None, service, {}, "empty")
    assert recorder.events[-1]["status"] == "failed"
    assert recorder.events[-1]["error"] == "回答服务未返回正文，请重试"
    assert recorder.events[-1]["full_answer"] == ""
    await service.close()


@pytest.mark.asyncio
async def test_both_sources_finalize_concurrently_before_session_stopped_ack(monkeypatch, tmp_path):
    finalized = set()
    both_started = asyncio.Event()
    async def authenticate(_): return "owner@test.local"
    async def authorize(*_): pass

    class FakeASR:
        def __init__(self, source, queue):
            self.source, self.queue, self.task = source, queue, None
        async def connect(self): pass
        async def finish(self):
            if self.task is None:
                self.task = asyncio.create_task(self._finish())
            return await asyncio.shield(self.task)
        async def _finish(self):
            finalized.add(self.source)
            if len(finalized) == 2:
                both_started.set()
            await both_started.wait()
            await self.queue.put({"type": "transcription", "text": f"{self.source} final text", "source": self.source,
                                  "utterance_id": f"{self.source}:1", "revision": 1, "is_final": True})
            return "final text"

    monkeypatch.setattr(audio, "authenticate_socket", authenticate)
    monkeypatch.setattr(audio, "authorize_audio_session", authorize)
    monkeypatch.setattr(audio, "create_asr_session", FakeASR)
    monkeypatch.setattr(audio, "_ASR_READY", True)
    monkeypatch.setattr(audio, "storage_root", lambda: tmp_path)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(audio.router, prefix="/api")
    socket = SocketHarness(app, "test")
    await socket.start()
    await socket.send({"type": "client_hello"})
    await socket.recv()
    session_id = str(uuid4())
    await socket.send({"type": "session_start", "session_id": session_id, "source_mode": "both"})
    assert (await socket.recv())["type"] == "session_ready"
    await socket.send({"type": "config", "llm": {"enabled": True}})
    assert (await socket.recv())["track"] is None
    for source in ("mic", "system"):
        await socket.send({"type": "track_start", "session_id": session_id, "source": source,
                           "format": {"sample_rate": 16000, "bit_depth": 16, "channels": 1}})
        assert (await socket.recv())["type"] == "track_ready"
    for source in ("mic", "system"):
        await socket.send({"type": "track_end", "session_id": session_id, "source": source, "last_sequence": -1})
    await socket.send({"type": "session_stopped", "session_id": session_id, "stop_reason": "user_stop"})
    events = [await socket.recv() for _ in range(3)]
    assert {event["source"] for event in events[:2]} == {"mic", "system"}
    assert all(event["is_final"] for event in events[:2])
    assert events[-1]["type"] == "session_stopped"
    await socket.close()
