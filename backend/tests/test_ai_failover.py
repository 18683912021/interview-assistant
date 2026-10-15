from dataclasses import replace

from app.services.ai_config import AIConfig
from app.services import ai_failover


def test_cooldown_expires_and_key_rotation_does_not_inherit_failure(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(ai_failover.time, "monotonic", lambda: clock[0])
    primary = AIConfig(api_key="original-key")
    backup = AIConfig(api_key="backup-key", provider="qwen", model="qwen3.8-flash")
    ai_failover.mark_unavailable(primary)
    assert ai_failover.prioritize_available((primary, backup)) == (backup, primary)
    rotated = replace(primary, api_key="new-key")
    assert ai_failover.prioritize_available((rotated, backup)) == (rotated, backup)
    clock[0] += ai_failover.COOLDOWN_SECONDS
    assert ai_failover.prioritize_available((primary, backup)) == (primary, backup)


def test_both_unhealthy_remain_callable_and_success_recovers():
    primary = AIConfig(api_key="primary")
    backup = AIConfig(api_key="backup", provider="qwen")
    ai_failover.mark_unavailable(primary)
    ai_failover.mark_unavailable(backup)
    assert ai_failover.prioritize_available((primary, backup)) == (primary, backup)
    assert ai_failover.prioritize_available((primary,)) == (primary,)
    ai_failover.mark_available(backup)
    assert ai_failover.prioritize_available((primary, backup)) == (backup, primary)
