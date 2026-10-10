"""Explicit provider selection; keep Volcengine available for operator rollback."""
import os
import asyncio

from app.services.stt_streaming import StreamingASRSession
from app.services.stt_tencent import TencentASRSession


def configured_provider() -> str:
    provider = os.getenv("ASR_PROVIDER", "volcengine").strip().lower()
    if provider not in {"volcengine", "tencent"}:
        raise ValueError("ASR_PROVIDER must be volcengine or tencent")
    return provider


def asr_ready() -> bool:
    names = ("TENCENT_ASR_APP_ID", "TENCENT_ASR_SECRET_ID", "TENCENT_ASR_SECRET_KEY") if configured_provider() == "tencent" else ("VOLC_API_KEY",)
    return all(os.getenv(name, "").strip() for name in names)


def create_asr_session(source: str, queue: asyncio.Queue) -> StreamingASRSession:
    if configured_provider() == "tencent":
        return TencentASRSession(source, queue)
    return StreamingASRSession(os.getenv("VOLC_API_KEY", ""), source, queue)
