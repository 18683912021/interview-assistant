"""简历服务：PDF 解析 → LLM 生成自我介绍 → 按用户存 PostgreSQL。

每个用户独立存储，不共享。
"""

import logging
from datetime import datetime, timezone
from io import BytesIO
from typing import Optional

import pdfplumber
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db_models import Resume
from app.services.llm_service import LLMService

logger = logging.getLogger("resume")


def _build_self_intro_prompt(resume_text: str, track_key: str | None = None) -> str:
    track_extra = ""
    if track_key:
        from app.services.tracks import get_track
        track = get_track(track_key)
        if track and track.get("resume_intro_extra"):
            track_extra = "\n" + track["resume_intro_extra"]

    return f"""你是一位资深面试辅导专家。请根据以下简历内容，为候选人撰写一段面试开场用的自我介绍。{track_extra}

要求：
1. 时长约 1-2 分钟（200-350 字）
2. 采用标准书面正式用语，专业、流畅
3. 结构：基本信息 → 教育背景 → 核心技术栈 → 主要项目/工作经验亮点 → 求职意向与优势
4. 语言精炼，突出与应聘方向相关的关键技能和成果
5. 自然口语化但不失专业性，像真实的面试自我介绍
6. 不要编造简历中没有的内容
7. 不要使用 markdown 格式

简历内容：
{resume_text}

请直接输出自我介绍文本，不需要任何前缀说明。"""


def parse_pdf(file_bytes: bytes) -> str:
    text_parts: list[str] = []
    with pdfplumber.open(BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
    return "\n\n".join(text_parts).strip()


async def generate_intro(resume_text: str, track_key: str | None = None) -> str:
    llm = LLMService()
    if not llm.ready:
        raise RuntimeError("LLM API Key 未配置，无法生成自我介绍")

    prompt = _build_self_intro_prompt(resume_text, track_key)
    full_text: str = ""

    async for chunk, is_final in llm.stream_answer(
        prompt, model="deepseek-v4-flash", max_tokens=800, language="zh",
    ):
        full_text += chunk

    return full_text.strip()


async def save_resume(db: AsyncSession, email: str, intro: str, filename: str = "") -> Resume:
    """保存或更新用户的自我介绍。"""
    result = await db.execute(select(Resume).where(Resume.email == email))
    row = result.scalar_one_or_none()
    if row:
        row.intro = intro
        row.filename = filename
    else:
        row = Resume(email=email, intro=intro, filename=filename)
        db.add(row)
    await db.commit()
    await db.refresh(row)
    logger.info("简历已保存: %s", email)
    return row


async def get_resume(db: AsyncSession, email: str) -> Resume | None:
    result = await db.execute(select(Resume).where(Resume.email == email))
    return result.scalar_one_or_none()


async def has_resume(db: AsyncSession, email: str) -> bool:
    result = await db.execute(select(Resume).where(Resume.email == email))
    return result.scalar_one_or_none() is not None
