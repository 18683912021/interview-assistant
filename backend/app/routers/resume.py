"""简历相关接口 —— 按用户隔离存储。"""

import logging

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.routers.auth import get_current_user
from app.services.workspace_requests import request_completion
from app.services.resume_service import (
    generate_intro,
    get_resume,
    has_resume,
    parse_pdf,
    save_resume,
)

logger = logging.getLogger("resume")
router = APIRouter()


@router.post("/resume/upload")
async def upload_resume(
    request: Request,
    file: UploadFile = File(...),
    email: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """上传 PDF 简历，解析并生成自我介绍（仅当前用户可见）。"""
    content_type = file.content_type or ""
    filename = (file.filename or "").lower()
    if not ("pdf" in content_type or filename.endswith(".pdf")):
        raise HTTPException(400, "仅支持 PDF 格式")

    content = await file.read(10 * 1024 * 1024 + 1)
    if len(content) == 0:
        raise HTTPException(400, "文件为空")
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "文件过大（不超过 10MB）")

    try:
        await db.rollback()
        resume_text = await run_in_threadpool(parse_pdf, content)
    except Exception:
        logger.exception("PDF 解析失败")
        raise HTTPException(422, "无法解析 PDF，请使用有效的文字版简历（最多 100 页、100000 字符）")

    if not resume_text.strip():
        raise HTTPException(422, "PDF 中未提取到文字，请确保不是扫描版图片")

    logger.info("PDF 解析成功，文本长度: %d", len(resume_text))

    try:
        intro = await request_completion(request, lambda _system, _user: generate_intro(resume_text), "", "")
    except HTTPException:
        raise
    except Exception:
        logger.exception("自我介绍生成失败")
        raise HTTPException(502, "自我介绍暂时无法生成，请稍后重试")

    row = await save_resume(db, email, intro, file.filename or "")

    return {
        "ok": True,
        "intro": intro,
        "generated_at": row.created_at.isoformat(),
        "filename": file.filename,
    }


@router.get("/resume/intro")
async def get_intro(
    email: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取当前用户的自我介绍。"""
    row = await get_resume(db, email)
    if not row:
        return {"ok": True, "intro": None}
    return {
        "ok": True,
        "intro": row.intro,
        "filename": row.filename or "",
        "generated_at": row.created_at.isoformat(),
    }


@router.get("/resume/has")
async def check_intro(
    email: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """检查当前用户是否已上传简历。"""
    return {"ok": True, "has_intro": await has_resume(db, email)}
