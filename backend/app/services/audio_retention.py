"""Opt-in retention for ended sessions only. Transcripts and answer records are untouched."""
import asyncio
import json
import logging
import time
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool
from app.db import async_session
from app.models.db_models import WorkspaceInterview, WorkspaceSettings
from app.services.workspace_media import delete_session_media

logger = logging.getLogger(__name__)


async def cleanup_once(sessions=async_session, now=None):
    now = time.time() if now is None else now
    async with sessions() as db:
        owners = (await db.execute(select(WorkspaceSettings.owner_email, WorkspaceSettings.settings_json))).all()
    for email, settings in owners:
        days = json.loads(settings).get("audio_retention_days", 0)
        if days not in (7, 30):
            continue
        async with sessions() as db:
            # Summary JSON avoids pulling full conversation/resume snapshots into cleanup.
            rows = (await db.execute(select(WorkspaceInterview.id, WorkspaceInterview.summary_json)
                .where(WorkspaceInterview.owner_email == email, WorkspaceInterview.status == "completed"))).all()
        for identifier, summary in rows:
            ended = json.loads(summary or "{}").get("ended_at")
            if not isinstance(ended, (int, float)) or ended <= 0 or ended / 1000 > now - days * 86400:
                continue
            try:
                await run_in_threadpool(delete_session_media, email, identifier)
            except OSError:
                logger.warning("Could not remove expired audio for interview %s", identifier)


async def retention_loop():
    while True:
        try:
            await cleanup_once()
        except Exception:
            logger.exception("Audio retention sweep failed")
        await asyncio.sleep(3600)
