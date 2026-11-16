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
                 "&secretid=test-id&timestamp=1700000000&vad_silence_time=600&voice_format=1&voice_id=voice-1")
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
async def test_opt_in_timing_separates_input_queue_from_provider_results():
    queue = asyncio.Queue()
    session = TencentASRSession('system', queue)
    await session._consume(response())
    assert 'diagnostic_timing' not in queue.get_nowait()
    session.diagnostics = True
    session._connecting = True
    session._queue_audio(bytes(2560))
    session._diagnostic_sent_bytes = 1280
    session._diagnostic_received_at = 1234
    await session._consume(response(text='公开计时测试', end=200))
    timing = queue.get_nowait()['diagnostic_timing']
    assert timing['queued_audio_ms'] == timing['sent_audio_ms'] == 40
    assert timing['provider_received_at_ms'] == 1234
    assert timing['last_ingest_at_ms'] > 0
    assert all(isinstance(value, (int,float)) for value in timing.values())


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
    events = [queue.get_nowait() for _ in range(queue.qsize())]
    assert not any(e["is_final"] for e in events)
    assert events[0]["utterance_id"] != events[2]["utterance_id"]
    assert events[1]['recognition_status'] == events[3]['recognition_status'] == 'pending'


@pytest.mark.asyncio
async def test_new_sentence_retires_only_same_source_and_late_final_still_confirms():
    queue = asyncio.Queue()
    mic = TencentASRSession('mic', queue)
    system = TencentASRSession('system', queue)
    await mic._consume(response(index=0, text='待确认的短音'))
    await system._consume(response(index=0, text='对方还在说'))
    await mic._consume(response(index=1, kind=0, text=''))
    events = [queue.get_nowait() for _ in range(queue.qsize())]
    assert len(events) == 3
    assert events[-1]['source'] == 'mic' and events[-1]['recognition_status'] == 'pending'
    assert not events[-1]['is_final'] and events[-1]['text'] == events[0]['text']
    await mic._consume(response(index=1, text='第二句'))
    await mic._consume(response(index=0, kind=2, text='前一句确认。'))
    events = [queue.get_nowait() for _ in range(queue.qsize())]
    assert events[-1]['utterance_id'].endswith(':mic:0') and events[-1]['is_final']
    assert events[-1]['revision'] > events[0]['revision']
    assert system._segments['0']['recognition_status'] == 'streaming'


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
        assert [len(data) for _, data in socket.sent[:-1]] == [1280] * 10 + [200]
        assert json.loads(socket.sent[-1][1]) == {"type": "end"}
        assert socket.sent[1][0] - socket.sent[0][0] >= 0.03
        assert session._finished.is_set()
        assert session._send_task.done() and session._recv_task.done()
    assert parse_qs(urlsplit(urls[0]).query)["voice_id"] != parse_qs(urlsplit(urls[1]).query)["voice_id"]


@pytest.mark.asyncio
async def test_half_hour_dual_source_clock_does_not_accumulate_send_cost(monkeypatch):
    """Virtual 30 minutes, real sender, two streams, nonzero transport cost."""
    clock = [1.0]
    class Loop:
        def time(self): return clock[0]
    async def sleep(delay): clock[0] += max(0, delay)
    class Socket:
        def __init__(self): self.count = 0
        async def send(self, data):
            self.count += len(data)
            clock[0] += .003
    sessions = [TencentASRSession(source, asyncio.Queue()) for source in ('mic', 'system')]
    for session in sessions: session._ws = Socket()
    with monkeypatch.context() as patch:
        patch.setattr(asyncio, 'get_running_loop', lambda: Loop())
        patch.setattr(asyncio, 'sleep', sleep)
        worst = 0
        for packet in range(45000):
            clock[0] = max(clock[0], 1 + packet * .04)
            for session in sessions:
                await session._send_audio(bytes(1280))
            worst = max(worst, clock[0] - (1 + packet * .04))
    assert worst < .02
    assert all(session._ws.count == 1800 * 32000 for session in sessions)


@pytest.mark.asyncio
async def test_dual_source_recovers_repeated_delivery_stalls_without_moving_audio_clock(monkeypatch):
    """A pause in delivery must not become permanent extra latency per pause."""
    clock = [1.0]
    class Loop:
        def time(self): return clock[0]
    async def sleep(delay): clock[0] += max(0, delay)
    class Socket:
        def __init__(self): self.sent = []
        async def send(self, data):
            self.sent.append((clock[0], data))
            clock[0] += .001
    sessions = [TencentASRSession(source, asyncio.Queue()) for source in ('mic', 'system')]
    for session in sessions: session._ws = Socket()
    recovered_lags = []
    with monkeypatch.context() as patch:
        patch.setattr(asyncio, 'get_running_loop', lambda: Loop())
        patch.setattr(asyncio, 'sleep', sleep)
        for packet in range(1500):
            captured_at = 1 + packet * .04
            # Public real-time input delivered in a batch after a 600 ms
            # transport stall, six times; both sources retain every byte.
            delayed = packet % 250 < 15 and packet >= 250
            available_at = 1 + (packet // 250 * 250 + 15) * .04 if delayed else captured_at
            clock[0] = max(clock[0], available_at)
            for source, session in enumerate(sessions):
                await session._send_audio(bytes([source + packet % 200]) * 1280)
            if packet % 250 == 100:
                recovered_lags.append(clock[0] - captured_at)
    assert max(recovered_lags) < .08
    for source, session in enumerate(sessions):
        sent = session._ws.sent
        assert b''.join(data for _, data in sent) == b''.join(
            bytes([source + packet % 200]) * 1280 for packet in range(1500))
        # Recovery is bounded, rather than dumping an entire old buffer at once.
        assert max(sum(len(data) / 32000 for at, data in sent if end - 1 < at <= end)
                   for end, _ in sent) < 2.12


@pytest.mark.asyncio
async def test_overflow_spills_fifo_without_dropping_or_blocking_other_source():
    sessions = [TencentASRSession(source, asyncio.Queue()) for source in ('mic', 'system')]
    originals, outputs = [], [bytearray(), bytearray()]
    for index, session in enumerate(sessions):
        session._send_queue = asyncio.Queue(maxsize=2)
        session._connecting = True  # simulate delayed handshake
        audio = [bytes([index + packet % 200]) * 1280 for packet in range(300)] + [b'tail']
        originals.append(b''.join(audio))
        for pcm in audio:
            await session.feed_wait(pcm)
        assert session._send_queue.qsize() == 2
        assert session._spill is not None
        session._running = True
        async def send(pcm, final=False, index=index): outputs[index].extend(pcm)
        session._send_audio = send
    await asyncio.gather(*(s._send_queue.put(None) for s in sessions),
                         *(s._send_loop() for s in sessions))
    assert [bytes(output) for output in outputs] == originals
    assert all(s._spill is None and not s._pending_audio for s in sessions)


@pytest.mark.asyncio
async def test_send_failure_keeps_unsent_pending_audio_for_reconnect():
    session = TencentASRSession('mic', asyncio.Queue())
    session._running = True
    session._schedule_reconnect = lambda: None
    async def fail(pcm, final=False): raise ConnectionError()
    session._send_audio = fail
    await session.feed_wait(b'x' * 1280)
    await session._send_loop()
    assert session._pending_audio == b'x' * 1280
    output = bytearray()
    async def send(pcm, final=False): output.extend(pcm)
    session._send_audio = send
    session._running = True
    await session._send_queue.put(None)
    await session._send_loop()
    assert output == b'x' * 1280


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
