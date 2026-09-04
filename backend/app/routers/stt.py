"""语音转文字接口。"""

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.services.stt_service import TranscribeResult, transcribe_pcm

router = APIRouter()

# 凭据从环境变量读取，不写死在代码里
APP_ID = os.getenv("VOLC_APP_ID", "")
ACCESS_KEY_ID = os.getenv("VOLC_ACCESS_KEY_ID", "")
SECRET_ACCESS_KEY = os.getenv("VOLC_SECRET_ACCESS_KEY", "")


@router.post("/stt/transcribe", response_model=dict)
async def transcribe_file(pcm_path: str) -> dict:
    """将 PCM 文件送火山引擎 ASR，返回识别文本。

    Args:
        pcm_path: PCM 文件路径（16kHz, 16bit, mono），相对于项目根或绝对路径
    """
    filepath = Path(pcm_path)
    if not filepath.is_absolute():
        # 相对于项目根
        filepath = Path(__file__).resolve().parents[2] / pcm_path
    if not filepath.exists():
        raise HTTPException(status_code=404, detail=f"PCM 文件不存在: {filepath}")
    if not filepath.suffix == ".pcm":
        raise HTTPException(status_code=400, detail="仅支持 .pcm 文件")

    if not APP_ID:
        raise HTTPException(status_code=500, detail="未配置 VOLC_APP_ID 环境变量")
    if not ACCESS_KEY_ID or not SECRET_ACCESS_KEY:
        raise HTTPException(status_code=500, detail="未配置火山引擎 AK/SK 环境变量")

    result: TranscribeResult = await transcribe_pcm(
        str(filepath),
        app_id=APP_ID,
        access_key_id=ACCESS_KEY_ID,
        secret_access_key=SECRET_ACCESS_KEY,
    )
    return {"text": result.text, "duration_ms": result.duration_ms}
