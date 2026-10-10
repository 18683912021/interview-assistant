"""Provider contract and shared lifecycle; never use real cloud credentials."""
import asyncio
import base64
import hashlib
import hmac
import json
from urllib.parse import parse_qs, urlsplit

import pytest

from app.services import asr_provider, stt_tencent
from app.services.stt_streaming import ASRProtocolError, ASRResponse, StreamingASRSession
from app.services.stt_tencent import TencentASRSession, signed_url


def response(index=0, kind=1, text="请介绍", start=0, end=100):
    return ASRResponse({"result": {"index": index, "slice_type": kind,
                                  "voice_text_str": text, "start_time": start, "end_time": end}})


@pytest.fixture
def credentials(monkeypatch):
    for key, value in {"APP_ID": "123456", "SECRET_ID": "test-id", "SECRET_KEY": "test-key"}.items():
        monkeypatch.setenv("TENCENT_ASR_" + key, value)


def test_signature_matches_sorted_raw_parameters_and_general_engine():
    url = signed_url("123456", "test-id", "test-key", "voice-1", timestamp=1700000000, nonce=123)
    parsed = urlsplit(url)
    params = {k: v[0] for k, v in parse_qs(parsed.query).items()}
    signature = params.pop("signature")
    canonical = ("asr.cloud.tencent.com/asr/v2/123456?convert_num_mode=1&engine_model_type=16k_zh"
                 "&expired=1700003600&filter_empty_result=0&filter_punc=0&needvad=1&nonce=123"
                 "&secretid=test-id&timestamp=1700000000&vad_silence_time=1000&voice_format=1&voice_id=voice-1")
    assert signature == base64.b64encode(hmac.new(b"test-key", canonical.encode(), hashlib.sha1).digest()).decode()
    assert params["engine_model_type"] == "16k_zh"
    assert "test-key" not in url


def test_explicit_provider_selection_preserves_volc_fallback(monkeypatch, credentials):
    monkeypatch.delenv("ASR_PROVIDER", raising=False)
    monkeypatch.setenv("VOLC_API_KEY", "old-private-key")
    assert type(asr_provider.create_asr_session("mic", asyncio.Queue())) is StreamingASRSession
    monkeypatch.setenv("ASR_PROVIDER", "tencent")
    assert asr_provider.asr_ready()
    assert isinstance(asr_provider.create_asr_session("system", asyncio.Queue()), TencentASRSession)
    monkeypatch.delenv("TENCENT_ASR_SECRET_KEY")
    assert not asr_provider.asr_ready()  # must not silently use another paid provider
    monkeypatch.setenv("ASR_PROVIDER", "volcengine")
    assert asr_provider.asr_ready()
    monkeypatch.setenv("ASR_PROVIDER", "invalid")
    with pytest.raises(ValueError):
        asr_provider.create_asr_session("mic", asyncio.Queue())


@pytest.mark.asyncio
async def test_drafts_revise_one_bubble_and_sentence_ids_separate_bubbles():
    queue = asyncio.Queue()
    session = TencentASRSession("system", queue)
    for item in [response(kind=0, text=""), response(), response(text="请介绍项目", end=700),
                 response(kind=2, text="请介绍项目。", end=900), response(text="迟来的草稿"),
                 response(kind=2, text="重复结果"), response(1, 2, "第二句。", 1000, 1500)]:
        await session._consume(item)
    events = [queue.get_nowait() for _ in range(queue.qsize())]
    assert [e["revision"] for e in events] == [1, 2, 3, 1]
    assert len({e["utterance_id"] for e in events[:3]}) == 1
    assert events[3]["utterance_id"] != events[2]["utterance_id"]
    assert [e["is_final"] for e in events] == [False, False, True, True]
    assert await session.finish() == "请介绍项目。\n第二句。"


@pytest.mark.asyncio
async def test_stream_final_does_not_falsely_confirm_draft_and_sources_are_isolated():
    queue = asyncio.Queue()
    sessions = [TencentASRSession(s, queue) for s in ("mic", "system")]
    for session in sessions:
        await session._consume(response())
        await session._consume(response(kind=2, text=""))
        await session._consume(ASRResponse({"final": 1}, is_last=True))
    events = [queue.get_nowait(), queue.get_nowait()]
    assert not any(e["is_final"] for e in events)
    assert events[0]["utterance_id"] != events[1]["utterance_id"]


@pytest.mark.parametrize("raw", ["[]", "null", "{}", '{"code":"0"}', b"binary", "bad-json"])
def test_malformed_provider_packets_are_rejected(raw):
    with pytest.raises(ASRProtocolError):
        TencentASRSession("mic", asyncio.Queue())._parse_response(raw)


class FakeSocket:
    def __init__(self, code=0):
        self.incoming = asyncio.Queue()
        self.incoming.put_nowait(json.dumps({"code": code}))
        self.sent = []
        self.closed = False

    async def recv(self):
        return await self.incoming.get()

    def __aiter__(self):
        return self

    async def __anext__(self):
        return await self.recv()

    async def send(self, data):
        self.sent.append((asyncio.get_running_loop().time(), data))
        if isinstance(data, str):
            self.incoming.put_nowait(json.dumps({"code": 0, "result": {
                "index": 0, "slice_type": 2, "voice_text_str": "你好。", "start_time": 0, "end_time": 400}}))
            self.incoming.put_nowait(json.dumps({"code": 0, "final": 1}))
        else:
            self.incoming.put_nowait(json.dumps({"code": 0, "result": {
                "index": 0, "slice_type": 1, "voice_text_str": "你好", "start_time": 0, "end_time": 100}}))

    async def close(self):
        self.closed = True


@pytest.mark.asyncio
async def test_full_lifecycle_paces_backlog_flushes_tail_and_resume_uses_new_id(monkeypatch, credentials):
    sockets, urls = [], []
    async def connect(url, **kwargs):
        urls.append(url)
        sockets.append(FakeSocket())
        return sockets[-1]
    monkeypatch.setattr(stt_tencent.websockets, "connect", connect)
    for _ in range(2):  # pause/resume creates a new provider connection
        session = TencentASRSession("mic", asyncio.Queue())
        await session.connect()
        session.feed(b"\0" * 13000)
        assert await session.finish() == "你好。"
        socket = sockets[-1]
        assert socket.closed
        assert [len(data) for _, data in socket.sent[:-1]] == [6400, 6400, 200]
        assert json.loads(socket.sent[-1][1]) == {"type": "end"}
        assert socket.sent[1][0] - socket.sent[0][0] >= 0.19
        assert session._finished.is_set()
        assert session._send_task.done() and session._recv_task.done()
    assert parse_qs(urlsplit(urls[0]).query)["voice_id"] != parse_qs(urlsplit(urls[1]).query)["voice_id"]


@pytest.mark.asyncio
@pytest.mark.parametrize("code,expected", [(4002, "E_ASR_AUTH"), (4003, "E_ASR_CONFIG"),
                                           (4004, "E_ASR_QUOTA"), (4006, "E_ASR_CONCURRENCY")])
async def test_handshake_rejection_closes_without_retry(monkeypatch, credentials, code, expected):
    socket = FakeSocket(code)
    async def connect(*args, **kwargs): return socket
    monkeypatch.setattr(stt_tencent.websockets, "connect", connect)
    queue = asyncio.Queue()
    session = TencentASRSession("mic", queue)
    await session.connect()
    session.feed(b"\0" * 6400)
    event = queue.get_nowait()
    assert event["code"] == expected and not event["recoverable"]
    assert socket.closed and session._reconnect_task is None and session._send_queue.empty()
    await session.finish()
    assert queue.empty()


@pytest.mark.asyncio
async def test_midstream_rejection_releases_sender_and_does_not_leak_provider_text(monkeypatch, credentials):
    socket = FakeSocket()
    async def connect(*args, **kwargs): return socket
    monkeypatch.setattr(stt_tencent.websockets, "connect", connect)
    queue = asyncio.Queue()
    session = TencentASRSession("system", queue)
    await session.connect()
    socket.incoming.put_nowait(json.dumps({"code": 4006, "message": "private diagnostic"}))
    await asyncio.wait_for(session._response_done.wait(), 1)
    assert socket.closed and session._send_task.done()
    event = queue.get_nowait()
    assert event["code"] == "E_ASR_CONCURRENCY" and "private" not in str(event)
    assert session._reconnect_task is None
    await session.finish()


@pytest.mark.asyncio
async def test_transport_reconnect_preserves_old_text_and_gets_fresh_identity(monkeypatch, credentials):
    sockets, urls = [], []
    async def connect(url, **kwargs):
        urls.append(url)
        sockets.append(FakeSocket())
        return sockets[-1]
    monkeypatch.setattr(stt_tencent.websockets, "connect", connect)
    session = TencentASRSession("mic", asyncio.Queue())
    await session.connect()
    first_id = session._stream_id
    await session._consume(response(kind=2, text="前一句。"))
    sockets[0].incoming.put_nowait("malformed transport data")
    async def reconnected():
        while len(sockets) < 2 or not session._running:
            await asyncio.sleep(.01)
    await asyncio.wait_for(reconnected(), 2)
    assert sockets[0].closed and session._stream_id != first_id
    session.feed(b"\0" * 6400)
    assert await session.finish() == "前一句。\n你好。"
    assert sockets[1].closed
