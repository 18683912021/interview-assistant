"""Real-time provider fallback regressions; every upstream request is mocked."""

import asyncio
import json
import logging

import httpx
import pytest

from app.services import llm_service as llm_module
from app.services.llm_service import LLMService


DEEPSEEK_HOST = "deepseek.example.test"
QWEN_HOST = "qwen.example.test"
DEEPSEEK_KEY = "test-deepseek-secret"
QWEN_KEY = "test-qwen-secret"


@pytest.fixture(autouse=True)
def provider_environment(monkeypatch):
    # Do not load .env or let developer credentials select real providers.
    for name in (
        "AI_PROVIDER", "AI_FALLBACK_ENABLED", "AI_PROXY_URL", "AI_TRUST_ENV",
        "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL",
        "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "DASHSCOPE_API_KEY",
        "QWEN_API_KEY", "QWEN_BASE_URL", "QWEN_MODEL",
        "WORKSPACE_LLM_BASE_URL", "WORKSPACE_LLM_MODEL",
    ):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DEEPSEEK_API_KEY", DEEPSEEK_KEY)
    monkeypatch.setenv("DEEPSEEK_BASE_URL", f"https://{DEEPSEEK_HOST}/v1")
    monkeypatch.setenv("QWEN_API_KEY", QWEN_KEY)
    monkeypatch.setenv("QWEN_BASE_URL", f"https://{QWEN_HOST}/compatible-mode/v1")


def sse(content="", finish_reason=None):
    payload = {"choices": [{"delta": {"content": content}, "finish_reason": finish_reason}]}
    return f"data: {json.dumps(payload)}\n\n".encode()


def answer_response(content="answer", finish_reason="stop"):
    return httpx.Response(
        200,
        headers={"Content-Type": "text/event-stream"},
        content=sse(content, finish_reason) + b"data: [DONE]\n\n",
    )


def service_with_transport(handler):
    service = LLMService()
    service._client = httpx.AsyncClient(transport=httpx.MockTransport(handler), trust_env=False)
    return service


async def collect(service, question="question", **kwargs):
    return [chunk async for chunk in service.stream_answer(question, **kwargs)]


class WaitingStream(httpx.AsyncByteStream):
    """Keep a response open, optionally sending traffic without usable content."""

    def __init__(self, packet=None, first=None):
        self.packet = packet
        self.first = first
        self.started = asyncio.Event()
        self.closed = False
        self.packets = 0

    async def __aiter__(self):
        self.started.set()
        if self.first is not None:
            yield self.first
        while True:
            await asyncio.sleep(0.005)
            if self.packet is not None:
                self.packets += 1
                yield self.packet

    async def aclose(self):
        self.closed = True


@pytest.mark.asyncio
async def test_primary_success_uses_its_credentials_and_never_calls_fallback():
    requests = []

    def provider(request):
        requests.append(request)
        return answer_response("primary answer")

    service = service_with_transport(provider)
    metadata = {}
    try:
        assert await collect(service, max_tokens=1234, result_metadata=metadata) == [("primary answer", True)]
    finally:
        await service.close()
    assert [request.url.host for request in requests] == [DEEPSEEK_HOST]
    body = json.loads(requests[0].content)
    assert requests[0].headers["authorization"] == f"Bearer {DEEPSEEK_KEY}"
    assert body["thinking"] == {"type": "disabled"}
    assert "enable_thinking" not in body
    assert body["max_tokens"] == 1234
    assert metadata["provider"] == "deepseek" and metadata["model"] == "deepseek-flash"
    assert metadata["finish_reason"] == "stop" and metadata["fallback_used"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["insufficient_system_resource", "aborted"])
@pytest.mark.parametrize("partial", ["", "已生成的部分"])
async def test_provider_resource_failure_only_fails_over_before_output(reason, partial):
    requests = []
    def provider(request):
        requests.append(request)
        if request.url.host == DEEPSEEK_HOST:
            return answer_response(partial, reason)
        return answer_response("备用答案")
    service = service_with_transport(provider)
    metadata = {}
    try:
        chunks = await collect(service, result_metadata=metadata)
    finally:
        await service.close()
    if partial:
        assert chunks == [(partial, True)]
        assert len(requests) == 1 and metadata["finish_reason"] == reason
    else:
        assert chunks == [("备用答案", True)]
        assert len(requests) == 2 and metadata["finish_reason"] == "stop"
        assert metadata["provider"] == "qwen" and metadata["fallback_used"]


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["http", "network", "read_timeout"])
async def test_failure_before_content_switches_once_with_qwen_specific_request(failure):
    requests = []

    def provider(request):
        requests.append(request)
        if request.url.host == DEEPSEEK_HOST:
            if failure == "network":
                raise httpx.ConnectError("upstream connection unavailable", request=request)
            if failure == "read_timeout":
                raise httpx.ReadTimeout("upstream read timed out", request=request)
            return httpx.Response(503, text="upstream unavailable")
        return answer_response("备用答案")

    service = service_with_transport(provider)
    metadata = {}
    try:
        assert await collect(service, model="deepseek-v4-pro", max_tokens=2345,
                             result_metadata=metadata) == [("备用答案", True)]
    finally:
        await service.close()
    assert [request.url.host for request in requests] == [DEEPSEEK_HOST, QWEN_HOST]
    primary, fallback = [json.loads(request.content) for request in requests]
    assert primary["model"] == "deepseek-v4-pro"
    assert fallback["model"] == "qwen3.8-flash"
    assert fallback["messages"] == primary["messages"]
    assert fallback["enable_thinking"] is False and "thinking" not in fallback
    assert "extra_body" not in fallback and fallback["max_tokens"] == 2345
    assert requests[1].headers["authorization"] == f"Bearer {QWEN_KEY}"
    assert requests[1].url.path == "/compatible-mode/v1/chat/completions"
    assert metadata["provider"] == "qwen" and metadata["model"] == "qwen3.8-flash"
    assert metadata["fallback_used"] is True and metadata["finish_reason"] == "stop"


@pytest.mark.asyncio
@pytest.mark.parametrize("packet", [None, b": keepalive\n\n", sse(" \t\n"),
                                    b'data: {"choices":[{"delta":{}}]}\n\n'])
async def test_first_content_timeout_ignores_heartbeats_and_whitespace(monkeypatch, packet):
    monkeypatch.setattr(llm_module, "FIRST_CONTENT_TIMEOUT", 0.04)
    monkeypatch.setattr(llm_module, "TOTAL_ANSWER_TIMEOUT", 0.5)
    primary_stream = WaitingStream(packet=packet)
    requests = []

    def provider(request):
        requests.append(request.url.host)
        if request.url.host == DEEPSEEK_HOST:
            return httpx.Response(200, stream=primary_stream)
        return answer_response("recovered")

    service = service_with_transport(provider)
    metadata = {}
    try:
        chunks = await asyncio.wait_for(collect(service, result_metadata=metadata), 0.4)
    finally:
        await service.close()
    assert chunks == [("recovered", True)]
    assert requests == [DEEPSEEK_HOST, QWEN_HOST]
    assert primary_stream.closed and metadata["fallback_used"] is True
    if packet is not None:
        assert primary_stream.packets > 0


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["network", "early_eof", "idle_timeout"])
async def test_partial_answer_is_preserved_without_switching_provider(monkeypatch, failure):
    monkeypatch.setattr(llm_module, "CONTENT_IDLE_TIMEOUT", 0.04)
    requests = []
    closed = asyncio.Event()

    class PartialStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield sse("already delivered")
            if failure == "network":
                raise httpx.ReadError("connection dropped")
            if failure == "idle_timeout":
                while True:
                    await asyncio.sleep(0.005)
                    yield b": heartbeat\n\n"

        async def aclose(self):
            closed.set()

    def provider(request):
        requests.append(request.url.host)
        return httpx.Response(200, stream=PartialStream())

    service = service_with_transport(provider)
    metadata, chunks = {}, []
    try:
        with pytest.raises(RuntimeError):
            async for chunk in service.stream_answer("question", result_metadata=metadata):
                chunks.append(chunk)
    finally:
        await service.close()
    assert chunks == [("already delivered", False)]
    assert requests == [DEEPSEEK_HOST] and closed.is_set()
    assert metadata["provider"] == "deepseek" and metadata["fallback_used"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("with_content", [False, True])
async def test_cancelled_request_never_starts_fallback(with_content):
    incoming = WaitingStream(first=sse("partial") if with_content else None)
    requests, chunks = [], []

    def provider(request):
        requests.append(request.url.host)
        return httpx.Response(200, stream=incoming)

    service = service_with_transport(provider)

    async def consume():
        async for chunk in service.stream_answer("question"):
            chunks.append(chunk)

    task = asyncio.create_task(consume())
    try:
        await asyncio.wait_for(incoming.started.wait(), 0.5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        await service.close()
    assert requests == [DEEPSEEK_HOST] and incoming.closed
    assert chunks == ([("partial", False)] if with_content else [])


@pytest.mark.asyncio
async def test_fallback_preserves_length_finish_reason():
    def provider(request):
        return (httpx.Response(429) if request.url.host == DEEPSEEK_HOST
                else answer_response("truncated fallback", "length"))

    service = service_with_transport(provider)
    metadata = {}
    try:
        assert await collect(service, result_metadata=metadata) == [("truncated fallback", True)]
    finally:
        await service.close()
    assert metadata["finish_reason"] == "length"
    assert metadata["provider"] == "qwen" and metadata["fallback_used"] is True


@pytest.mark.asyncio
async def test_fallback_shares_the_original_total_deadline(monkeypatch):
    monkeypatch.setattr(llm_module, "FIRST_CONTENT_TIMEOUT", 0.08)
    monkeypatch.setattr(llm_module, "TOTAL_ANSWER_TIMEOUT", 0.12)
    requests, incoming = [], []

    class LateAnswer(httpx.AsyncByteStream):
        async def __aiter__(self):
            # This fits a new 80 ms first-content budget, but not the remaining
            # 40 ms of the original request's total budget.
            await asyncio.sleep(0.06)
            yield sse("too late", "stop")

        async def aclose(self):
            pass

    def provider(request):
        requests.append(request.url.host)
        stream = WaitingStream() if request.url.host == DEEPSEEK_HOST else LateAnswer()
        incoming.append(stream)
        return httpx.Response(200, stream=stream)

    service = service_with_transport(provider)
    try:
        with pytest.raises(RuntimeError, match="超时"):
            await asyncio.wait_for(collect(service), 0.5)
    finally:
        await service.close()
    assert requests == [DEEPSEEK_HOST, QWEN_HOST]
    assert incoming[0].closed


@pytest.mark.asyncio
async def test_slow_consumer_cannot_accept_buffered_final_after_total_deadline(monkeypatch):
    monkeypatch.setattr(llm_module, "FIRST_CONTENT_TIMEOUT", 0.03)
    monkeypatch.setattr(llm_module, "CONTENT_IDLE_TIMEOUT", 0.5)
    monkeypatch.setattr(llm_module, "TOTAL_ANSWER_TIMEOUT", 0.03)
    requests = []

    def provider(request):
        requests.append(request.url.host)
        # Both events are already buffered, so reading the second event does
        # not yield to the event loop's scheduled timeout callback.
        return httpx.Response(200, content=sse("first") + sse("late", "stop"))

    service = service_with_transport(provider)
    metadata = {}
    stream = service.stream_answer("question", result_metadata=metadata)
    try:
        assert await anext(stream) == ("first", False)
        await asyncio.sleep(0.06)
        with pytest.raises(RuntimeError, match="超时"):
            await anext(stream)
    finally:
        await stream.aclose()
        await service.close()
    assert requests == [DEEPSEEK_HOST]
    assert metadata["finish_reason"] is None and metadata["fallback_used"] is False


@pytest.mark.asyncio
async def test_concurrent_requests_have_independent_provider_metadata():
    direct_started = asyncio.Event()
    fallback_started = asyncio.Event()
    requests = []

    async def provider(request):
        body = json.loads(request.content)
        question = json.loads(body["messages"][-1]["content"])["question"]
        requests.append((question, request.url.host))
        if question == "direct":
            direct_started.set()
            await fallback_started.wait()
            return answer_response("direct answer")
        if request.url.host == DEEPSEEK_HOST:
            await direct_started.wait()
            return httpx.Response(503)
        fallback_started.set()
        return answer_response("fallback answer", "length")

    service = service_with_transport(provider)
    first, second = {}, {}
    try:
        results = await asyncio.wait_for(asyncio.gather(
            collect(service, "direct", result_metadata=first),
            collect(service, "recover", result_metadata=second),
        ), 0.5)
    finally:
        await service.close()
    assert results == [[("direct answer", True)], [("fallback answer", True)]]
    assert (first["provider"], first["model"], first["finish_reason"], first["fallback_used"]) == (
        "deepseek", "deepseek-flash", "stop", False)
    assert (second["provider"], second["model"], second["finish_reason"], second["fallback_used"]) == (
        "qwen", "qwen3.8-flash", "length", True)
    assert len(requests) == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["http", "network", "sse"])
async def test_all_provider_failures_attempt_at_most_once_and_do_not_leak_secrets(caplog, failure):
    caplog.set_level(logging.DEBUG)
    requests = []
    sensitive = f"{DEEPSEEK_KEY} {QWEN_KEY} private-provider-response proxy-password"

    def provider(request):
        requests.append(request.url.host)
        if failure == "network":
            raise httpx.ConnectError(sensitive, request=request)
        if failure == "sse":
            return httpx.Response(200, content=f'data: {json.dumps({"error": sensitive})}\n\n')
        return httpx.Response(502, text=sensitive)

    service = service_with_transport(provider)
    metadata = {}
    try:
        with pytest.raises(RuntimeError) as error:
            await collect(service, result_metadata=metadata)
    finally:
        await service.close()
    exposed = str(error.value) + json.dumps(metadata) + caplog.text
    for value in (DEEPSEEK_KEY, QWEN_KEY, "private-provider-response", "proxy-password"):
        assert value not in exposed
    assert requests == [DEEPSEEK_HOST, QWEN_HOST]


@pytest.mark.asyncio
@pytest.mark.parametrize("error", [
    {"type": "content_policy_violation", "code": None},
    {"code": "InappropriateContent"},
])
async def test_explicit_provider_refusal_does_not_retry_another_provider(error):
    requests = []

    def provider(request):
        requests.append(request.url.host)
        if request.url.host == DEEPSEEK_HOST:
            return httpx.Response(200, content=f'data: {json.dumps({"error": error})}\n\n')
        return answer_response("must not be requested")

    service = service_with_transport(provider)
    try:
        with pytest.raises(RuntimeError):
            await collect(service)
    finally:
        await service.close()
    assert requests == [DEEPSEEK_HOST]


@pytest.mark.asyncio
async def test_fallback_can_be_explicitly_disabled(monkeypatch):
    monkeypatch.setenv("AI_FALLBACK_ENABLED", "false")
    requests = []

    def provider(request):
        requests.append(request.url.host)
        return httpx.Response(503)

    service = service_with_transport(provider)
    try:
        with pytest.raises(RuntimeError):
            await collect(service)
    finally:
        await service.close()
    assert requests == [DEEPSEEK_HOST]


@pytest.mark.asyncio
async def test_qwen_primary_can_fall_back_to_deepseek_without_reusing_model(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "qwen")
    monkeypatch.setenv("QWEN_MODEL", "qwen3.7-plus")
    requests = []

    def provider(request):
        requests.append(request)
        return httpx.Response(503) if request.url.host == QWEN_HOST else answer_response("DeepSeek backup")

    service = service_with_transport(provider)
    metadata = {}
    try:
        assert await collect(service, result_metadata=metadata) == [("DeepSeek backup", True)]
    finally:
        await service.close()
    assert [request.url.host for request in requests] == [QWEN_HOST, DEEPSEEK_HOST]
    assert [json.loads(request.content)["model"] for request in requests] == ["qwen3.7-plus", "deepseek-flash"]
    assert metadata["provider"] == "deepseek" and metadata["fallback_used"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("explicit_provider", [False, True])
async def test_qwen_only_configuration_can_generate(monkeypatch, explicit_provider):
    monkeypatch.delenv("DEEPSEEK_API_KEY")
    if explicit_provider:
        monkeypatch.setenv("AI_PROVIDER", "qwen")
    requests = []

    def provider(request):
        requests.append(request.url.host)
        return answer_response("Qwen only")

    service = service_with_transport(provider)
    metadata = {}
    try:
        assert service.ready
        assert await collect(service, result_metadata=metadata) == [("Qwen only", True)]
    finally:
        await service.close()
    assert requests == [QWEN_HOST]
    assert metadata["provider"] == "qwen" and metadata["model"] == "qwen3.8-flash"


@pytest.mark.asyncio
async def test_qwen_client_uses_shared_ai_proxy_options(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "qwen")
    monkeypatch.setenv("AI_PROXY_URL", "http://test-user:test-password@127.0.0.1:7890")
    monkeypatch.setenv("AI_TRUST_ENV", "true")
    client_type = httpx.AsyncClient
    captured = {}

    def factory(**options):
        captured.update(options)
        # Capture production options without creating any proxy connection.
        return client_type(transport=httpx.MockTransport(lambda _: answer_response()), trust_env=False)

    monkeypatch.setattr(llm_module.httpx, "AsyncClient", factory)
    service = LLMService()
    try:
        await service._get_client()
    finally:
        await service.close()
    assert captured["proxy"] == "http://test-user:test-password@127.0.0.1:7890"
    assert captured["trust_env"] is True


@pytest.mark.asyncio
async def test_next_question_skips_failed_primary_until_cooldown_expires(monkeypatch):
    from app.services import ai_failover
    now = [100.0]
    # Patch the cooldown clock only, without changing asyncio's clock.
    monkeypatch.setattr(ai_failover, "time", type("Clock", (), {"monotonic": staticmethod(lambda: now[0])}))
    requests = []
    recovered = False

    def provider(request):
        requests.append(request.url.host)
        if request.url.host == DEEPSEEK_HOST and not recovered:
            return httpx.Response(503)
        return answer_response(request.url.host)

    service = service_with_transport(provider)
    first, second, third = {}, {}, {}
    try:
        await collect(service, result_metadata=first)
        await collect(service, model="deepseek-v4-pro", result_metadata=second)
        assert requests == [DEEPSEEK_HOST, QWEN_HOST, QWEN_HOST]
        assert first["fallback_used"] and second["fallback_used"]
        assert second["model"] == "qwen3.8-flash"
        recovered = True
        now[0] += ai_failover.COOLDOWN_SECONDS
        await collect(service, result_metadata=third)
        assert requests[-1] == DEEPSEEK_HOST and not third["fallback_used"]
    finally:
        await service.close()
