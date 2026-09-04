"""Redis 客户端 —— 验证码存储（带 TTL 自动过期）。

生产环境：Redis 服务（REDIS_URL）
本地开发：内存 dict（LOCAL_DEV=true，服务重启丢失，可接受）
"""

import os
import time

LOCAL_DEV = os.getenv("LOCAL_DEV", "").lower() in ("1", "true", "yes")

if LOCAL_DEV:
    # ── 本地开发：内存 dict 模拟 Redis ──
    _store: dict[str, tuple[str, float]] = {}  # { key: (value, expires_at) }

    class _FakeRedis:
        """仅实现 auth.py 用到的三个方法：get / set ex / delete + set nx ex"""

        async def get(self, key: str) -> str | None:
            entry = _store.get(key)
            if entry is None:
                return None
            value, expires_at = entry
            if time.time() > expires_at:
                _store.pop(key, None)
                return None
            return value

        async def set(self, key: str, value: str, ex: int = 0, nx: bool = False) -> bool:
            if nx and key in _store:
                entry = _store.get(key)
                if entry:
                    _, expires_at = entry
                    if time.time() <= expires_at:
                        return False
            _store[key] = (value, time.time() + ex)
            return True

        async def delete(self, *keys: str) -> None:
            for k in keys:
                _store.pop(k, None)

        async def ttl(self, key: str) -> int:
            entry = _store.get(key)
            if entry is None:
                return -2
            _, expires_at = entry
            remaining = int(expires_at - time.time())
            return max(0, remaining)

        async def aclose(self) -> None:
            _store.clear()

    _fake: _FakeRedis | None = None

    async def get_redis():
        global _fake
        if _fake is None:
            _fake = _FakeRedis()
        return _fake

    async def close_redis():
        global _fake
        if _fake:
            await _fake.aclose()
            _fake = None

else:
    # ── 生产环境：真实 Redis ──
    import redis.asyncio as aioredis

    REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

    _pool: aioredis.ConnectionPool | None = None
    _client: aioredis.Redis | None = None

    async def get_redis():
        global _pool, _client
        if _client is None:
            _pool = aioredis.ConnectionPool.from_url(REDIS_URL, max_connections=20, decode_responses=True)
            _client = aioredis.Redis.from_pool(_pool)
        return _client

    async def close_redis():
        global _pool, _client
        if _client:
            await _client.aclose()
            _client = None
        if _pool:
            await _pool.disconnect()
            _pool = None
