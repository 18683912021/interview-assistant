from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.routers.auth import get_current_user
from app.services.ai_config import load_ai_config
from app.services.ai_diagnostics import ai_status, probe_ai

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])


@router.get("/ai")
async def diagnose_ai(scope: Literal["live", "workspace"] = "live", probe: bool = True,
                      email: str = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await db.rollback()
    config = load_ai_config(workspace=scope == "workspace")
    return await probe_ai(config) if probe else ai_status(config)
