"""Completion boundary for preparation and evidence-based reviews.

Provider failover is allowed only before content reaches the caller. Both
attempts share one deadline, and cancellation never starts another provider.
"""
import asyncio
import json

import httpx
from fastapi import HTTPException
from app.services.ai_config import load_ai_configs, provider_error_message, provider_refused as _refused
from app.services.ai_failover import prioritize_available, mark_available, mark_unavailable

COMPLETE_TIMEOUT = 95.0
COMPLETE_FIRST_ATTEMPT_TIMEOUT = 45.0
STREAM_TIMEOUT = 110.0
STREAM_FIRST_CONTENT_TIMEOUT = 12.0
STREAM_IDLE_TIMEOUT = 25.0
_RETRYABLE_FINISH_REASONS = {"insufficient_system_resource", "aborted"}


class _GenerationError(Exception):
    """Only fixed, client-safe messages may cross this provider boundary."""

    def __init__(self, status: int, message: str, *, fallback: bool = True):
        super().__init__(message)
        self.status = status
        self.message = message
        self.fallback = fallback


def _http_failure(response: httpx.Response, config) -> _GenerationError:
    try:
        refused = _refused(response.json())
    except (ValueError, TypeError):
        refused = False
    if refused:
        return _GenerationError(502, "AI 服务拒绝生成该内容，请调整请求", fallback=False)
    return _GenerationError(502, provider_error_message(response.status_code, config.provider),
                            fallback=response.status_code not in (400, 403, 422))


def _configs():
    configs = load_ai_configs(workspace=True)
    available = tuple(config for config in configs if config.configured)[:2]
    if not available:
        message = next((config.error for config in configs if config.error), None)
        raise HTTPException(503, message or "AI 服务尚未配置，请稍后重试")
    return prioritize_available(available)


def _body(config, messages, max_tokens: int, *, stream: bool) -> dict:
    return {"model": config.model, "messages": messages, "stream": stream,
            "temperature": 0.3, "max_tokens": max_tokens, **config.generation_options()}


async def complete_text(system: str, user: str, *, max_tokens: int = 3500) -> str:
    configs = _configs()
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    budget = max(1, min(max_tokens, 3500))
    loop = asyncio.get_running_loop()
    total_deadline = loop.time() + COMPLETE_TIMEOUT
    for index, config in enumerate(configs):
        attempt_deadline = total_deadline
        if index + 1 < len(configs):
            attempt_deadline = min(attempt_deadline, loop.time() + COMPLETE_FIRST_ATTEMPT_TIMEOUT)
        try:
            async with asyncio.timeout_at(attempt_deadline), httpx.AsyncClient(
                timeout=httpx.Timeout(90, connect=10), **config.client_options()
            ) as client:
                response = await client.post(
                    f"{config.base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {config.api_key}"},
                    json=_body(config, messages, budget, stream=False),
                )
                if not response.is_success:
                    raise _http_failure(response, config)
                data = response.json()
                if _refused(data):
                    raise _GenerationError(502, "AI 服务拒绝生成该内容，请调整请求", fallback=False)
                choice = data["choices"][0]
                reason = choice.get("finish_reason")
                if reason == "length":
                    raise _GenerationError(502, "AI 输出过长而中断，请缩短材料后重试", fallback=False)
                message = choice["message"]
                if message.get("refusal"):
                    raise _GenerationError(502, "AI 服务未完成生成，请调整请求", fallback=False)
                if reason in _RETRYABLE_FINISH_REASONS:
                    raise _GenerationError(502, "AI 服务生成中断，请重试")
                if reason not in (None, "stop"):
                    raise _GenerationError(502, "AI 服务未完成生成，请调整请求", fallback=False)
                text = message.get("content")
                if not isinstance(text, str) or not text.strip():
                    raise ValueError("empty completion")
                mark_available(config)
                return text.strip()
        except asyncio.CancelledError:
            raise
        except _GenerationError as error:
            failure = error
        except (httpx.TimeoutException, TimeoutError):
            failure = _GenerationError(504, "AI 响应超时，请重试")
        except httpx.HTTPError:
            failure = _GenerationError(502, "无法连接 AI 服务，请检查后端网络或 AI_PROXY_URL / AI_TRUST_ENV 配置")
        except (ValueError, KeyError, IndexError, TypeError, AttributeError):
            failure = _GenerationError(502, "AI 服务未返回有效正文，请检查 API 地址、模型及协议是否兼容")
        if failure.fallback:
            mark_unavailable(config)
        if not failure.fallback or index + 1 == len(configs) or loop.time() >= total_deadline:
            raise HTTPException(failure.status, failure.message) from None


async def stream_text(system: str, user: str, *, max_tokens: int = 3500):
    """Emit provider deltas, retaining partial output on interruption."""
    configs = _configs()
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    loop = asyncio.get_running_loop()
    total_deadline = loop.time() + STREAM_TIMEOUT
    emitted = False
    for index, config in enumerate(configs):
        received = False
        content_deadline = min(total_deadline, loop.time() + STREAM_FIRST_CONTENT_TIMEOUT)
        try:
            async with asyncio.timeout_at(content_deadline) as deadline, httpx.AsyncClient(
                timeout=httpx.Timeout(25, connect=10), **config.client_options()
            ) as client:
                async with client.stream(
                    "POST", f"{config.base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {config.api_key}"},
                    json=_body(config, messages, max_tokens, stream=True),
                ) as response:
                    if not response.is_success:
                        await response.aread()
                        raise _http_failure(response, config)
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        value = line[5:].strip()
                        if value == "[DONE]":
                            if not received:
                                raise _GenerationError(502, "AI 未返回正文，请重试")
                            mark_available(config)
                            return
                        data = json.loads(value)
                        if data.get("error"):
                            if _refused(data):
                                raise _GenerationError(502, "AI 服务拒绝生成该内容，请调整请求", fallback=False)
                            raise _GenerationError(502, "AI 服务返回错误，请重试")
                        choices = data.get("choices", [])
                        if not choices:
                            continue
                        choice = choices[0]
                        delta = choice.get("delta", {})
                        if delta.get("refusal"):
                            raise _GenerationError(502, "AI 服务拒绝生成该内容，请调整请求", fallback=False)
                        chunk = delta.get("content") or ""
                        if not isinstance(chunk, str):
                            raise ValueError("invalid content")
                        if chunk.strip():
                            received = True
                            content_deadline = min(total_deadline, loop.time() + STREAM_IDLE_TIMEOUT)
                        reason = choice.get("finish_reason")
                        emit_chunk = bool(chunk) and received
                        if emit_chunk:
                            # Ignore leading whitespace until there is usable
                            # content; preserve formatting once the answer starts.
                            # Every emitted character makes retrying unsafe.
                            emitted = True
                            deadline.reschedule(None)
                            yield chunk
                        if reason:
                            if reason != "stop":
                                raise _GenerationError(502, "生成未完整结束，已保留收到的内容，请缩短材料后重试",
                                                       fallback=reason in _RETRYABLE_FINISH_REASONS)
                            if not received:
                                raise _GenerationError(502, "AI 未返回正文，请重试")
                            mark_available(config)
                            return
                        if emit_chunk:
                            # Enforce the absolute deadline once the caller is
                            # consuming again, never cancel its work while yielded.
                            if loop.time() >= content_deadline:
                                raise TimeoutError
                            deadline.reschedule(content_deadline)
                    raise _GenerationError(502, "生成连接提前结束，已保留收到的内容")
        except asyncio.CancelledError:
            raise
        except _GenerationError as error:
            failure = error
        except (httpx.TimeoutException, TimeoutError):
            failure = _GenerationError(504, "AI 响应超时，已保留收到的内容")
        except httpx.HTTPError:
            failure = _GenerationError(502, "无法连接 AI 服务，请重试")
        except (ValueError, KeyError, IndexError, TypeError, AttributeError):
            failure = _GenerationError(502, "AI 流式数据格式异常，请重试")
        if failure.fallback:
            mark_unavailable(config)
        if emitted or not failure.fallback or index + 1 == len(configs) or loop.time() >= total_deadline:
            raise HTTPException(failure.status, failure.message) from None
