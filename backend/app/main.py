import logging
import sys
import traceback
from pathlib import Path

from dotenv import load_dotenv

# 自动加载项目自身的 .env（poc-audio-capture/.env）
_env_path = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(_env_path)

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.routers.audio import router as audio_router
from app.routers.auth import router as auth_router
from app.routers.interview import router as interview_router
from app.routers.resume import router as resume_router
from app.routers.stt import router as stt_router
from app.routers.tools import router as tools_router
from app.db import init_db, close_db
from app.redis import close_redis

# 日志：DEBUG 级别，打印到 stderr，方便在终端直接看到
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s | %(levelname)-5s | %(name)s | %(message)s",
    stream=sys.stderr,
)

# 抑制过于啰嗦的第三方库日志
logging.getLogger("websockets").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("hpack").setLevel(logging.WARNING)
logging.getLogger("stt_streaming").setLevel(logging.INFO)

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

app = FastAPI(title="POC Audio Capture — BE", version="0.4.0")


@app.on_event("startup")
async def _startup():
    await init_db()
    logger.info("数据库 + Redis 已就绪")


@app.on_event("shutdown")
async def _shutdown():
    await close_db()
    await close_redis()
    logger.info("数据库 + Redis 已关闭")


@app.exception_handler(Exception)
async def _unhandled_error(request: Request, exc: Exception):
    logger.exception("请求异常: %s %s", request.method, request.url)
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
    )


app.include_router(audio_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(interview_router, prefix="/api")
app.include_router(resume_router, prefix="/api")
app.include_router(stt_router, prefix="/api")
app.include_router(tools_router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.4.0"}
