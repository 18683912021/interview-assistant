import logging
import os
import sys
import traceback
from pathlib import Path

from dotenv import load_dotenv

# 自动加载项目自身的 .env（poc-audio-capture/.env）
_env_path = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(_env_path)

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.routers.audio import router as audio_router
from app.routers.auth import router as auth_router
from app.routers.interview import router as interview_router
from app.routers.resume import router as resume_router
from app.routers.workspace import router as workspace_router
from app.routers.diagnostics import router as diagnostics_router
from app.services.ai_diagnostics import ai_chain_status
from app.db import init_db, close_db
from app.redis import close_redis
from app.logging_config import configure_logging

# Production defaults to INFO; enable DEBUG explicitly for diagnostics.
configure_logging(os.getenv("LOG_LEVEL", "INFO"))

logger = logging.getLogger("main")

# 全局未捕获异常处理
def _global_exception_handler(exc_type, exc_value, exc_tb):
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_tb)
        return
    logging.critical(
        "未捕获异常:\n%s",
        "".join(traceback.format_exception(exc_type, exc_value, exc_tb)),
    )

sys.excepthook = _global_exception_handler

app = FastAPI(title="Interview Workspace", version="0.5.0")
# Packaged Electron loads file:// (Origin: null). Requests authenticate with
# explicit Bearer tokens; cross-origin cookie credentials are not enabled.
_allowed_origins = [origin.strip() for origin in os.getenv(
    "CORS_ORIGINS", "null,http://localhost:5173,http://127.0.0.1:5173"
).split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.on_event("startup")
async def _startup():
    await init_db()
    import asyncio
    from app.services.audio_retention import retention_loop
    app.state.audio_retention = asyncio.create_task(retention_loop())
    logger.info("数据库 + Redis 已就绪")


@app.on_event("shutdown")
async def _shutdown():
    import asyncio
    task = getattr(app.state, "audio_retention", None)
    if task:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
    from app.services.llm_service import close_workspace_answers
    await close_workspace_answers()
    await close_db()
    await close_redis()
    logger.info("数据库 + Redis 已关闭")


@app.exception_handler(Exception)
async def _unhandled_error(request: Request, exc: Exception):
    logger.exception("请求异常: %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "服务暂时无法处理请求，请稍后重试"},
    )


app.include_router(audio_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(interview_router, prefix="/api")
app.include_router(resume_router, prefix="/api")
app.include_router(workspace_router, prefix="/api")
app.include_router(diagnostics_router, prefix="/api")


@app.get("/health")
async def health():
    # Liveness never calls a provider; authenticated diagnostics checks readiness.
    status = ai_chain_status()
    return {"status": "ok", "version": "0.5.0", "ai": {
        "configured": status["configured"], "reason_code": status["reason_code"],
    }}
