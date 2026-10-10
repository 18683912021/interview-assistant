"""邮箱验证码认证接口。

POST /api/auth/send-code       发送验证码
POST /api/auth/check-email     检查邮箱是否已注册
POST /api/auth/login           验证码登录
POST /api/auth/register        验证码注册
POST /api/auth/verify          验证 token 有效性
GET  /api/auth/status          邮件服务状态
"""

import logging
import hashlib
import secrets
import re
import smtplib
import string
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.db_models import User, Token
from app.redis import get_redis
from app.services.email_service import send_code_email, get_smtp_config
from app.services.auth_service import (
    verify_code,
    get_or_create_user,
    get_user_by_email,
    hash_password,
    verify_password,
    password_attempt,
    create_token,
    verify_token,
    user_to_profile,
    TOKEN_TTL,
)

logger = logging.getLogger("auth")
router = APIRouter()

CODE_LENGTH = 6
CODE_TTL = 300
RESEND_COOLDOWN = 30


# ── Request models ──
class EmailRequest(BaseModel):
    email: str = Field(max_length=255)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value) or len(value.split("@")[0]) > 64:
            raise ValueError("请输入有效的邮箱地址")
        return value


class SendCodeRequest(EmailRequest):
    purpose: Literal["login", "register", "reset_password"] = "login"

class LoginRequest(EmailRequest):
    code: str = Field(pattern=r"^[0-9]{6}$")

class RegisterRequest(EmailRequest):
    code: str = Field(pattern=r"^[0-9]{6}$")
    password: str = Field(min_length=6, max_length=128)

class PasswordLoginRequest(EmailRequest):
    password: str = Field(max_length=128)

class VerifyRequest(BaseModel):
    token: str = Field(min_length=1, max_length=256)


def _generate_code() -> str:
    return "".join(secrets.choice(string.digits) for _ in range(CODE_LENGTH))


# ══════════════════════════════════════════════════════════════
# Endpoints
# ══════════════════════════════════════════════════════════════

@router.post("/auth/send-code")
async def send_code(body: SendCodeRequest):
    """发送邮箱验证码（Redis 存储，5 分钟 TTL）。"""
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "请输入有效的邮箱地址")

    cfg = get_smtp_config()
    if not cfg["configured"]:
        raise HTTPException(500, "邮件服务未配置，请联系管理员")

    redis = await get_redis()
    cooldown_key = f"code:{body.purpose}:{email}:cooldown"

    is_first = await redis.set(cooldown_key, "1", nx=True, ex=RESEND_COOLDOWN)
    if not is_first:
        ttl = await redis.ttl(cooldown_key)
        raise HTTPException(429, f"发送过于频繁，请 {max(1, ttl)} 秒后再试")

    code_key = f"code:{body.purpose}:{email}"
    code = _generate_code()

    try:
        await send_code_email(email, code, body.purpose)
    except smtplib.SMTPAuthenticationError:
        await redis.delete(cooldown_key)
        logger.exception("SMTP 认证失败")
        raise HTTPException(500, "邮件服务认证失败，请检查邮箱配置")
    except (smtplib.SMTPException, RuntimeError, OSError):
        await redis.delete(cooldown_key)
        logger.exception("邮件发送失败")
        raise HTTPException(503, "邮件暂时无法发送，请稍后重试")

    await redis.set(code_key, code, ex=CODE_TTL)
    await redis.delete(f"{code_key}:attempts")
    logger.info("邮箱验证码已发送，用途=%s", body.purpose)
    return {"ok": True, "message": "验证码已发送", "cooldown": RESEND_COOLDOWN}


@router.post("/auth/check-email")
async def check_email(body: SendCodeRequest, db: AsyncSession = Depends(get_db)):
    """检查邮箱是否已注册。"""
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "请输入有效的邮箱地址")
    user = await get_user_by_email(db, email)
    return {"ok": True, "exists": user is not None}


@router.post("/auth/login")
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    """验证码登录。返回 token，15 天有效。"""
    email = body.email.strip().lower()
    code = body.code.strip()

    if not email or not code:
        raise HTTPException(400, "邮箱和验证码不能为空")

    await verify_code(email, code, "login")
    user, is_new = await get_or_create_user(db, email)
    token_str, expires_at = await create_token(db, email)

    logger.info("用户登录成功: %s（新用户=%s）", email, is_new)
    return {
        "ok": True, "token": token_str, "email": email,
        "is_new": is_new, "expires_in": TOKEN_TTL, "expires_at": expires_at,
    }


@router.post("/auth/login-password")
async def login_password(body: PasswordLoginRequest, db: AsyncSession = Depends(get_db)):
    """密码登录。返回 token，15 天有效。"""
    email = body.email.strip().lower()
    password = body.password

    if not email or not password:
        raise HTTPException(400, "邮箱和密码不能为空")

    async with password_attempt(email):
        user = await get_user_by_email(db, email, for_update=True)
        if not user or not user.password_hash:
            raise HTTPException(401, "该邮箱未注册，请先注册")
        if not verify_password(password, user.password_hash):
            raise HTTPException(401, "密码错误")
        token_str, expires_at = await create_token(db, email)
    logger.info("用户密码登录成功: %s", email)
    return {
        "ok": True, "token": token_str, "email": email,
        "expires_in": TOKEN_TTL, "expires_at": expires_at,
    }


@router.post("/auth/register")
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """验证码注册（带密码）。返回 token，15 天有效。"""
    email = body.email.strip().lower()
    code = body.code.strip()
    password = body.password

    if not email or not code:
        raise HTTPException(400, "邮箱和验证码不能为空")
    if not password or len(password) < 6:
        raise HTTPException(400, "密码至少 6 位")

    user = await get_user_by_email(db, email)
    if user:
        raise HTTPException(409, "该邮箱已注册，请登录或找回密码")
    await verify_code(email, code, "register")
    user = User(email=email, name=email.split("@")[0], password_hash=hash_password(password))
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "该邮箱已注册，请登录或找回密码")
    await db.refresh(user)

    token_str, expires_at = await create_token(db, email)
    logger.info("用户注册成功: %s", email)
    return {
        "ok": True, "token": token_str, "email": email,
        "expires_in": TOKEN_TTL, "expires_at": expires_at,
    }


@router.post("/auth/reset-password")
async def reset_password(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    email = body.email.strip().lower()
    await verify_code(email, body.code.strip(), "reset_password")
    user = await get_user_by_email(db, email, for_update=True)
    if not user:
        raise HTTPException(404, "账号不存在，请先注册")
    user.password_hash = hash_password(body.password)
    # Password recovery invalidates all previously issued sessions.
    await db.execute(delete(Token).where(Token.email == email))
    await db.commit()
    redis = await get_redis()
    await redis.delete(f"password:{email}:attempts")
    return {"ok": True}


@router.post("/auth/verify")
async def verify(body: VerifyRequest, db: AsyncSession = Depends(get_db)):
    """验证 token 是否有效。"""
    email = await verify_token(db, body.token.strip())
    if not email:
        raise HTTPException(401, "token 无效或已过期，请重新登录")
    return {"ok": True, "email": email}


class DeductTimeRequest(BaseModel):
    seconds: int


@router.get("/auth/status")
async def auth_status():
    """返回邮件服务配置状态。"""
    cfg = get_smtp_config()
    return {"ok": True, "email_enabled": cfg["configured"]}


# ══════════════════════════════════════════════════════════════
# Auth dependency（供其他路由获取当前用户）
# ══════════════════════════════════════════════════════════════

async def get_current_user(
    authorization: str = Header(default=""),
    db: AsyncSession = Depends(get_db),
) -> str:
    """从 Authorization: Bearer <token> 头校验用户，返回 email。"""
    scheme, _, token = authorization.partition(" ")
    token = token.strip() if scheme.lower() == "bearer" else ""
    if not token:
        raise HTTPException(401, "未提供认证信息")
    email = await verify_token(db, token)
    if not email:
        raise HTTPException(401, "token 无效或已过期，请重新登录")
    return email


@router.post("/auth/logout")
async def logout(
    authorization: str = Header(default=""),
    email: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    token = authorization.partition(" ")[2].strip()
    await db.execute(delete(Token).where(
        Token.email == email,
        Token.token_hash == hashlib.sha256(token.encode()).hexdigest(),
    ))
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# 用户接口
# ══════════════════════════════════════════════════════════════

@router.post("/user/deduct-time")
async def deduct_time(
    body: DeductTimeRequest,
    email: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """扣除面试时长。"""
    if body.seconds <= 0:
        raise HTTPException(400, "无效的时长")
    user = await get_user_by_email(db, email)
    if not user:
        raise HTTPException(404, "用户不存在")
    user.remaining_seconds = max(0, user.remaining_seconds - body.seconds)
    user.interview_count += 1
    await db.commit()
    await db.refresh(user)
    logger.info("用户 %s 扣除 %d 秒，剩余 %d 秒，累计 %d 次", email, body.seconds, user.remaining_seconds, user.interview_count)
    return {"ok": True, "user": user_to_profile(user)}


@router.get("/user/profile")
async def get_profile(
    email: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取用户信息。"""
    user = await get_user_by_email(db, email)
    if not user:
        raise HTTPException(404, "用户不存在")
    return {"ok": True, "user": user_to_profile(user)}


class UpdateProfileRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    programming_language: str | None = Field(default=None, min_length=1, max_length=50)
    interview_language: Literal["zh", "en", "auto"] | None = None


@router.put("/user/profile")
async def update_profile(
    body: UpdateProfileRequest,
    email: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新用户偏好。"""
    user = await get_user_by_email(db, email)
    if not user:
        raise HTTPException(404, "用户不存在")
    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(422, "昵称不能为空")
        user.name = body.name.strip()
    if body.programming_language is not None:
        user.programming_language = body.programming_language
    if body.interview_language is not None:
        user.interview_language = body.interview_language
    await db.commit()
    await db.refresh(user)
    return {"ok": True, "user": user_to_profile(user)}
