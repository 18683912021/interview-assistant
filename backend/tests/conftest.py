"""Keep developer Qwen credentials out of offline provider regression tests."""
import os

import pytest


@pytest.fixture(autouse=True)
def isolate_fallback_configuration(monkeypatch):
    from app.services import ai_failover
    monkeypatch.setattr(ai_failover, "_unavailable_until", {})
    # Some tests import main (which loads .env) during collection. Individual
    # tests explicitly install fake provider credentials after this fixture.
    for key in tuple(os.environ):
        if key.startswith(("QWEN_", "DASHSCOPE_")) or key in {"AI_PROVIDER", "AI_FALLBACK_ENABLED"}:
            monkeypatch.delenv(key, raising=False)
