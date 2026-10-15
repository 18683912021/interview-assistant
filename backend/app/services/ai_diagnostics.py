"""Read-only readiness probe: lists models and never generates paid tokens."""
import asyncio

import httpx

from app.services.ai_config import AIConfig, load_ai_config, load_ai_configs, normalize_model, provider_error_message


def ai_status(config: AIConfig) -> dict:
    return {"configured": config.configured, "reachable": None, "ready": False,
            "reason_code": "config_invalid" if config.error else "unchecked" if config.api_key else "unconfigured",
            "message": config.error or ("已配置，尚未验证连接" if config.api_key else "后端尚未配置 AI 服务密钥"),
            "provider": config.provider, "model": config.model, "base_url": config.base_url, "proxy_mode": config.proxy_mode}


def ai_chain_status(*, workspace: bool = False) -> dict:
    statuses = [ai_status(config) for config in load_ai_configs(workspace=workspace)]
    return {**statuses[0], "providers": statuses, "fallback_configured": len(statuses) > 1}


async def probe_ai_chain(*, workspace: bool = False) -> dict:
    statuses = await asyncio.gather(*(probe_ai(config) for config in load_ai_configs(workspace=workspace)))
    selected = next((status for status in statuses if status["ready"]), statuses[0])
    result = {**selected, "providers": statuses, "fallback_configured": len(statuses) > 1}
    if selected is not statuses[0]:
        result.update(reason_code="fallback_ready", message="主服务暂不可用，备用 AI 服务连接及模型检查通过")
    return result


async def probe_ai(config: AIConfig | None = None) -> dict:
    config = config or load_ai_config()
    result = ai_status(config)
    if not config.configured:
        return result
    try:
        async with asyncio.timeout(8), httpx.AsyncClient(timeout=7, **config.client_options()) as client:
            response = await client.get(f"{config.base_url}/models", headers={"Authorization": f"Bearer {config.api_key}"})
        result["reachable"] = True
        if response.status_code != 200:
            result.update(reason_code={401: "auth_failed", 402: "insufficient_balance", 403: "forbidden", 429: "rate_limited"}.get(response.status_code, "upstream_error"),
                          message=provider_error_message(response.status_code, config.provider))
            return result
        payload = response.json()
        models = {normalize_model(item["id"]) for item in payload["data"] if isinstance(item, dict) and isinstance(item.get("id"), str)}
        if config.model not in models:
            result.update(reason_code="model_unavailable", message="当前密钥可访问 AI 服务，但未列出所选模型，请检查后端模型配置")
            return result
        result.update(ready=True, reason_code="ok", message="AI 服务连接及模型检查通过")
    except (TimeoutError, httpx.TimeoutException):
        result.update(reachable=False, reason_code="timeout", message="AI 连接检查超时，请检查后端网络或显式代理配置")
    except httpx.HTTPError:
        result.update(reachable=False, reason_code="connection_error", message="无法连接 AI 服务，请检查后端网络或 AI_PROXY_URL / AI_TRUST_ENV 配置")
    except (ValueError, KeyError, TypeError):
        result.update(reason_code="invalid_response", message="AI 服务返回的模型列表格式不兼容，请检查 API 地址")
    return result
