"""AI configuration and readiness tests. Provider traffic uses MockTransport."""
import json
import os

os.environ["LOCAL_DEV"] = "true"

import httpx
import pytest
from fastapi import FastAPI, HTTPException

from app.db import get_db
from app.routers.auth import get_current_user
from app.routers.diagnostics import router
from app.services.ai_config import load_ai_config, read_proxy_config
from app.services.ai_diagnostics import probe_ai
from app.services import llm_service, workspace_llm


@pytest.fixture(autouse=True)
def clean_config(monkeypatch):
    for key in ("DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "DEEPSEEK_BASE_URL", "ANTHROPIC_BASE_URL",
                "WORKSPACE_LLM_BASE_URL", "WORKSPACE_LLM_MODEL", "DEEPSEEK_MODEL", "AI_PROXY_URL", "AI_TRUST_ENV"):
        monkeypatch.delenv(key, raising=False)


def test_legacy_deepseek_settings_and_dead_shell_proxy_are_handled_explicitly(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "not-a-real-key")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://api.deepseek.com/anthropic")
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:1")
    for config in (load_ai_config(), load_ai_config(workspace=True)):
        assert config.configured and config.base_url == "https://api.deepseek.com/v1"
        assert config.model == "deepseek-flash"
        assert config.client_options() == {"trust_env": False}
        assert "not-a-real-key" not in repr(config)
    monkeypatch.setenv("AI_TRUST_ENV", "true")
    assert read_proxy_config() == (None, True)
    monkeypatch.setenv("AI_PROXY_URL", "http://user:proxy-secret@127.0.0.1:8080")
    config = load_ai_config()
    assert config.proxy_mode == "explicit" and config.client_options()["proxy"]
    assert "proxy-secret" not in repr(config)


def test_workspace_override_alias_and_invalid_config_never_expose_secrets(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")
    monkeypatch.setenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
    monkeypatch.setenv("WORKSPACE_LLM_MODEL", "deepseek-v4-pro")
    monkeypatch.setenv("WORKSPACE_LLM_BASE_URL", "https://compatible.example/v1/chat/completions/")
    assert load_ai_config().model == "deepseek-flash"
    config = load_ai_config(workspace=True)
    assert config.model == "deepseek-v4-pro" and config.base_url == "https://compatible.example/v1"
    monkeypatch.setenv("AI_PROXY_URL", "http://user:secret@bad:port")
    config = load_ai_config()
    assert not config.configured and config.error and "secret" not in config.error
    monkeypatch.delenv("AI_PROXY_URL")
    monkeypatch.setenv("DEEPSEEK_BASE_URL", "https://user:secret@example.test/v1?token=secret")
    config = load_ai_config()
    assert not config.configured and "secret" not in repr(config)


def mock_provider(monkeypatch, handler):
    original = httpx.AsyncClient
    calls = []
    def factory(**kwargs):
        calls.append(kwargs)
        return original(transport=httpx.MockTransport(handler), **kwargs)
    monkeypatch.setattr(httpx, "AsyncClient", factory)
    return calls


@pytest.mark.asyncio
async def test_readiness_uses_only_models_without_billable_generation(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")
    requests = []
    def provider(request):
        requests.append(request)
        return httpx.Response(200, json={"data": [{"id": "deepseek-flash"}]})
    options = mock_provider(monkeypatch, provider)
    result = await probe_ai()
    assert result["configured"] and result["reachable"] and result["ready"]
    assert result["reason_code"] == "ok" and result["proxy_mode"] == "direct"
    assert len(requests) == 1 and requests[0].method == "GET" and requests[0].url.path == "/v1/models"
    assert options[0]["trust_env"] is False
    assert "test-key" not in json.dumps(result)


@pytest.mark.asyncio
@pytest.mark.parametrize("status, code", [(401, "auth_failed"), (402, "insufficient_balance"), (429, "rate_limited")])
async def test_provider_errors_are_actionable_and_not_login_errors(monkeypatch, status, code):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")
    mock_provider(monkeypatch, lambda _: httpx.Response(status, text="provider secret must not leak"))
    result = await probe_ai()
    assert result["reachable"] and not result["ready"] and result["reason_code"] == code
    with pytest.raises(HTTPException) as failure:
        await workspace_llm.complete_text("test", "test")
    assert failure.value.status_code == 502
    assert "secret" not in failure.value.detail
    assert result["message"] == failure.value.detail


@pytest.mark.asyncio
async def test_network_errors_explain_proxy_and_workspace_disables_thinking(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")
    requests = []
    def provider(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "连接成功"}, "finish_reason": "stop"}]})
    mock_provider(monkeypatch, provider)
    assert await workspace_llm.complete_text("test", "test", max_tokens=16) == "连接成功"
    assert requests[0]["thinking"] == {"type": "disabled"}
    assert requests[0]["max_tokens"] == 16 and requests[0]["model"] == "deepseek-flash"


@pytest.mark.asyncio
async def test_streaming_falls_back_without_optional_http2_dependency(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")
    monkeypatch.setattr(llm_service.importlib.util, "find_spec", lambda _: None)
    options = mock_provider(monkeypatch, lambda _: httpx.Response(200))
    service = llm_service.LLMService()
    await service._get_client()
    assert options[0]["http2"] is False and options[0]["trust_env"] is False
    await service.close()


@pytest.mark.asyncio
async def test_connection_failures_have_safe_specific_readiness(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")
    def provider(request):
        raise httpx.ConnectError("proxy-secret", request=request)
    mock_provider(monkeypatch, provider)
    result = await probe_ai()
    assert result["reason_code"] == "connection_error" and result["reachable"] is False
    assert "AI_PROXY_URL" in result["message"] and "proxy-secret" not in result["message"]
    with pytest.raises(HTTPException) as failure:
        await workspace_llm.complete_text("test", "test")
    assert "AI_PROXY_URL" in failure.value.detail


@pytest.mark.asyncio
async def test_diagnostics_requires_auth_and_unconfigured_does_not_probe():
    app = FastAPI()
    app.include_router(router, prefix="/api")
    class Database:
        async def rollback(self):
            pass
    async def database():
        yield Database()
    app.dependency_overrides[get_db] = database
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/diagnostics/ai")).status_code == 401
        app.dependency_overrides[get_current_user] = lambda: "test@example.test"
        response = await client.get("/api/diagnostics/ai")
        assert response.status_code == 200
        assert response.json()["reason_code"] == "unconfigured"
        assert response.json()["reachable"] is None and response.json()["ready"] is False
