"""认证业务逻辑 —— 验证码校验 / Token 签发 / 用户查询。

从 router 层抽离，方便单元测试和后期扩展。
"""

import hashlib
import logging
import os
import random
import time

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import User, Token
from app.redis import get_redis

logger = logging.getLogger("auth_service")

TOKEN_TTL = 15 * 24 * 3600  # 15 天


# ══════════════════════════════════════════════════════════════
# 验证码
# ══════════════════════════════════════════════════════════════

async def verify_code(email: str, code: str) -> None:
    """校验验证码，不通过抛 HTTPException。通过后自动清除。"""
    from fastapi import HTTPException

    redis = await get_redis()
    code_key = f"code:{email}"
    stored = await redis.get(code_key)
    if not stored:
        raise HTTPException(401, "验证码无效或已过期，请重新获取")
    if stored != code:
        raise HTTPException(401, "验证码错误")

    await redis.delete(code_key, f"code:{email}:cooldown")


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
        if not user.remaining_seconds:
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
    await db.commit()
    await db.refresh(user)
    logger.info("新用户自动注册: %s", email)
    return user, True


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
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
        return dk.hex() == dk_hex
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
        select(Token).where(Token.token_hash == token_hash)
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
