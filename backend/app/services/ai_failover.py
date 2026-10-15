"""Short process-local cooldown after transient upstream failures.

No background requests or parallel paid generations. Both unhealthy providers
remain callable so a recovered service can answer even during its cooldown.
"""
import hashlib
import time

from app.services.ai_config import AIConfig

COOLDOWN_SECONDS = 30.0
_unavailable_until: dict[tuple[str, str, str, bytes], float] = {}


def _key(config: AIConfig) -> tuple[str, str, str, bytes]:
    # Credentials never appear in logs or cache keys in plaintext. A rotated
    # credential/model starts fresh rather than inheriting the previous failure.
    return (config.provider, config.base_url, config.model,
            hashlib.sha256(config.api_key.encode()).digest())


def prioritize_available(configs: tuple[AIConfig, ...]) -> tuple[AIConfig, ...]:
    now = time.monotonic()
    for key, until in tuple(_unavailable_until.items()):
        if until <= now:
            _unavailable_until.pop(key, None)
    # Stable sorting keeps the configured primary first when both are healthy
    # or both are unavailable. No service is permanently excluded.
    return tuple(sorted(configs, key=lambda config: _unavailable_until.get(_key(config), 0) > now))


def mark_unavailable(config: AIConfig) -> None:
    _unavailable_until[_key(config)] = time.monotonic() + COOLDOWN_SECONDS


def mark_available(config: AIConfig) -> None:
    _unavailable_until.pop(_key(config), None)
