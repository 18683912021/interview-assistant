"""SQLAlchemy 数据库模型。"""

import uuid
from datetime import datetime, timezone
import time as _time
from sqlalchemy import Integer, String, Float, Text, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    membership: Mapped[str] = mapped_column(String(50), default="高级会员", nullable=False)
    remaining_seconds: Mapped[int] = mapped_column(Integer, default=86400, nullable=False)
    expires_at: Mapped[float] = mapped_column(Float, default=lambda: _time.time() + 86400, nullable=False)
    programming_language: Mapped[str] = mapped_column(String(50), default="javascript", nullable=False)
    interview_language: Mapped[str] = mapped_column(String(10), default="zh", nullable=False)
    interview_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    answer_style: Mapped[str] = mapped_column(String(50), default="标准书面", nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=_utcnow, onupdate=_utcnow)

    @property
    def avatar(self) -> str:
        return "👨‍💻"


class Resume(Base):
    __tablename__ = "resumes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    intro: Mapped[str] = mapped_column(nullable=False)
    filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=_utcnow, onupdate=_utcnow)


class Token(Base):
    __tablename__ = "tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    expires_at: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)

    __table_args__ = (
        Index("ix_tokens_expires", "expires_at"),
    )


class Interview(Base):
    __tablename__ = "interviews"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    started_at: Mapped[float] = mapped_column(Float, nullable=False)
    ended_at: Mapped[float] = mapped_column(Float, nullable=False)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    programming_language: Mapped[str] = mapped_column(String(50), default="javascript")
    conversation_json: Mapped[str] = mapped_column(Text, nullable=False)  # JSON serialized
    created_at: Mapped[datetime] = mapped_column(default=_utcnow)
