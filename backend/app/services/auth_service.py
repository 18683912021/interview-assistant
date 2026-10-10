"""认证业务逻辑 —— 验证码校验 / Token 签发 / 用户查询。

从 router 层抽离，方便单元测试和后期扩展。
"""

import hashlib
import hmac
import logging
import os
import random
import time
from contextlib import asynccontextmanager

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.models.db_models import User, Token
from app.redis import get_redis

logger = logging.getLogger("auth_service")

TOKEN_TTL = 15 * 24 * 3600  # 15 天


@asynccontextmanager
async def password_attempt(email: str):
    """Bound password guesses per account, including concurrent requests."""
    from fastapi import HTTPException
    redis = await get_redis()
    key = f"password:{email}:attempts"
    lock = f"password:{email}:lock"
    token = os.urandom(16).hex()
    if not await redis.set(lock, token, nx=True, ex=15):
        raise HTTPException(429, "登录验证中，请稍后重试")
    try:
        attempts = int(await redis.get(key) or 0)
        if attempts >= 5:
            raise HTTPException(429, "密码尝试过多，请 5 分钟后重试或通过邮箱重置密码")
        try:
            yield
        except HTTPException as error:
            if error.status_code == 401:
                await redis.set(key, str(attempts + 1), ex=300)
            raise
        else:
            await redis.delete(key)
    finally:
        if hasattr(redis, "eval"):
            await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lock, token)
        elif await redis.get(lock) == token:
            await redis.delete(lock)


# ══════════════════════════════════════════════════════════════
# 验证码
# ══════════════════════════════════════════════════════════════

async def verify_code(email: str, code: str, purpose: str = "login") -> None:
    """校验验证码，不通过抛 HTTPException。通过后自动清除。"""
    from fastapi import HTTPException

    redis = await get_redis()
    code_key = f"code:{purpose}:{email}"
    # A distributed lock makes one-time consumption and attempt accounting atomic
    # across API workers without a different local-development Redis contract.
    lock_key = f"{code_key}:verify-lock"
    if not await redis.set(lock_key, "1", nx=True, ex=10):
        raise HTTPException(429, "验证中，请稍后重试")
    try:
        attempts_key = f"{code_key}:attempts"
        attempts = int(await redis.get(attempts_key) or 0)
        if attempts >= 5:
            raise HTTPException(429, "尝试次数过多，请重新获取验证码")
        stored = await redis.get(code_key)
        if not stored:
            raise HTTPException(401, "验证码无效或已过期，请重新获取")
        if not hmac.compare_digest(stored, code):
            await redis.set(attempts_key, str(attempts + 1), ex=300)
            raise HTTPException(401, "验证码错误")
        await redis.delete(code_key, attempts_key)
    finally:
        await redis.delete(lock_key)


# ══════════════════════════════════════════════════════════════
# 用户
# ══════════════════════════════════════════════════════════════

async def get_or_create_user(db: AsyncSession, email: str) -> tuple[User, bool]:
    """查用户，不存在则创建。返回 (user, is_new)。"""
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user:
        # 老用户补全默认值
        dirty = False
        if not user.name:
            user.name = email.split("@")[0]
            dirty = True
        if not user.membership:
            user.membership = "高级会员"
            dirty = True
        if user.remaining_seconds is None:
            user.remaining_seconds = 86400
            dirty = True
        if not user.expires_at:
            user.expires_at = time.time() + 86400
            dirty = True
        if not user.programming_language:
            user.programming_language = "javascript"
            dirty = True
        if not user.interview_language:
            user.interview_language = "zh"
            dirty = True
        if dirty:
            await db.commit()
            await db.refresh(user)
        return user, False

    name = email.split("@")[0] if "@" in email else email
    user = User(email=email, name=name)
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing = await get_user_by_email(db, email)
        if existing:
            return existing, False
        raise
    await db.refresh(user)
    logger.info("新用户自动注册: %s", email)
    return user, True


async def get_user_by_email(db: AsyncSession, email: str, *, for_update: bool = False) -> User | None:
    query = select(User).where(User.email == email)
    if for_update:
        query = query.with_for_update()
    result = await db.execute(query)
    return result.scalar_one_or_none()


# ══════════════════════════════════════════════════════════════
# 密码
# ══════════════════════════════════════════════════════════════

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100000)
    return salt.hex() + ":" + dk.hex()


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, dk_hex = stored.split(":")
        salt = bytes.fromhex(salt_hex)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100000)
        return hmac.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False


# ══════════════════════════════════════════════════════════════
# Token
# ══════════════════════════════════════════════════════════════

async def create_token(db: AsyncSession, email: str) -> tuple[str, float]:
    """生成 token，写入 DB，返回 (token, expires_at)。"""
    raw = f"{email}:{time.time()}:{os.urandom(8).hex()}"
    token_str = hashlib.sha256(raw.encode()).hexdigest()
    token_hash = hashlib.sha256(token_str.encode()).hexdigest()
    expires_at = time.time() + TOKEN_TTL

    row = Token(token_hash=token_hash, email=email, expires_at=expires_at)
    db.add(row)
    await db.commit()

    # 概率清理过期 token（5%）
    if random.random() < 0.05:
        await db.execute(delete(Token).where(Token.expires_at < time.time()))
        await db.commit()

    return token_str, expires_at


async def verify_token(db: AsyncSession, raw_token: str) -> str | None:
    """验证 token，有效返回 email，无效返回 None。"""
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
    result = await db.execute(
        select(Token).join(User, User.email == Token.email).where(Token.token_hash == token_hash)
    )
    row = result.scalar_one_or_none()
    if not row or time.time() > row.expires_at:
        if row:
            await db.delete(row)
            await db.commit()
        return None
    return row.email


def user_to_profile(user: User) -> dict:
    """将 User 模型转为前端需要的 profile 字典。"""
    return {
        "email": user.email,
        "name": user.name or user.email.split("@")[0],
        "avatar": user.avatar,
        "membership": user.membership,
        "remaining_seconds": user.remaining_seconds,
        "expires_at": user.expires_at,
        "programming_language": user.programming_language,
        "interview_language": user.interview_language,
        "interview_count": user.interview_count,
        "answer_style": user.answer_style,
    }
