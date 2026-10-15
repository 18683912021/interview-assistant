"""Independent DeepSeek and Qwen configurations for both answer paths.

The project's legacy ANTHROPIC_* variables may point to DeepSeek's Anthropic
compatibility endpoint. They are converted to DeepSeek's chat-completions API,
not sent as an Anthropic request body. Never serialize API keys or proxy URLs.
"""
import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit, urlunsplit

DEFAULT_MODEL = "deepseek-flash"
DEFAULT_BASE_URL = "https://api.deepseek.com/v1"
DEFAULT_QWEN_MODEL = "qwen3.8-flash"
DEFAULT_QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"


def normalize_model(model: str) -> str:
    return "deepseek-flash" if model in {"deepseek-v4-flash", "deepseek-v4-flash-vision-exp"} else model


def read_proxy_config(prefix: str = "AI") -> tuple[str | None, bool]:
    proxy = os.getenv(f"{prefix}_PROXY_URL", "").strip() or None
    raw_trust = os.getenv(f"{prefix}_TRUST_ENV", "false").strip().lower()
    if raw_trust not in {"true", "false", "1", "0", "yes", "no", ""}:
        raise ValueError(f"{prefix}_TRUST_ENV 必须为 true 或 false")
    if proxy:
        try:
            parsed = urlsplit(proxy)
            valid = parsed.scheme in {"http", "https"} and parsed.hostname and not parsed.query and not parsed.fragment
            parsed.port
        except ValueError:
            valid = False
        if not valid:
            raise ValueError(f"{prefix}_PROXY_URL 必须是有效的 HTTP/HTTPS 代理地址")
    return proxy, raw_trust in {"true", "1", "yes"}


def normalize_base_url(value: str) -> str:
    try:
        parsed = urlsplit(value.strip())
        valid = (parsed.scheme in {"http", "https"} and parsed.hostname and
                 not parsed.username and not parsed.password and not parsed.query and not parsed.fragment)
        parsed.port
    except ValueError:
        valid = False
    if not valid:
        raise ValueError("AI API 地址无效；请使用不含凭据和查询参数的 HTTP/HTTPS 地址")
    path = parsed.path.rstrip("/")
    if parsed.hostname == "api.deepseek.com" and path in {"/anthropic", "/anthropic/v1"}:
        path = "/v1"
    elif path.endswith("/anthropic") or parsed.hostname == "api.anthropic.com":
        raise ValueError("当前回答服务使用 DeepSeek/OpenAI 协议，请配置兼容的 API 地址")
    if path.endswith("/chat/completions"):
        path = path[:-len("/chat/completions")]
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


@dataclass(frozen=True)
class AIConfig:
    api_key: str = field(repr=False)
    base_url: str = DEFAULT_BASE_URL
    model: str = DEFAULT_MODEL
    proxy: str | None = field(default=None, repr=False)
    trust_env: bool = False
    error: str | None = None
    provider: str = "deepseek"

    @property
    def configured(self) -> bool:
        return bool(self.api_key) and not self.error

    @property
    def proxy_mode(self) -> str:
        return "explicit" if self.proxy else "environment" if self.trust_env else "direct"

    def client_options(self) -> dict:
        options = {"trust_env": self.trust_env}
        if self.proxy:
            options["proxy"] = self.proxy
        return options

    def generation_options(self) -> dict:
        # Raw Chat Completions JSON: extra_body is only an SDK convention.
        return {"enable_thinking": False} if self.provider == "qwen" else {"thinking": {"type": "disabled"}}


def load_ai_config(*, workspace: bool = False, provider: str | None = None) -> AIConfig:
    provider = (provider or os.getenv("AI_PROVIDER", "deepseek")).strip().lower()
    if provider not in {"deepseek", "qwen"}:
        return AIConfig(api_key="", error="AI_PROVIDER 必须为 deepseek 或 qwen")
    if provider == "qwen":
        key = (os.getenv("QWEN_API_KEY") or os.getenv("DASHSCOPE_API_KEY") or "").strip()
        base = os.getenv("QWEN_BASE_URL") or DEFAULT_QWEN_BASE_URL
        model = (os.getenv("QWEN_MODEL") or DEFAULT_QWEN_MODEL).strip()
    else:
        key = (os.getenv("DEEPSEEK_API_KEY") or os.getenv("ANTHROPIC_API_KEY") or "").strip()
        base = (os.getenv("WORKSPACE_LLM_BASE_URL") if workspace else None) or os.getenv("DEEPSEEK_BASE_URL")
        if not base:
            base = os.getenv("ANTHROPIC_BASE_URL") if not os.getenv("DEEPSEEK_API_KEY") else None
        base = base or DEFAULT_BASE_URL
        model = ((os.getenv("WORKSPACE_LLM_MODEL") if workspace else None)
                 or os.getenv("DEEPSEEK_MODEL") or DEFAULT_MODEL).strip()
    try:
        normalized_base = normalize_base_url(base)
        proxy, trust = read_proxy_config()
        if not model or len(model) > 100 or any(char.isspace() for char in model):
            raise ValueError("AI 模型名称无效，请检查后端模型配置")
    except ValueError as error:
        return AIConfig(api_key=key, provider=provider, error=str(error))
    return AIConfig(api_key=key, base_url=normalized_base, model=normalize_model(model),
                    proxy=proxy, trust_env=trust, provider=provider)


def load_ai_configs(*, workspace: bool = False) -> tuple[AIConfig, ...]:
    """Primary then one independent fallback; missing keys do not block recovery."""
    primary = load_ai_config(workspace=workspace)
    configs = [primary]
    enabled = os.getenv("AI_FALLBACK_ENABLED", "true").strip().lower() not in {"false", "0", "no"}
    if enabled and os.getenv("AI_PROVIDER", "deepseek").strip().lower() in {"deepseek", "qwen"}:
        configs.append(load_ai_config(workspace=workspace, provider="qwen" if primary.provider == "deepseek" else "deepseek"))
    return tuple(config for config in configs if config.configured) or (primary,)


def provider_refused(payload) -> bool:
    """Classify explicit content refusals without exposing provider messages."""
    error = payload.get("error") if isinstance(payload, dict) else None
    if not isinstance(error, dict):
        return False
    for value in (error.get("code"), error.get("type")):
        if isinstance(value, str):
            normalized = "".join(char for char in value.lower() if char.isalnum())
            if any(word in normalized for word in ("inspection", "contentfilter", "contentpolicy", "unsafe", "inappropriatecontent")):
                return True
    return False


def provider_error_message(status: int, provider: str = "deepseek") -> str:
    name = "Qwen" if provider == "qwen" else "DeepSeek"
    return {
        400: "AI 请求格式与服务不兼容，请检查 API 地址和模型配置",
        401: f"AI 服务密钥无效，请检查后端 {name} API Key",
        402: f"AI 服务账户余额不足，请检查 {name} 账户余额",
        403: "AI 服务拒绝访问，请检查密钥权限与服务地址",
        404: "AI 接口或模型不存在，请检查后端 API 地址和模型配置",
        422: "AI 模型参数不兼容，请检查后端模型配置",
        429: "AI 服务请求过于频繁，请稍后重试",
    }.get(status, f"AI 服务暂不可用（HTTP {status}），请稍后重试")
