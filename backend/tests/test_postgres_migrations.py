"""Opt-in migration verification against PostgreSQL, isolated in a disposable schema."""
import json
import os
from uuid import uuid4
import pytest
from sqlalchemy import delete, insert, select, text
from sqlalchemy.ext.asyncio import create_async_engine
from app.db import Base
from app.migrations import migrate, versions
from app.models.db_models import User, Resume, Token, Interview, WorkspaceInterview, WorkspaceResume


@pytest.mark.asyncio
@pytest.mark.skipif(not os.getenv('TEST_POSTGRES_URL'), reason='TEST_POSTGRES_URL enables isolated PostgreSQL validation')
async def test_existing_postgres_schema_migrates_without_open_cursor_ddl():
    url = os.environ['TEST_POSTGRES_URL']
    schema = 'release059_verify_' + uuid4().hex
    admin = create_async_engine(url)
    engine = None
    try:
        async with admin.begin() as conn:
            await conn.execute(text(f'CREATE SCHEMA {schema}'))
        engine = create_async_engine(url, connect_args={'server_settings': {'search_path': schema}})
        async with engine.begin() as conn:
            await conn.run_sync(lambda sync: Base.metadata.create_all(sync, tables=[User.__table__, Resume.__table__, Token.__table__, Interview.__table__]))
            await migrate(conn)
            identifier, resume_id = uuid4(), uuid4()
            snapshot = {'id': str(identifier), 'title': '保留原始记录', 'status': 'completed', 'conversation': [{'text':'问题'}], 'answers': []}
            await conn.execute(insert(User).values(email='migration@example.invalid', remaining_seconds=0))
            await conn.execute(insert(WorkspaceInterview).values(id=identifier, owner_email='migration@example.invalid', revision=1, snapshot_json=json.dumps(snapshot)))
            await conn.execute(insert(WorkspaceResume).values(id=resume_id, owner_email='migration@example.invalid', version=1, filename='准备草稿 · 自我介绍', text='待核实内容'))
            # Reconstruct the deployed pre-005 schema and verify in-place additive migration.
            await conn.execute(text('DROP INDEX ix_workspace_history_owner_status'))
            for column in ('summary_json', 'search_text', 'status'):
                await conn.execute(text(f'ALTER TABLE workspace_interviews DROP COLUMN {column}'))
            await conn.execute(text('ALTER TABLE workspace_resumes DROP COLUMN kind'))
            await conn.execute(delete(versions).where(versions.c.version == '005_material_kinds_and_history_summaries'))
            await migrate(conn)
            await migrate(conn)
            assert json.loads(await conn.scalar(select(WorkspaceInterview.snapshot_json))) == snapshot
            assert json.loads(await conn.scalar(select(WorkspaceInterview.summary_json)))['message_count'] == 1
            assert await conn.scalar(select(WorkspaceResume.kind)) == 'draft'
    finally:
        if engine:
            await engine.dispose()
        async with admin.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA IF EXISTS {schema} CASCADE'))
        await admin.dispose()
