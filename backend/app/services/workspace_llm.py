"""Standard completion boundary for preparation and evidence-based reviews.

Kept separate from the live interview prompt. Tests replace complete_text; they
never call a provider or consume credits.
"""
import asyncio

import httpx
from fastapi import HTTPException
from app.services.ai_config import load_ai_config, provider_error_message


async def complete_text(system: str, user: str, *, max_tokens: int = 3500) -> str:
    config = load_ai_config(workspace=True)
    if not config.configured:
        raise HTTPException(503, config.error or "AI 服务尚未配置，请稍后重试")
    try:
        async with asyncio.timeout(95), httpx.AsyncClient(timeout=httpx.Timeout(90, connect=10), **config.client_options()) as client:
            response = await client.post(
                f"{config.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {config.api_key}"},
                json={"model": config.model, "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ], "stream": False, "thinking": {"type": "disabled"},
                    "temperature": 0.3, "max_tokens": max(1, min(max_tokens, 3500))},
            )
            response.raise_for_status()
            data = response.json()
            text = data["choices"][0]["message"]["content"]
            if not isinstance(text, str) or not text.strip():
                raise ValueError("empty completion")
            if data["choices"][0].get("finish_reason") == "length":
                raise HTTPException(502, "AI 输出过长而中断，请缩短材料后重试")
            return text.strip()
    except (httpx.TimeoutException, TimeoutError):
        raise HTTPException(504, "AI 响应超时，请重试")
    except httpx.HTTPStatusError as error:
        # Provider 401 concerns its server key, not the user's workspace login.
        raise HTTPException(502, provider_error_message(error.response.status_code))
    except httpx.HTTPError:
        raise HTTPException(502, "无法连接 AI 服务，请检查后端网络或 AI_PROXY_URL / AI_TRUST_ENV 配置")
    except (ValueError, KeyError, IndexError, TypeError):
        raise HTTPException(502, "AI 服务未返回有效正文，请检查 API 地址、模型及协议是否兼容")


async def stream_text(system: str, user: str, *, max_tokens: int = 3500):
    """Emit provider deltas; never declare truncated or disconnected content complete."""
    import json
    config = load_ai_config(workspace=True)
    if not config.configured:
        raise HTTPException(503, config.error or "AI 服务尚未配置")
    received = False
    try:
        async with asyncio.timeout(110), httpx.AsyncClient(timeout=httpx.Timeout(25, connect=10), **config.client_options()) as client:
            async with client.stream("POST", f"{config.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {config.api_key}"},
                json={"model": config.model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
                      "stream": True, "thinking": {"type": "disabled"}, "temperature": 0.3, "max_tokens": max_tokens}) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    value = line[5:].strip()
                    if value == "[DONE]":
                        if not received:
                            raise HTTPException(502, "AI 未返回正文，请重试")
                        return
                    data = json.loads(value)
                    if data.get("error"):
                        raise HTTPException(502, "AI 服务返回错误，请重试")
                    choices = data.get("choices", [])
                    if not choices:
                        continue
                    choice = choices[0]
                    chunk = choice.get("delta", {}).get("content") or ""
                    if chunk:
                        received = received or bool(chunk.strip())
                        yield chunk
                    reason = choice.get("finish_reason")
                    if reason:
                        if reason != "stop" or not received:
                            raise HTTPException(502, "生成未完整结束，已保留收到的内容，请缩短材料后重试")
                        return
                raise HTTPException(502, "生成连接提前结束，已保留收到的内容")
    except (httpx.TimeoutException, TimeoutError):
        raise HTTPException(504, "AI 响应超时，已保留收到的内容")
    except httpx.HTTPStatusError as error:
        raise HTTPException(502, provider_error_message(error.response.status_code))
    except httpx.HTTPError:
        raise HTTPException(502, "无法连接 AI 服务，请重试")
    except (ValueError, KeyError, IndexError, TypeError):
        raise HTTPException(502, "AI 流式数据格式异常，请重试")
