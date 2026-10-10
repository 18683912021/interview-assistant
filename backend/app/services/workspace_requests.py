"""Bound long preparation requests and avoid duplicate review generation."""
import asyncio
import secrets
from contextlib import asynccontextmanager

from fastapi import HTTPException, Request

from app.redis import get_redis


async def request_completion(request: Request, completion, system: str, user: str) -> str:
    """Cancel the outgoing HTTP operation when its caller disconnects."""
    task = asyncio.create_task(completion(system, user))
    try:
        while not task.done():
            if await request.is_disconnected():
                raise HTTPException(499, "请求已取消")
            await asyncio.wait({task}, timeout=0.25)
        return await task
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@asynccontextmanager
async def review_lease(identifier):
    redis = await get_redis()
    key = f"workspace:review:{identifier}"
    token = secrets.token_hex(16)
    if not await redis.set(key, token, nx=True, ex=125):
        raise HTTPException(409, "复盘正在生成，请稍后刷新")
    try:
        yield
    finally:
        # Compare-and-delete prevents an expired caller from releasing a later
        # worker's lease. The development fake has non-yielding get/delete.
        if hasattr(redis, "eval"):
            await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token)
        elif await redis.get(key) == token:
            await redis.delete(key)
