"""面试历史接口。"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import desc, select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.db_models import Interview
from app.routers.auth import get_current_user

logger = logging.getLogger("interview")
router = APIRouter()


class SaveInterviewRequest(BaseModel):
    started_at: float
    ended_at: float
    duration_seconds: int
    programming_language: str
    conversation: list[dict]  # [{id, role, text, status, timestamp}]


class InterviewListItem(BaseModel):
    id: str
    started_at: float
    duration_seconds: int
    programming_language: str
    message_count: int


@router.post("/interview/save")
async def save_interview(
    body: SaveInterviewRequest,
    email: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """保存面试记录（含完整对话）。"""
    row = Interview(
        email=email,
        started_at=body.started_at,
        ended_at=body.ended_at,
        duration_seconds=body.duration_seconds,
        programming_language=body.programming_language,
        conversation_json=json.dumps(body.conversation, ensure_ascii=False),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    logger.info("面试记录已保存: %s, %ds, %d 条对话", email, body.duration_seconds, len(body.conversation))
    return {"ok": True, "id": str(row.id)}


@router.get("/interview/list")
async def interview_list(
    email: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """面试历史列表（摘要，不含对话内容）。"""
    result = await db.execute(
        select(Interview)
        .where(Interview.email == email)
        .order_by(desc(Interview.created_at))
    )
    rows = result.scalars().all()
    return [
        {
            "id": str(r.id),
            "started_at": r.started_at,
            "duration_seconds": r.duration_seconds,
            "programming_language": r.programming_language,
            "message_count": _count_messages(r.conversation_json),
        }
        for r in rows
    ]


@router.get("/interview/{interview_id}")
async def interview_detail(
    interview_id: str,
    email: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """单条面试详情（含完整对话）。"""
    import uuid as _uuid
    try:
        uid = _uuid.UUID(interview_id)
    except ValueError:
        raise HTTPException(400, "无效的面试 ID")

    result = await db.execute(
        select(Interview).where(Interview.id == uid, Interview.email == email)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "面试记录不存在")

    conversation = json.loads(row.conversation_json)
    return {
        "id": str(row.id),
        "started_at": row.started_at,
        "ended_at": row.ended_at,
        "duration_seconds": row.duration_seconds,
        "programming_language": row.programming_language,
        "conversation": conversation,
    }


@router.delete("/interview/clear")
async def clear_history(
    email: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """清除当前用户所有面试历史。"""
    result = await db.execute(
        delete(Interview).where(Interview.email == email)
    )
    await db.commit()
    count = result.rowcount
    logger.info("用户 %s 清除了 %d 条面试记录", email, count)
    return {"ok": True, "deleted": count}


def _count_messages(conversation_json: str) -> int:
    try:
        return len(json.loads(conversation_json))
    except Exception:
        return 0
