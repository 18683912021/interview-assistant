"""Workspace provider failover tests; all traffic stays inside MockTransport."""
import asyncio
import inspect
import json

import httpx
import pytest
from fastapi import HTTPException

from app.services import workspace_llm
from app.services.ai_config import AIConfig


@pytest.fixture(autouse=True)
def providers(monkeypatch):
    configs = (
        AIConfig(api_key="primary-test-key", base_url="https://primary.test/v1",
                 model="deepseek-flash", provider="deepseek"),
        AIConfig(api_key="backup-test-key", base_url="https://backup.test/compatible-mode/v1",
                 model="qwen3.8-flash", provider="qwen"),
    )
    monkeypatch.setattr(workspace_llm, "load_ai_configs", lambda **_: configs)
    return configs


def mock_provider(monkeypatch, handler):
    original = httpx.AsyncClient
    requests, clients = [], []

    async def dispatch(request):
        requests.append(request)
        result = handler(request)
        return await result if inspect.isawaitable(result) else result

    def factory(**kwargs):
        client = original(transport=httpx.MockTransport(dispatch), **kwargs)
        clients.append(client)
        return client

    monkeypatch.setattr(workspace_llm.httpx, "AsyncClient", factory)
    return requests, clients


def completion(text="备用回答", reason="stop", **message):
    return httpx.Response(200, json={"choices": [{
        "message": {"content": text, **message}, "finish_reason": reason,
    }]})


def event(content="", reason=None, **delta):
    return ("data: " + json.dumps({"choices": [{"delta": {"content": content, **delta},
            "finish_reason": reason}]}, ensure_ascii=False) + "\n\n").encode()


def stream_response(content="备用回答", reason="stop"):
    return httpx.Response(200, content=event(content, reason),
                         headers={"Content-Type": "text/event-stream"})


async def consume():
    return [chunk async for chunk in workspace_llm.stream_text("规则", "材料", max_tokens=777)]


@pytest.mark.asyncio
async def test_cooldown_is_shared_between_completion_and_streaming(monkeypatch):
    def provider(request):
        if request.url.host == "primary.test":
            return httpx.Response(503)
        return stream_response() if json.loads(request.content)["stream"] else completion()

    requests, clients = mock_provider(monkeypatch, provider)
    assert await workspace_llm.complete_text("规则", "材料") == "备用回答"
    assert await consume() == ["备用回答"]
    assert [request.url.host for request in requests] == ["primary.test", "backup.test", "backup.test"]
    assert all(client.is_closed for client in clients)


@pytest.mark.asyncio
@pytest.mark.parametrize("streaming", [False, True])
async def test_primary_success_never_calls_backup(monkeypatch, streaming):
    requests, clients = mock_provider(monkeypatch, lambda _: stream_response() if streaming else completion())
    result = await consume() if streaming else await workspace_llm.complete_text("规则", "材料", max_tokens=777)
    assert result == (["备用回答"] if streaming else "备用回答")
    assert len(requests) == 1 and requests[0].url.host == "primary.test"
    assert all(client.is_closed for client in clients)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["network", "timeout", "http", "empty", "invalid"])
async def test_complete_failover_preserves_context_and_uses_backup_configuration(monkeypatch, failure):
    def provider(request):
        if request.url.host == "backup.test":
            return completion()
        if failure == "network":
            raise httpx.ConnectError("raw proxy password", request=request)
        if failure == "timeout":
            raise httpx.ReadTimeout("raw provider secret", request=request)
        if failure == "http":
            return httpx.Response(503, text="raw secret")
        if failure == "empty":
            return completion("")
        return httpx.Response(200, json={"choices": "bad shape"})

    requests, clients = mock_provider(monkeypatch, provider)
    assert await workspace_llm.complete_text("规则", "材料", max_tokens=777) == "备用回答"
    primary, backup = [json.loads(request.content) for request in requests]
    assert primary["messages"] == backup["messages"] == [
        {"role": "system", "content": "规则"}, {"role": "user", "content": "材料"}]
    assert primary["max_tokens"] == backup["max_tokens"] == 777
    assert primary["thinking"] == {"type": "disabled"} and "enable_thinking" not in primary
    assert backup["enable_thinking"] is False and "thinking" not in backup
    assert primary["model"] == "deepseek-flash" and backup["model"] == "qwen3.8-flash"
    assert requests[1].headers["authorization"] == "Bearer backup-test-key"
    assert all(client.is_closed for client in clients)


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["http", "network", "empty_done", "whitespace_only", "early_eof", "invalid", "sse_error"])
async def test_stream_failover_only_before_output(monkeypatch, failure):
    def provider(request):
        if request.url.host == "backup.test":
            return stream_response()
        if failure == "network":
            raise httpx.ConnectError("secret", request=request)
        if failure == "http":
            return httpx.Response(429, text="secret")
        payloads = {"empty_done": b"data: [DONE]\n\n", "early_eof": event(),
                    "whitespace_only": event(" \n") + b"data: [DONE]\n\n",
                    "invalid": b"data: invalid-json\n\n",
                    "sse_error": b'data: {"error":{"message":"provider secret"}}\n\n'}
        return httpx.Response(200, content=payloads[failure])

    requests, clients = mock_provider(monkeypatch, provider)
    assert await consume() == ["备用回答"]
    assert [request.url.host for request in requests] == ["primary.test", "backup.test"]
    primary, backup = [json.loads(request.content) for request in requests]
    assert primary["messages"] == backup["messages"]
    assert primary["max_tokens"] == backup["max_tokens"] == 777
    assert backup["enable_thinking"] is False and "thinking" not in backup
    assert all(client.is_closed for client in clients)


@pytest.mark.asyncio
@pytest.mark.parametrize("text", ["已生成的内容", " \n已生成的内容"])
async def test_stream_partial_output_prevents_failover(monkeypatch, text):
    class BrokenStream(httpx.AsyncByteStream):
        closed = False

        async def __aiter__(self):
            yield event(text)
            raise httpx.ReadError("private upstream failure")

        async def aclose(self):
            self.closed = True

    incoming = BrokenStream()
    requests, clients = mock_provider(monkeypatch, lambda _: httpx.Response(200, stream=incoming))
    chunks = []
    with pytest.raises(HTTPException) as failure:
        async for chunk in workspace_llm.stream_text("规则", "材料"):
            chunks.append(chunk)
    assert chunks == [text] and len(requests) == 1
    assert "private" not in failure.value.detail
    assert incoming.closed and all(client.is_closed for client in clients)


@pytest.mark.asyncio
async def test_stream_discards_only_leading_whitespace_and_preserves_answer_formatting(monkeypatch):
    requests, _ = mock_provider(monkeypatch, lambda _: httpx.Response(
        200, content=event(" \n") + event("第一段") + event("\n\n") + event("末段", "stop")))
    assert await consume() == ["第一段", "\n\n", "末段"]
    assert len(requests) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("status", [400, 403, 422])
async def test_request_parameter_and_access_failures_do_not_switch_provider(monkeypatch, streaming, status):
    requests, _ = mock_provider(monkeypatch, lambda _: httpx.Response(status, text="private provider details"))
    with pytest.raises(HTTPException) as failure:
        await consume() if streaming else await workspace_llm.complete_text("规则", "材料")
    assert len(requests) == 1 and failure.value.status_code == 502
    assert "private provider" not in failure.value.detail


@pytest.mark.asyncio
@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("condition", ["length", "content_filter", "tool_calls", "refusal", "http_refusal"])
async def test_truncation_and_explicit_refusal_never_retry(monkeypatch, streaming, condition):
    def provider(_):
        if condition == "http_refusal":
            return httpx.Response(400, json={"error": {"code": "DataInspectionFailed", "message": "secret"}})
        if streaming:
            content = event(refusal="refused") if condition == "refusal" else event(reason=condition)
            return httpx.Response(200, content=content)
        return completion(refusal="refused") if condition == "refusal" else completion(reason=condition)

    requests, _ = mock_provider(monkeypatch, provider)
    with pytest.raises(HTTPException):
        await consume() if streaming else await workspace_llm.complete_text("规则", "材料")
    assert len(requests) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["insufficient_system_resource", "aborted"])
@pytest.mark.parametrize("text", ["", "尚未返回调用方的部分文本"])
async def test_complete_upstream_resource_failure_can_retry_before_return(monkeypatch, reason, text):
    requests, _ = mock_provider(monkeypatch, lambda request: (
        completion(text, reason) if request.url.host == "primary.test" else completion()))
    assert await workspace_llm.complete_text("规则", "材料") == "备用回答"
    assert [request.url.host for request in requests] == ["primary.test", "backup.test"]


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["insufficient_system_resource", "aborted"])
async def test_stream_upstream_resource_failure_without_output_can_retry(monkeypatch, reason):
    requests, _ = mock_provider(monkeypatch, lambda request: (
        stream_response("", reason) if request.url.host == "primary.test" else stream_response()))
    assert await consume() == ["备用回答"]
    assert [request.url.host for request in requests] == ["primary.test", "backup.test"]


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["insufficient_system_resource", "aborted"])
@pytest.mark.parametrize("same_packet", [False, True])
async def test_stream_upstream_resource_failure_after_output_never_retries(monkeypatch, reason, same_packet):
    payload = event("部分回答", reason) if same_packet else event("部分回答") + event(reason=reason)
    requests, _ = mock_provider(monkeypatch, lambda _: httpx.Response(200, content=payload))
    chunks = []
    with pytest.raises(HTTPException):
        async for chunk in workspace_llm.stream_text("规则", "材料"):
            chunks.append(chunk)
    assert chunks == ["部分回答"] and len(requests) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("target", ["primary.test", "backup.test"])
async def test_cancellation_propagates_and_closes_active_attempt(monkeypatch, streaming, target):
    entered, released = asyncio.Event(), asyncio.Event()

    async def provider(request):
        if request.url.host != target:
            return httpx.Response(503)
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            released.set()

    requests, clients = mock_provider(monkeypatch, provider)
    coroutine = consume() if streaming else workspace_llm.complete_text("规则", "材料")
    task = asyncio.create_task(coroutine)
    await asyncio.wait_for(entered.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert released.is_set() and len(requests) == (1 if target == "primary.test" else 2)
    assert all(client.is_closed for client in clients)


@pytest.mark.asyncio
async def test_first_content_timeout_ignores_keepalives_and_closes_primary(monkeypatch):
    monkeypatch.setattr(workspace_llm, "STREAM_FIRST_CONTENT_TIMEOUT", 0.03)

    class Keepalives(httpx.AsyncByteStream):
        closed = False
        count = 0

        async def __aiter__(self):
            while True:
                await asyncio.sleep(0.005)
                self.count += 1
                yield b': keepalive\n\ndata: {"choices":[]}\n\n'

        async def aclose(self):
            self.closed = True

    incoming = Keepalives()
    requests, _ = mock_provider(monkeypatch, lambda request: (
        httpx.Response(200, stream=incoming) if request.url.host == "primary.test" else stream_response()))
    assert await asyncio.wait_for(consume(), 1) == ["备用回答"]
    assert len(requests) == 2 and incoming.closed and incoming.count > 0


@pytest.mark.asyncio
@pytest.mark.parametrize("streaming", [False, True])
async def test_two_attempts_share_total_deadline(monkeypatch, streaming):
    monkeypatch.setattr(workspace_llm, "COMPLETE_TIMEOUT", 0.07)
    monkeypatch.setattr(workspace_llm, "COMPLETE_FIRST_ATTEMPT_TIMEOUT", 0.04)
    monkeypatch.setattr(workspace_llm, "STREAM_TIMEOUT", 0.07)
    monkeypatch.setattr(workspace_llm, "STREAM_FIRST_CONTENT_TIMEOUT", 0.04)

    async def provider(request):
        # Each provider could return within 50ms, but the combined wait cannot
        # exceed the shared 70ms budget after the primary used 40ms.
        await asyncio.sleep(0.05)
        return stream_response() if streaming else completion()

    requests, clients = mock_provider(monkeypatch, provider)
    with pytest.raises(HTTPException) as failure:
        await consume() if streaming else await workspace_llm.complete_text("规则", "材料")
    assert failure.value.status_code == 504 and len(requests) == 2
    assert all(client.is_closed for client in clients)


@pytest.mark.asyncio
async def test_slow_consumer_is_not_cancelled_while_generator_is_yielded(monkeypatch):
    monkeypatch.setattr(workspace_llm, "STREAM_IDLE_TIMEOUT", 0.02)
    requests, _ = mock_provider(monkeypatch, lambda _: httpx.Response(200, content=event("第一段") + event("末段", "stop")))
    chunks = []
    consumer_resumed = False
    with pytest.raises(HTTPException) as failure:
        async for chunk in workspace_llm.stream_text("规则", "材料"):
            chunks.append(chunk)
            await asyncio.sleep(0.05)
            consumer_resumed = True
    assert consumer_resumed and failure.value.status_code == 504
    assert chunks == ["第一段"] and len(requests) == 1


@pytest.mark.asyncio
async def test_completed_final_chunk_does_not_time_out_during_consumer_work(monkeypatch):
    monkeypatch.setattr(workspace_llm, "STREAM_IDLE_TIMEOUT", 0.02)
    requests, _ = mock_provider(monkeypatch, lambda _: stream_response())
    chunks = []
    async for chunk in workspace_llm.stream_text("规则", "材料"):
        chunks.append(chunk)
        await asyncio.sleep(0.05)
    assert chunks == ["备用回答"] and len(requests) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("streaming", [False, True])
async def test_both_provider_failures_are_sanitized(monkeypatch, streaming):
    requests, _ = mock_provider(monkeypatch, lambda _: httpx.Response(
        401, json={"error": {"message": "secret private-user-material proxy-password"}}))
    with pytest.raises(HTTPException) as failure:
        await consume() if streaming else await workspace_llm.complete_text("规则", "材料")
    assert len(requests) == 2 and failure.value.status_code == 502
    assert all(secret not in failure.value.detail for secret in ("secret", "private-user", "proxy-password"))


@pytest.mark.asyncio
@pytest.mark.parametrize("streaming", [False, True])
async def test_single_config_has_no_hidden_retry(monkeypatch, providers, streaming):
    monkeypatch.setattr(workspace_llm, "load_ai_configs", lambda **_: providers[:1])
    requests, _ = mock_provider(monkeypatch, lambda _: httpx.Response(503))
    with pytest.raises(HTTPException):
        await consume() if streaming else await workspace_llm.complete_text("规则", "材料")
    assert len(requests) == 1
