"""数据库 —— SQLAlchemy 异步引擎 + 会话管理。

生产环境：PostgreSQL（DATABASE_URL 指向 Docker 服务）
本地开发：SQLite（LOCAL_DEV=true，零依赖，文件存项目 data/ 目录）
"""

import os
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

LOCAL_DEV = os.getenv("LOCAL_DEV", "").lower() in ("1", "true", "yes")

if LOCAL_DEV:
    _db_path = Path(__file__).resolve().parents[1] / "data" / "dev.db"
    _db_path.parent.mkdir(parents=True, exist_ok=True)
    DATABASE_URL = f"sqlite+aiosqlite:///{_db_path}"
    _engine_kw = dict(echo=False)
else:
    DATABASE_URL = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://ai_interview:ai_interview_pwd@db:5432/ai_interview",
    )
    _engine_kw = dict(echo=False, pool_size=10, max_overflow=20)

engine = create_async_engine(DATABASE_URL, **_engine_kw)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    """FastAPI 依赖注入：每个请求一个数据库会话。"""
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """启动时创建所有表。"""
    async with engine.begin() as conn:
        from app.models.db_models import Interview, Resume, Token, User  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)


async def close_db():
    """关闭时释放连接池。"""
    await engine.dispose()
