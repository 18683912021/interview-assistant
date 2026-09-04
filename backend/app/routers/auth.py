"""邮箱验证码认证接口。

POST /api/auth/send-code       发送验证码
POST /api/auth/check-email     检查邮箱是否已注册
POST /api/auth/login           验证码登录
POST /api/auth/register        验证码注册
POST /api/auth/verify          验证 token 有效性
GET  /api/auth/status          邮件服务状态
"""

import logging
import os
import random
import smtplib
import string

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.db_models import User
from app.redis import get_redis
from app.services.email_service import send_code_email, get_smtp_config
from app.services.auth_service import (
    verify_code,
    get_or_create_user,
    get_user_by_email,
    hash_password,
    verify_password,
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
class SendCodeRequest(BaseModel):
    email: str

class LoginRequest(BaseModel):
    email: str
    code: str

class RegisterRequest(BaseModel):
    email: str
    code: str
    password: str

class PasswordLoginRequest(BaseModel):
    email: str
    password: str

class VerifyRequest(BaseModel):
    token: str


def _generate_code() -> str:
    return "".join(random.choices(string.digits, k=CODE_LENGTH))


def _is_dev() -> bool:
    return os.getenv("ENV", "").lower() not in ("prod", "production")


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
    cooldown_key = f"code:{email}:cooldown"

    is_first = await redis.set(cooldown_key, "1", nx=True, ex=RESEND_COOLDOWN)
    if not is_first:
        ttl = await redis.ttl(cooldown_key)
        raise HTTPException(429, f"发送过于频繁，请 {max(1, ttl)} 秒后再试")

    code_key = f"code:{email}"
    code = await redis.get(code_key) or _generate_code()

    try:
        await send_code_email(email, code)
    except smtplib.SMTPAuthenticationError:
        await redis.delete(cooldown_key)
        logger.exception("SMTP 认证失败")
        raise HTTPException(500, "邮件服务认证失败，请检查邮箱配置")
    except (smtplib.SMTPException, RuntimeError) as e:
        await redis.delete(cooldown_key)
        logger.exception("邮件发送失败")
        raise HTTPException(500, f"邮件发送失败：{e}")

    await redis.set(code_key, code, ex=CODE_TTL)
    logger.info("验证码已发送至 %s（%s）", email, code if _is_dev() else "******")
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

    await verify_code(email, code)
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

    user = await get_user_by_email(db, email)
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

    await verify_code(email, code)

    user = await get_user_by_email(db, email)
    if user:
        user.password_hash = hash_password(password)
    else:
        user = User(email=email, password_hash=hash_password(password))
        db.add(user)
    await db.commit()
    await db.refresh(user)

    token_str, expires_at = await create_token(db, email)
    logger.info("用户注册成功: %s", email)
    return {
        "ok": True, "token": token_str, "email": email,
        "expires_in": TOKEN_TTL, "expires_at": expires_at,
    }


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
    token = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not token:
        raise HTTPException(401, "未提供认证信息")
    email = await verify_token(db, token)
    if not email:
        raise HTTPException(401, "token 无效或已过期，请重新登录")
    return email


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
    programming_language: str | None = None
    interview_language: str | None = None


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
    if body.programming_language is not None:
        user.programming_language = body.programming_language
    if body.interview_language is not None:
        user.interview_language = body.interview_language
    await db.commit()
    await db.refresh(user)
    return {"ok": True, "user": user_to_profile(user)}
