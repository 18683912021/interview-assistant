"""One explicit DeepSeek/OpenAI-protocol configuration for both answer paths.

The project's legacy ANTHROPIC_* variables may point to DeepSeek's Anthropic
compatibility endpoint. They are converted to DeepSeek's chat-completions API,
not sent as an Anthropic request body. Never serialize API keys or proxy URLs.
"""
import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit, urlunsplit

DEFAULT_MODEL = "deepseek-flash"
DEFAULT_BASE_URL = "https://api.deepseek.com/v1"


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


def load_ai_config(*, workspace: bool = False) -> AIConfig:
    key = (os.getenv("DEEPSEEK_API_KEY") or os.getenv("ANTHROPIC_API_KEY") or "").strip()
    base = (os.getenv("WORKSPACE_LLM_BASE_URL") if workspace else None) or os.getenv("DEEPSEEK_BASE_URL")
    if not base:
        base = os.getenv("ANTHROPIC_BASE_URL") if not os.getenv("DEEPSEEK_API_KEY") else None
    model = ((os.getenv("WORKSPACE_LLM_MODEL") if workspace else None)
             or os.getenv("DEEPSEEK_MODEL") or DEFAULT_MODEL).strip()
    try:
        normalized_base = normalize_base_url(base or DEFAULT_BASE_URL)
        proxy, trust = read_proxy_config()
        if not model or len(model) > 100 or any(char.isspace() for char in model):
            raise ValueError("AI 模型名称无效，请检查 DEEPSEEK_MODEL / WORKSPACE_LLM_MODEL")
    except ValueError as error:
        return AIConfig(api_key=key, error=str(error))
    return AIConfig(api_key=key, base_url=normalized_base, model=normalize_model(model), proxy=proxy, trust_env=trust)


def provider_error_message(status: int) -> str:
    return {
        400: "AI 请求格式与服务不兼容，请检查 API 地址和模型配置",
        401: "AI 服务密钥无效，请检查后端 DeepSeek API Key",
        402: "AI 服务账户余额不足，请检查 DeepSeek 账户余额",
        403: "AI 服务拒绝访问，请检查密钥权限与服务地址",
        404: "AI 接口或模型不存在，请检查后端 API 地址和模型配置",
        422: "AI 模型参数不兼容，请检查后端模型配置",
        429: "AI 服务请求过于频繁，请稍后重试",
    }.get(status, f"AI 服务暂不可用（HTTP {status}），请稍后重试")
