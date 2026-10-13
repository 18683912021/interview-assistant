"""Small additive, versioned migrations for the existing deployed database.

No legacy tables are altered or dropped. Run by init_db in the same transaction;
PostgreSQL's advisory lock serializes startup across API workers. Future schema
changes belong in additional numbered migrations, never in an existing one.
"""
import json
import logging
import math
from datetime import timezone
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import Column, DateTime, MetaData, String, Table, insert, select, text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.models.db_models import Interview, User, WorkspaceInterview, WorkspaceInterviewDeletion, WorkspaceJob, WorkspaceResume, WorkspaceResumeDeletion, WorkspaceSettings, _utcnow

_metadata = MetaData()
versions = Table("app_schema_migrations", _metadata,
                 Column("version", String(100), primary_key=True),
                 Column("applied_at", DateTime, nullable=False))


async def _workspace_tables(conn: AsyncConnection) -> None:
    for model in (WorkspaceResume, WorkspaceJob, WorkspaceSettings, WorkspaceInterview):
        await conn.run_sync(lambda sync, table=model.__table__: table.create(sync, checkfirst=True))


def _milliseconds(value, fallback: float) -> float:
    """Legacy session timestamps were seconds; message timestamps were milliseconds."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if not math.isfinite(number) or number <= 0:
        return fallback
    return number * 1000 if number < 100_000_000_000 else number


def _legacy_snapshot(row) -> dict:
    created = row["created_at"].replace(tzinfo=timezone.utc).timestamp() * 1000
    started = _milliseconds(row["started_at"], created)
    ended = _milliseconds(row["ended_at"], 0)
    ended = max(started, ended) if ended else None
    try:
        original = json.loads(row["conversation_json"])
    except (TypeError, ValueError):
        original = []
    if not isinstance(original, list):
        original = []
    conversation, answers = [], []
    identifiers = set()
    preceding = None
    for index, item in enumerate(original):
        if not isinstance(item, dict):
            continue
        # Old clients inserted AI bubbles immediately after the selected source
        # message. Array order, rather than timestamp order, retains that link.
        identifier = str(item.get("id") or uuid5(NAMESPACE_URL, f"legacy:{row['id']}:{index}"))
        if identifier in identifiers:
            identifier = str(uuid5(NAMESPACE_URL, f"legacy:{row['id']}:{index}:{identifier}"))
        identifiers.add(identifier)
        timestamp = _milliseconds(item.get("timestamp"), started)
        content = str(item.get("text") or "")
        if item.get("role") == "ai":
            status = item.get("status", "done")
            if status not in ("done", "error", "cancelled", "truncated"):
                status = "truncated" if content else "cancelled"
            answers.append({
                "id": identifier, "request_id": f"legacy:{identifier}",
                "source_message_ids": [preceding["id"]] if preceding else [],
                "source_revisions": [preceding["revision"]] if preceding else [],
                "question_text": preceding["text"] if preceding else "",
                "text": content, "status": status, "timestamp": timestamp,
                "context_version": 1, "context_snapshot": None,
            })
        else:
            try:
                revision = max(0, int(item.get("revision") or 1))
            except (TypeError, ValueError):
                revision = 1
            preceding = {
                **item, "id": identifier,
                "role": item.get("role") if item.get("role") in ("interviewer", "user") else "interviewer",
                "text": content, "status": str(item.get("status") or "done"),
                "timestamp": timestamp, "revision": revision,
            }
            conversation.append(preceding)
    language = row["programming_language"] or ""
    label = {"javascript": "JavaScript", "typescript": "TypeScript", "python": "Python",
             "java": "Java", "go": "Go", "c++": "C++", "cpp": "C++", "csharp": "C#",
             "rust": "Rust", "swift": "Swift", "kotlin": "Kotlin", "php": "PHP"}.get(language.lower(), language)
    title = f"{label} 历史面试".strip()
    return {
        "id": str(row["id"]), "title": title, "company": "", "role": title,
        "job_description": "", "resume_id": None, "resume_snapshot": None,
        "capture_source": "both", "status": "completed" if ended else "interrupted",
        "started_at": started, "ended_at": ended,
        "duration_seconds": max(0, int(row["duration_seconds"] or 0)),
        "conversation": conversation, "answers": answers,
        "preferences": {"language": row["interview_language"] if row["interview_language"] in ("zh", "en", "auto") else "zh",
                        "answer_length": "standard", "answer_style": "conversational"},
        "revision": 1,
    }


async def _legacy_interviews(conn: AsyncConnection) -> None:
    # A legacy row without an existing account is kept in the original table;
    # inventing an account or attaching it to a different user would be unsafe.
    rows = (await conn.execute(select(Interview.__table__, User.interview_language)
                               .join(User, Interview.email == User.email))).mappings()
    existing = set((await conn.scalars(select(WorkspaceInterview.id))).all())
    count = 0
    for row in rows:
        if row["id"] in existing:
            continue
        await conn.execute(insert(WorkspaceInterview).values(
            id=row["id"], owner_email=row["email"], revision=1,
            snapshot_json=json.dumps(_legacy_snapshot(row), ensure_ascii=False, sort_keys=True),
            created_at=row["created_at"], updated_at=row["created_at"],
        ))
        count += 1
    logging.getLogger(__name__).info("Workspace legacy history migration imported %d records", count)


async def migrate(conn: AsyncConnection) -> None:
    if conn.dialect.name == "postgresql":
        await conn.execute(text("SELECT pg_advisory_xact_lock(739128410)"))
    await conn.run_sync(lambda sync: versions.create(sync, checkfirst=True))
    for version, operation in (("001_workspace_v2", _workspace_tables),
                               ("003_legacy_interview_history", _legacy_interviews),
                               ("004_deleted_workspace_interviews", _deletion_table),
                               ("005_material_kinds_and_history_summaries", _workspace_details),
                               ("006_deleted_material_versions", _resume_deletion_table)):
        if await conn.scalar(select(versions.c.version).where(versions.c.version == version)):
            continue
        await operation(conn)
        await conn.execute(insert(versions).values(version=version, applied_at=_utcnow()))


async def _deletion_table(conn: AsyncConnection) -> None:
    await conn.run_sync(lambda sync: WorkspaceInterviewDeletion.__table__.create(sync, checkfirst=True))


async def _workspace_details(conn: AsyncConnection) -> None:
    from sqlalchemy import inspect, update
    from app.services.workspace_summary import summary_values
    additions = {
        "workspace_resumes": {"kind": "VARCHAR(20) NOT NULL DEFAULT 'resume'"},
        "workspace_interviews": {"summary_json": "TEXT", "search_text": "TEXT", "status": "VARCHAR(20)"},
    }
    for table, fields in additions.items():
        columns = await conn.run_sync(lambda sync: {c["name"] for c in inspect(sync).get_columns(table)})
        for name, definition in fields.items():
            if name not in columns:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {definition}"))
    await conn.execute(update(WorkspaceResume).where(WorkspaceResume.filename.startswith("准备草稿 · "))
                       .values(kind="draft"))
    # Keyset batches bound memory without an asyncpg server-side portal. A portal
    # can keep the relation in use until transaction end, even after result.close().
    last_id = None
    while True:
        query = select(WorkspaceInterview.id, WorkspaceInterview.snapshot_json).order_by(WorkspaceInterview.id).limit(20)
        if last_id is not None:
            query = query.where(WorkspaceInterview.id > last_id)
        rows = (await conn.execute(query)).all()
        if not rows:
            break
        for identifier, snapshot in rows:
            await conn.execute(update(WorkspaceInterview).where(WorkspaceInterview.id == identifier)
                               .values(updated_at=WorkspaceInterview.updated_at, **summary_values(json.loads(snapshot))))
        last_id = rows[-1][0]
    await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_workspace_history_owner_status ON workspace_interviews (owner_email, status, updated_at)"))


async def _resume_deletion_table(conn: AsyncConnection) -> None:
    await conn.run_sync(lambda sync: WorkspaceResumeDeletion.__table__.create(sync, checkfirst=True))
