"""Workspace/auth regression tests; no SMTP, ASR, or LLM network requests."""
import asyncio
import hashlib
import json
import os
import time
from io import BytesIO
from uuid import uuid4
from zipfile import ZipFile

os.environ["LOCAL_DEV"] = "true"

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.db import Base, get_db
from app.models.db_models import Token, User, WorkspaceInterview
from app.redis import close_redis, get_redis
from app.routers import auth, workspace
from app.services.auth_service import hash_password, verify_password


@pytest_asyncio.fixture
async def environment(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'workspace-test.db'}")
    async def stop_capture(*_):
        pass
    monkeypatch.setattr(workspace, "stop_session_capture", stop_capture)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        for name in ("owner", "other"):
            email = f"{name}@example.test"
            db.add(User(email=email, password_hash=hash_password("old-secret"), remaining_seconds=0))
            db.add(Token(email=email, token_hash=hashlib.sha256(f"{name}-token".encode()).hexdigest(),
                         expires_at=time.time() + 3600))
        await db.commit()

    app = FastAPI()
    app.include_router(auth.router, prefix="/api")
    app.include_router(workspace.router, prefix="/api")

    async def database():
        async with sessions() as db:
            yield db
    app.dependency_overrides[get_db] = database
    await close_redis()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                                headers={"Authorization": "Bearer owner-token"}) as client:
        yield client, sessions
    await close_redis()
    await engine.dispose()


def snapshot(**updates):
    data = {"id": str(uuid4()), "title": "前端面试", "company": "测试公司", "role": "前端工程师",
            "job_description": "负责组件开发", "resume_id": None, "resume_snapshot": None,
            "status": "active", "started_at": 1780000000000, "ended_at": None,
            "duration_seconds": 0, "conversation": [], "answers": [],
            "preferences": {"language": "zh", "answer_length": "standard", "answer_style": "conversational"},
            "revision": 1, "expected_revision": 0}
    data.update(updates)
    return data


@pytest.mark.asyncio
async def test_snapshot_ownership_revision_and_delete(environment, monkeypatch, tmp_path):
    from app.services import workspace_media
    monkeypatch.setattr(workspace_media, "storage_root", lambda: tmp_path)
    client, _ = environment
    data = snapshot()
    path = f"/api/workspace/interviews/{data['id']}"
    media = tmp_path / hashlib.sha256(b"owner@example.test").hexdigest() / data["id"] / "captures" / "connection"
    media.mkdir(parents=True)
    (media / "mic.realtime.pcm.part").write_bytes(b"mock audio")
    assert (await client.put(path, json=data)).status_code == 200
    assert (await client.put(path, json=data)).status_code == 200  # safe retry
    changed = {**data, "title": "被修改"}
    assert (await client.put(path, json=changed)).status_code == 409
    changed.update(revision=2, expected_revision=1)
    assert (await client.put(path, json=changed)).status_code == 200
    assert (await client.put(path, json=data)).status_code == 409
    assert (await client.get(path)).json()["title"] == "被修改"
    summaries = (await client.get("/api/workspace/interviews")).json()
    assert summaries[0]["message_count"] == 0
    assert "conversation" not in summaries[0] and "answers" not in summaries[0]
    other = {"Authorization": "Bearer other-token"}
    assert (await client.get(path, headers=other)).status_code == 404
    assert (await client.put(path, headers=other, json={**changed, "revision": 3, "expected_revision": 2})).status_code == 404
    assert (await client.delete(path, headers=other)).status_code == 404
    assert media.exists()
    assert (await client.delete(path)).status_code == 200
    assert not media.exists()
    assert (await client.get(path)).status_code == 404
    assert (await client.get("/api/workspace/interviews", headers={"Authorization": ""})).status_code == 401


@pytest.mark.asyncio
async def test_cross_device_cas_and_deleted_session_cannot_be_resurrected(environment, monkeypatch):
    client, _ = environment
    monkeypatch.setattr(workspace, "delete_session_media", lambda *_: None)
    initial = snapshot()
    path = f"/api/workspace/interviews/{initial['id']}"
    saved = await client.put(path, json=initial)
    assert saved.status_code == 200 and "expected_revision" not in saved.json()
    newer = {**initial, "revision": 2, "expected_revision": 1, "title": "另一设备新记录"}
    assert (await client.put(path, json=newer)).status_code == 200
    # Many local edits are not evidence that a stale branch is newer.
    stale = {**initial, "revision": 1000, "expected_revision": 1, "title": "离线旧副本"}
    assert (await client.put(path, json=stale)).status_code == 409
    assert (await client.get(path)).json()["title"] == "另一设备新记录"
    # A lost acknowledgement can safely repeat the exact accepted write.
    assert (await client.put(path, json=newer)).status_code == 200
    without_base = {key: value for key, value in newer.items() if key != "expected_revision"}
    assert (await client.put(path, json=without_base)).status_code == 422
    assert (await client.delete(path)).status_code == 200
    assert (await client.put(path, json={**newer, "revision": 3, "expected_revision": 2})).status_code == 404
    assert (await client.get(path)).status_code == 404
    # The very first acknowledgement can also have been lost. A deletion
    # tombstone rejects replay even when the stale client still believes base=0.
    assert (await client.put(path, json=initial)).status_code == 404
    assert (await client.delete(path)).status_code == 200
    assert (await client.delete(path, headers={"Authorization": "Bearer other-token"})).status_code == 404


@pytest.mark.asyncio
async def test_parallel_saves_and_settings_do_not_overwrite_new_data(environment):
    client, _ = environment
    data = snapshot()
    path = f"/api/workspace/interviews/{data['id']}"
    first_writes = await asyncio.gather(client.put(path, json=data), client.put(path, json=data))
    assert [response.status_code for response in first_writes] == [200, 200]
    updates = [{**data, "expected_revision": 1, "revision": 2, "title": title} for title in ("设备一", "设备二")]
    responses = await asyncio.gather(*(client.put(path, json=body) for body in updates))
    assert sorted(response.status_code for response in responses) == [200, 409]
    winner = next(response.json()["title"] for response in responses if response.status_code == 200)
    assert (await client.get(path)).json()["title"] == winner
    results = await asyncio.gather(client.put("/api/workspace/settings", json={"theme": "dark"}),
                                   client.put("/api/workspace/settings", json={"font_size": 18}))
    assert [result.status_code for result in results] == [200, 200]
    settings = (await client.get("/api/workspace/settings")).json()
    assert settings["theme"] == "dark" and settings["font_size"] == 18


@pytest.mark.asyncio
@pytest.mark.parametrize("style", ["written", "coding"])
async def test_detailed_preference_settings_and_history_round_trip(environment, style):
    client, _ = environment
    preferences = {"language": "zh", "answer_length": "detailed", "answer_style": style}
    assert (await client.put("/api/workspace/settings", json=preferences)).status_code == 200
    settings = (await client.get("/api/workspace/settings")).json()
    assert all(settings[key] == value for key, value in preferences.items())
    data = snapshot(preferences=preferences)
    path = f"/api/workspace/interviews/{data['id']}"
    assert (await client.put(path, json=data)).status_code == 200
    assert (await client.get(path)).json()["preferences"] == preferences
    # A later default change must not rewrite the saved interview.
    assert (await client.put("/api/workspace/settings", json={"answer_style": "conversational"})).status_code == 200
    assert (await client.get(path)).json()["preferences"] == preferences
    assert (await client.put("/api/workspace/settings", json={"answer_style": "unknown"})).status_code == 422


@pytest.mark.asyncio
async def test_failed_media_cleanup_can_retry_without_restoring_snapshot(environment, monkeypatch):
    client, _ = environment
    data = snapshot()
    path = f"/api/workspace/interviews/{data['id']}"
    await client.put(path, json=data)
    def locked_media(*_):
        raise PermissionError("mock open recording handle")
    monkeypatch.setattr(workspace, "delete_session_media", locked_media)
    assert (await client.delete(path)).status_code == 503
    assert (await client.get(path)).status_code == 404
    assert (await client.put(path, json=data)).status_code == 404
    monkeypatch.setattr(workspace, "delete_session_media", lambda *_: None)
    assert (await client.delete(path)).status_code == 200


@pytest.mark.asyncio
async def test_transcript_and_answer_extension_fields_survive_round_trip(environment):
    client, _ = environment
    message = {"id": "q1", "role": "interviewer", "text": "问题", "status": "done",
               "timestamp": 1780000000000, "utteranceId": "asr-connection:system:100",
               "startTime": 100, "endTime": 900, "revision": 3, "source": "system"}
    answer = {"id": "a1", "request_id": "r1", "source_message_ids": ["q1"],
              "source_revisions": [3], "question_text": "问题", "text": "部分回答",
              "status": "error", "timestamp": 1780000001000, "context_version": 1,
              "error": "网络断开", "first_token_at": 1780000001500, "completed_at": 1780000001600,
              "source_refs": [{"message_id": "q1", "revision": 3}]}
    data = snapshot(conversation=[message], answers=[answer], capture_source="mic")
    path = f"/api/workspace/interviews/{data['id']}"
    assert (await client.put(path, json=data)).status_code == 200
    restored = (await client.get(path)).json()
    assert restored["capture_source"] == "mic"
    for key in ("utteranceId", "startTime", "endTime"):
        assert restored["conversation"][0][key] == message[key]
    for key in ("error", "first_token_at", "completed_at", "source_refs"):
        assert restored["answers"][0][key] == answer[key]
    assert restored["answers"][0]["source_revisions"] == [3]
    assert restored["answers"][0]["context_version"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("field, value", [
    ("source_revisions", {"q1": 1}),
    ("source_revisions", ["1"]),
    ("source_revisions", [True]),
    ("context_version", "1"),
    ("context_version", True),
])
async def test_answer_revision_fields_reject_incompatible_types(environment, field, value):
    client, _ = environment
    answer = {"id": "answer", "request_id": "request", "source_message_ids": ["q1"],
              "source_revisions": [1], "context_version": 1, "status": "done", "timestamp": 1780000000000}
    answer[field] = value
    data = snapshot(answers=[answer])
    result = await client.put(f"/api/workspace/interviews/{data['id']}", json=data)
    assert result.status_code == 422


@pytest.mark.asyncio
async def test_snapshot_rejects_nonfinite_time_and_misaligned_answer_sources(environment):
    client, _ = environment
    data = snapshot(started_at="Infinity")
    path = f"/api/workspace/interviews/{data['id']}"
    assert (await client.put(path, json=data)).status_code == 422
    data["started_at"] = 1780000000000
    data["answers"] = [{"id": "a", "request_id": "r", "source_message_ids": ["q1"],
                        "source_revisions": [], "status": "done", "timestamp": 1780000000000}]
    assert (await client.put(path, json=data)).status_code == 422
    data["answers"][0]["source_revisions"] = [-1]
    assert (await client.put(path, json=data)).status_code == 422


@pytest.mark.asyncio
async def test_resume_immutable_versions_and_snapshot_owner(environment):
    client, _ = environment
    first = (await client.post("/api/workspace/resumes", json={"text": "实际经历一"})).json()
    second = (await client.post("/api/workspace/resumes", json={"text": "实际经历二"})).json()
    assert first["version"] == 1 and second["version"] == 2
    versions = (await client.get("/api/workspace/resumes")).json()
    assert versions[1]["text"] == "实际经历一"
    other = {"Authorization": "Bearer other-token"}
    assert (await client.get("/api/workspace/resumes", headers=other)).json() == []
    resume_snapshot = {k: first[k] for k in ("id", "version", "filename", "text")}
    data = snapshot(resume_id=first["id"], resume_snapshot=resume_snapshot)
    path = f"/api/workspace/interviews/{data['id']}"
    assert (await client.put(path, json=data, headers=other)).status_code == 404
    assert (await client.put(path, json=data)).status_code == 200
    data.update(revision=2, expected_revision=1)
    data["resume_snapshot"]["text"] = "伪造内容"
    assert (await client.put(path, json=data)).status_code == 422
    data["resume_snapshot"]["text"] = first["text"]
    data["resume_snapshot"]["filename"] = "伪造文件名"
    assert (await client.put(path, json=data)).status_code == 422
    data["resume_snapshot"] = None
    assert (await client.put(path, json=data)).status_code == 422


@pytest.mark.asyncio
async def test_slow_review_releases_database_and_rejects_stale_or_duplicate_results(environment, monkeypatch):
    client, _ = environment
    data = snapshot(status="completed", ended_at=1780000001000,
                    conversation=[{"id": "q1", "role": "interviewer", "text": "问题", "status": "done", "timestamp": 1780000000000}])
    path = f"/api/workspace/interviews/{data['id']}"
    await client.put(path, json=data)
    started, proceed = asyncio.Event(), asyncio.Event()
    calls = []
    async def completion(*args):
        calls.append(args)
        started.set()
        await proceed.wait()
        return "基于实际记录的复盘"
    monkeypatch.setattr(workspace, "complete_text", completion)
    pending = asyncio.create_task(client.post(path + "/review"))
    await asyncio.wait_for(started.wait(), 2)
    assert (await client.post(path + "/review")).status_code == 409
    updated = {**data, "revision": 2, "expected_revision": 1, "title": "并发修改"}
    assert (await client.put(path, json=updated)).status_code == 200
    proceed.set()
    assert (await pending).status_code == 409
    assert (await client.get(path)).json()["review"] is None
    generated = await client.post(path + "/review")
    assert generated.status_code == 200
    assert (await client.post(path + "/review")).json() == generated.json()
    assert len(calls) == 2  # one stale attempt, one current result; cached retry is free


@pytest.mark.asyncio
async def test_disconnected_preparation_cancels_provider_task():
    from app.services.workspace_requests import request_completion
    from fastapi import HTTPException
    started, cancelled = asyncio.Event(), asyncio.Event()
    async def completion(*_):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    class DisconnectedRequest:
        async def is_disconnected(self):
            await started.wait()
            return True
    with pytest.raises(HTTPException) as error:
        await request_completion(DisconnectedRequest(), completion, "", "")
    assert error.value.status_code == 499 and cancelled.is_set()


@pytest.mark.asyncio
async def test_orphan_token_invalid_email_and_failed_mail_retry(environment, monkeypatch):
    from sqlalchemy import delete
    client, sessions = environment
    for address in ("missing-domain", "a@@b.test", "a b@example.test"):
        result = await client.post("/api/auth/send-code", json={"email": address})
        assert result.status_code == 422
    monkeypatch.setattr(auth, "get_smtp_config", lambda: {"configured": True})
    attempts = []
    async def failed_email(*_):
        attempts.append(1)
        raise OSError("mock network down")
    monkeypatch.setattr(auth, "send_code_email", failed_email)
    for _ in range(2):
        assert (await client.post("/api/auth/send-code", json={"email": "owner@example.test"})).status_code == 503
    assert len(attempts) == 2  # failed send does not leave a resend cooldown
    async with sessions() as db:
        await db.execute(delete(User).where(User.email == "owner@example.test"))
        await db.commit()
    assert (await client.post("/api/auth/verify", json={"token": "owner-token"})).status_code == 401
    assert (await client.get("/api/workspace/interviews")).status_code == 401


@pytest.mark.asyncio
async def test_password_guesses_are_limited_and_verified_recovery_unlocks(environment):
    client, _ = environment
    for _ in range(5):
        assert (await client.post("/api/auth/login-password", json={"email": "owner@example.test", "password": "wrong"})).status_code == 401
    assert (await client.post("/api/auth/login-password", json={"email": "owner@example.test", "password": "old-secret"})).status_code == 429
    redis = await get_redis()
    await redis.set("code:reset_password:owner@example.test", "123456", ex=300)
    assert (await client.post("/api/auth/reset-password", json={"email": "owner@example.test", "password": "new-secret", "code": "123456"})).status_code == 200
    assert (await client.post("/api/auth/login-password", json={"email": "owner@example.test", "password": "new-secret"})).status_code == 200


@pytest.mark.asyncio
async def test_resume_file_parsing_and_validation(environment):
    client, _ = environment
    result = await client.post("/api/workspace/resumes/upload", files={"file": ("resume.txt", "真实简历".encode(), "text/plain")})
    assert result.status_code == 200 and result.json()["text"] == "真实简历"
    buf = BytesIO()
    with ZipFile(buf, "w") as archive:
        archive.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX 真实经历</w:t></w:r></w:p></w:body></w:document>')
    result = await client.post("/api/workspace/resumes/upload", files={"file": ("resume.docx", buf.getvalue())})
    assert result.status_code == 200 and "DOCX 真实经历" in result.json()["text"]
    assert (await client.post("/api/workspace/resumes/upload", files={"file": ("bad.pdf", b"invalid")})).status_code == 422
    assert (await client.post("/api/workspace/resumes", json={"text": "  "})).status_code == 422


@pytest.mark.asyncio
async def test_jobs_and_settings_are_persistent_and_isolated(environment):
    client, _ = environment
    job = (await client.post("/api/workspace/jobs", json={"title": "研发", "company": "甲", "description": "岗位原文"})).json()
    path = f"/api/workspace/jobs/{job['id']}"
    assert (await client.put(path, json={"title": "高级研发", "description": "更新岗位"})).json()["title"] == "高级研发"
    assert (await client.get("/api/workspace/jobs", headers={"Authorization": "Bearer other-token"})).json() == []
    assert (await client.delete(path, headers={"Authorization": "Bearer other-token"})).status_code == 404
    assert (await client.delete(path)).status_code == 200
    result = await client.put("/api/workspace/settings", json={"theme": "dark", "language": "en", "answer_length": "brief"})
    assert result.status_code == 200 and result.json()["theme"] == "dark"
    result = await client.put("/api/workspace/settings", json={"font_size": 18})
    assert result.json()["theme"] == "dark" and result.json()["font_size"] == 18
    assert (await client.get("/api/workspace/settings")).json()["language"] == "en"
    assert (await client.get("/api/workspace/settings", headers={"Authorization": "Bearer other-token"})).json()["theme"] == "system"
    assert (await client.put("/api/workspace/settings", json={"font_size": 100})).status_code == 422


@pytest.mark.asyncio
async def test_review_requires_evidence_uses_real_data_and_persists(environment, monkeypatch):
    client, _ = environment
    calls = []
    async def completion(system, user):
        calls.append((system, json.loads(user)))
        return "## 复盘\n缺少候选人实际作答，仅整理问题。"
    monkeypatch.setattr(workspace, "complete_text", completion)
    data = snapshot(conversation=[{"id": "q1", "role": "interviewer", "text": "解释事件循环", "status": "done", "timestamp": 1780000000000}])
    path = f"/api/workspace/interviews/{data['id']}"
    await client.put(path, json=data)
    assert (await client.post(path + "/review")).status_code == 409
    assert calls == []
    data.update(status="completed", revision=2, expected_revision=1, ended_at=1780000001000)
    await client.put(path, json=data)
    review = await client.post(path + "/review")
    assert review.status_code == 200 and "缺少" in review.json()["text"]
    assert calls[0][1]["conversation"][0]["text"] == "解释事件循环"
    assert calls[0][1]["conversation"][0]["label"] == "第1句"
    assert "不能评价" in calls[0][0] and "AI答案" in calls[0][0]
    assert (await client.get(path)).json()["review"]["text"] == review.json()["text"]
    data.update(revision=3, expected_revision=2)
    await client.put(path, json=data)
    assert (await client.get(path)).json()["review"] is None


@pytest.mark.asyncio
async def test_tool_validation_and_materials(environment, monkeypatch):
    client, _ = environment
    captured = []
    async def completion(system, user):
        captured.append(json.loads(user))
        return "基于真实材料的草稿"
    monkeypatch.setattr(workspace, "complete_text", completion)
    assert (await client.post("/api/workspace/tools/answer", json={"resume_text": "经历"})).status_code == 422
    result = await client.post("/api/workspace/tools/intro", json={"input": "介绍我自己", "role": "工程师", "resume_text": "做过真实项目", "job_description": "岗位原文"})
    assert result.json() == {"text": "基于真实材料的草稿"}
    assert captured[0]["resume_text"] == "做过真实项目"
    assert (await client.post("/api/workspace/tools/invalid", json={"input": "x"})).status_code == 422


@pytest.mark.asyncio
async def test_registration_does_not_change_existing_password(environment):
    client, sessions = environment
    result = await client.post("/api/auth/register", json={"email": "owner@example.test", "code": "123456", "password": "new-secret"})
    assert result.status_code == 409
    async with sessions() as db:
        user = await db.scalar(select(User).where(User.email == "owner@example.test"))
        assert verify_password("old-secret", user.password_hash)


@pytest.mark.asyncio
async def test_registration_code_send_and_profile_edit(environment, monkeypatch):
    client, _ = environment
    sent = []
    async def email_sender(email, code, purpose):
        sent.append((email, code, purpose))
    monkeypatch.setattr(auth, "get_smtp_config", lambda: {"configured": True})
    monkeypatch.setattr(auth, "send_code_email", email_sender)
    result = await client.post("/api/auth/send-code", json={"email": "new@example.test", "purpose": "register"})
    assert result.status_code == 200 and result.json()["cooldown"] == 30
    assert len(sent[0][1]) == 6 and sent[0][1].isdigit()
    assert sent[0][2] == "register"
    # A registration code cannot sign in before the account is created.
    assert (await client.post("/api/auth/login", json={"email": "new@example.test", "code": sent[0][1]})).status_code == 401
    result = await client.post("/api/auth/register", json={"email": "new@example.test", "code": sent[0][1], "password": "new-secret"})
    assert result.status_code == 200 and result.json()["token"]
    result = await client.put("/api/user/profile", json={"name": " 新昵称 "})
    assert result.json()["user"]["name"] == "新昵称"
    assert (await client.put("/api/user/profile", json={"name": "   "})).status_code == 422


@pytest.mark.asyncio
async def test_codes_are_purpose_bound_reset_revokes_tokens_and_logout(environment):
    client, sessions = environment
    redis = await get_redis()
    await redis.set("code:login:owner@example.test", "123456", ex=300)
    body = {"email": "owner@example.test", "code": "123456", "password": "new-secret"}
    assert (await client.post("/api/auth/reset-password", json=body)).status_code == 401
    await redis.set("code:reset_password:owner@example.test", "123456", ex=300)
    assert (await client.post("/api/auth/reset-password", json=body)).status_code == 200
    assert (await client.get("/api/user/profile")).status_code == 401
    login = (await client.post("/api/auth/login-password", json={"email": "owner@example.test", "password": "new-secret"})).json()
    client.headers["Authorization"] = "Bearer " + login["token"]
    assert (await client.get("/api/user/profile")).status_code == 200
    assert (await client.post("/api/auth/logout")).status_code == 200
    assert (await client.get("/api/user/profile")).status_code == 401
    assert (await client.post("/api/auth/reset-password", json=body)).status_code == 401  # one use


@pytest.mark.asyncio
async def test_complete_registration_login_recovery_logout_over_http(environment, monkeypatch):
    """Whole API journey with real DB/auth/code logic; only SMTP delivery is fake."""
    client, _ = environment
    email = "full-journey@example.test"
    delivered = []
    async def capture_mail(recipient, code, purpose):
        delivered.append({"recipient": recipient, "code": code, "purpose": purpose})
    monkeypatch.setattr(auth, "get_smtp_config", lambda: {"configured": True})
    monkeypatch.setattr(auth, "send_code_email", capture_mail)
    assert (await client.post("/api/auth/check-email", json={"email": email})).json()["exists"] is False
    assert (await client.post("/api/auth/send-code", json={"email": email, "purpose": "register"})).status_code == 200
    registration_code = delivered[-1]["code"]
    assert delivered[-1]["purpose"] == "register"
    assert (await client.post("/api/auth/send-code", json={"email": email, "purpose": "register"})).status_code == 429
    assert len(delivered) == 1
    wrong = "000000" if registration_code != "000000" else "000001"
    register_body = {"email": email, "code": wrong, "password": "Initial-Password-2026"}
    assert (await client.post("/api/auth/register", json=register_body)).status_code == 401
    register_body["code"] = registration_code
    registered = await client.post("/api/auth/register", json=register_body)
    assert registered.status_code == 200
    tokens = [registered.json()["token"]]
    assert (await client.post("/api/auth/check-email", json={"email": email})).json()["exists"] is True
    assert (await client.post("/api/auth/register", json={**register_body, "password": "Must-Not-Replace"})).status_code == 409
    assert (await client.post("/api/auth/login-password", json={"email": email, "password": "wrong"})).status_code == 401
    logged_in = await client.post("/api/auth/login-password", json={"email": email, "password": "Initial-Password-2026"})
    assert logged_in.status_code == 200
    tokens.append(logged_in.json()["token"])
    assert (await client.post("/api/auth/send-code", json={"email": email, "purpose": "login"})).status_code == 200
    login_code = delivered[-1]["code"]
    logged_in = await client.post("/api/auth/login", json={"email": email, "code": login_code})
    assert logged_in.status_code == 200
    tokens.append(logged_in.json()["token"])
    assert (await client.post("/api/auth/login", json={"email": email, "code": login_code})).status_code == 401
    assert (await client.post("/api/auth/send-code", json={"email": email, "purpose": "reset_password"})).status_code == 200
    reset_code = delivered[-1]["code"]
    reset_body = {"email": email, "code": reset_code, "password": "First-Recovery-2026"}
    assert (await client.post("/api/auth/reset-password", json=reset_body)).status_code == 200
    for token in tokens:
        assert (await client.post("/api/auth/verify", json={"token": token})).status_code == 401
        assert (await client.get("/api/workspace/interviews", headers={"Authorization": "Bearer " + token})).status_code == 401
    assert (await client.post("/api/auth/login-password", json={"email": email, "password": "Initial-Password-2026"})).status_code == 401
    logged_in = await client.post("/api/auth/login-password", json={"email": email, "password": "First-Recovery-2026"})
    assert logged_in.status_code == 200
    previous_token = logged_in.json()["token"]
    assert (await client.post("/api/auth/reset-password", json=reset_body)).status_code == 401
    # Advance the test clock, without modifying Redis entries or waiting 30s.
    later = time.time() + 31
    monkeypatch.setattr(time, "time", lambda: later)
    assert (await client.post("/api/auth/send-code", json={"email": email, "purpose": "reset_password"})).status_code == 200
    reset_body.update(code=delivered[-1]["code"], password="Second-Recovery-2026")
    assert (await client.post("/api/auth/reset-password", json=reset_body)).status_code == 200
    assert (await client.post("/api/auth/verify", json={"token": previous_token})).status_code == 401
    logged_in = await client.post("/api/auth/login-password", json={"email": email, "password": "Second-Recovery-2026"})
    assert logged_in.status_code == 200
    token = logged_in.json()["token"]
    client.headers["Authorization"] = "Bearer " + token
    assert (await client.get("/api/user/profile")).json()["user"]["email"] == email
    assert (await client.post("/api/auth/logout")).status_code == 200
    assert (await client.get("/api/user/profile")).status_code == 401
    assert (await client.post("/api/auth/verify", json={"token": token})).status_code == 401


@pytest.mark.asyncio
async def test_invalid_upload_requests_never_create_partial_resume_versions(environment):
    client, _ = environment
    missing_part = BytesIO()
    with ZipFile(missing_part, "w") as archive:
        archive.writestr("readme.txt", "not a Word document")
    for name, content, expected in (
        ("program.exe", b"unsupported", 422),
        ("empty.txt", b"", 422),
        ("spaces.txt", b" \n\t ", 422),
        ("broken-encoding.txt", b"\x81", 422),
        ("broken.pdf", b"not a PDF", 422),
        ("broken.docx", b"not a ZIP", 422),
        ("missing-part.docx", missing_part.getvalue(), 422),
        ("too-large.txt", b"x" * (10 * 1024 * 1024 + 1), 413),
    ):
        response = await client.post("/api/workspace/resumes/upload", files={"file": (name, content)})
        assert response.status_code == expected, (name, response.status_code)
        assert (await client.get("/api/workspace/resumes")).json() == []
    # A failure does not allocate a version or prevent the next valid upload.
    valid = await client.post("/api/workspace/resumes/upload", files={"file": ("resume.txt", "恢复后的真实简历".encode())})
    assert valid.status_code == 200 and valid.json()["version"] == 1


@pytest.mark.asyncio
async def test_authorized_detail_contains_full_text_export_inputs(environment):
    client, _ = environment
    data = snapshot(status="completed", ended_at=1780000001000,
                    conversation=[{"id": "q1", "role": "interviewer", "text": "第一行问题\n第二行补充", "status": "done", "timestamp": 1780000000000, "revision": 2},
                                  {"id": "u1", "role": "user", "text": "候选人完整回答", "status": "done", "timestamp": 1780000000500}],
                    answers=[{"id": "a1", "request_id": "r1", "source_message_ids": ["q1"], "source_revisions": [2],
                              "question_text": "第一行问题\n第二行补充", "text": "参考答案\n完整第二段", "status": "truncated", "timestamp": 1780000000600}])
    path = f"/api/workspace/interviews/{data['id']}"
    assert (await client.put(path, json=data)).status_code == 200
    detail = (await client.get(path)).json()
    assert [message["text"] for message in detail["conversation"]] == [message["text"] for message in data["conversation"]]
    assert detail["answers"][0]["text"] == data["answers"][0]["text"]
    assert detail["answers"][0]["status"] == "truncated"
    assert detail["answers"][0]["source_revisions"] == [2]
    assert (await client.get(path, headers={"Authorization": "Bearer other-token"})).status_code == 404
    assert (await client.get(path, headers={"Authorization": ""})).status_code == 401


@pytest.mark.asyncio
async def test_zero_balance_stays_zero_and_code_attempts_are_limited(environment):
    client, _ = environment
    redis = await get_redis()
    await redis.set("code:login:owner@example.test", "123456", ex=300)
    result = await client.post("/api/auth/login", json={"email": "owner@example.test", "code": "123456"})
    assert result.status_code == 200
    profile = (await client.get("/api/user/profile")).json()
    assert profile["user"]["remaining_seconds"] == 0
    await redis.set("code:login:owner@example.test", "123456", ex=300)
    for _ in range(5):
        assert (await client.post("/api/auth/login", json={"email": "owner@example.test", "code": "000000"})).status_code == 401
    assert (await client.post("/api/auth/login", json={"email": "owner@example.test", "code": "123456"})).status_code == 429


@pytest.mark.asyncio
async def test_additive_migration_keeps_legacy_data():
    from app.migrations import migrate, versions
    from app.models.db_models import Interview, Resume
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync: Base.metadata.create_all(sync, tables=[User.__table__, Resume.__table__, Token.__table__, Interview.__table__]))
        await conn.execute(User.__table__.insert().values(email="legacy@example.test", remaining_seconds=123))
        await migrate(conn)
        await migrate(conn)
        assert await conn.scalar(select(User.remaining_seconds)) == 123
        assert set((await conn.scalars(select(versions.c.version))).all()) == {
            "001_workspace_v2", "003_legacy_interview_history", "004_deleted_workspace_interviews", "005_material_kinds_and_history_summaries", "006_deleted_material_versions",
        }
    await engine.dispose()


@pytest.mark.asyncio
async def test_history_migration_preserves_owners_associations_and_is_once_only():
    from app.migrations import migrate
    from app.models.db_models import Interview, Resume, WorkspaceResume
    from sqlalchemy import delete
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    old_ids = [uuid4(), uuid4(), uuid4()]
    old_messages = [
        {"id": "q1", "role": "interviewer", "text": "旧问题", "status": "done", "timestamp": 1780000001000},
        {"id": "a1", "role": "ai", "text": "旧 AI 参考答案", "status": "done", "timestamp": 1780000002},
        {"id": "u1", "role": "user", "text": "候选人实际回答", "status": "done", "timestamp": 1780000003000},
        {"id": "a2", "role": "ai", "text": "未完成", "status": "streaming", "timestamp": 1780000004000},
    ]
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for email in ("first@example.test", "second@example.test"):
            await conn.execute(User.__table__.insert().values(email=email, interview_language="en"))
        await conn.execute(Resume.__table__.insert().values(email="first@example.test", intro="生成的介绍，不是原始简历"))
        for index, identifier in enumerate(old_ids):
            await conn.execute(Interview.__table__.insert().values(
                id=identifier, email="first@example.test" if index != 1 else "second@example.test",
                started_at=1780000000 if index != 1 else 1780000000000,
                ended_at=1780000060 if index != 1 else 1780000060000,
                duration_seconds=60, programming_language="javascript", conversation_json=json.dumps(old_messages),
            ))
        # A newer workspace row with the same UUID must never be overwritten.
        protected = snapshot(id=str(old_ids[2]), title="已经迁移后编辑", revision=10)
        protected.pop("expected_revision")
        await conn.execute(WorkspaceInterview.__table__.insert().values(
            id=old_ids[2], owner_email="first@example.test", revision=10, snapshot_json=json.dumps(protected),
        ))
        await migrate(conn)
        await migrate(conn)
        rows = (await conn.execute(select(WorkspaceInterview.__table__))).mappings().all()
        assert len(rows) == 3
        by_id = {row["id"]: row for row in rows}
        for index in (0, 1):
            row = by_id[old_ids[index]]
            assert row["owner_email"] == ("first@example.test" if index == 0 else "second@example.test")
            migrated = json.loads(row["snapshot_json"])
            assert migrated["started_at"] == 1780000000000
            assert migrated["ended_at"] == 1780000060000
            assert migrated["role"] == "JavaScript 历史面试"
            assert migrated["capture_source"] == "both"
            assert migrated["preferences"]["language"] == "en"
            assert migrated["resume_id"] is None and migrated["resume_snapshot"] is None
            assert [m["role"] for m in migrated["conversation"]] == ["interviewer", "user"]
            first, second = migrated["answers"]
            assert first["id"] == "a1" and first["source_message_ids"] == ["q1"]
            assert first["source_revisions"] == [1] and first["timestamp"] == 1780000002000
            assert first["question_text"] == "旧问题" and first["text"] == "旧 AI 参考答案"
            assert second["source_message_ids"] == ["u1"] and second["status"] == "truncated"
            workspace.InterviewSnapshot(**migrated, expected_revision=1)
        assert json.loads(by_id[old_ids[2]]["snapshot_json"])["title"] == "已经迁移后编辑"
        assert len((await conn.execute(select(Interview))).all()) == 3
        assert (await conn.scalar(select(Interview.conversation_json).where(Interview.id == old_ids[0]))) == json.dumps(old_messages)
        assert (await conn.scalar(select(Resume.intro))) == "生成的介绍，不是原始简历"
        assert (await conn.scalars(select(WorkspaceResume.id))).all() == []
        # A user deletion after migration stays deleted even though the old row
        # is retained for rollback and the application starts again.
        await conn.execute(delete(WorkspaceInterview).where(WorkspaceInterview.id == old_ids[0]))
        await migrate(conn)
        assert await conn.scalar(select(WorkspaceInterview.id).where(WorkspaceInterview.id == old_ids[0])) is None
    await engine.dispose()


@pytest.mark.asyncio
async def test_preparation_completion_has_a_separate_standard_message_contract(monkeypatch):
    from app.services import workspace_llm
    requests = []
    def provider(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "真实材料生成的结果"}, "finish_reason": "stop"}]})
    original_client = httpx.AsyncClient
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-provider-key")
    monkeypatch.setattr(workspace_llm.httpx, "AsyncClient", lambda **kwargs: original_client(transport=httpx.MockTransport(provider), **kwargs))
    assert await workspace_llm.complete_text("准备任务", "原始简历") == "真实材料生成的结果"
    assert requests[0]["stream"] is False
    assert requests[0]["messages"] == [{"role": "system", "content": "准备任务"}, {"role": "user", "content": "原始简历"}]


@pytest.mark.asyncio
async def test_typed_materials_and_ended_session_guard(environment):
    client, _ = environment
    draft = (await client.post('/api/workspace/resumes', json={'text': 'AI 假设示例', 'filename': '准备稿', 'kind': 'draft'})).json()
    assert (await client.get('/api/workspace/resumes')).json() == []
    assert (await client.get('/api/workspace/resumes?include_drafts=true')).json()[0]['kind'] == 'draft'
    data = snapshot(resume_id=draft['id'], resume_snapshot={key: draft[key] for key in ('id', 'version', 'filename', 'text')})
    path = f"/api/workspace/interviews/{data['id']}"
    assert (await client.put(path, json=data)).status_code == 422
    data.update(resume_id=None, resume_snapshot=None, status='completed', ended_at=1780000001000)
    assert (await client.put(path, json=data)).status_code == 200
    payload = {'request_id': 'test', 'question_text': '为何这样做', 'context': {}}
    assert (await client.post(path + '/answer', json=payload)).status_code == 409
    assert (await client.post(path + '/answer', json=payload, headers={'Authorization': 'Bearer other-token'})).status_code == 404
    assert (await client.put(path, json={**data, 'status': 'active', 'revision': 2, 'expected_revision': 1})).status_code == 409


@pytest.mark.asyncio
@pytest.mark.parametrize("style,budget", [("conversational", 2400), ("structured", 3200), ("written", 8000), ("coding", 8000)])
async def test_paused_answers_stream_without_audio_and_ground_resume(environment, monkeypatch, style, budget):
    from app.services.llm_service import LLMService
    captured = []
    async def stream(self, question, **kwargs):
        captured.append(kwargs)
        yield '第一句。', False
        yield '补充细节。', False
        kwargs['result_metadata']['finish_reason'] = 'stop'
    monkeypatch.setattr(LLMService, 'stream_answer', stream)
    client, _ = environment
    data = snapshot(status='interrupted')
    path = f"/api/workspace/interviews/{data['id']}"
    await client.put(path, json=data)
    result = await client.post(path + '/answer', json={'request_id': 'paused', 'question_text': '请解释',
        'context': {'resume_text': '客户端试图伪造经历', 'answer_style': style}})
    events = [json.loads(line) for line in result.text.splitlines()]
    assert [event['type'] for event in events] == ['delta', 'delta', 'done']
    assert captured[0]['context']['resume_text'] == ''
    assert captured[0]['max_tokens'] == budget
    assert result.headers['x-accel-buffering'] == 'no'


@pytest.mark.asyncio
async def test_history_pagination_search_and_revision_lookup(environment):
    client, _ = environment
    for index in range(33):
        data = snapshot(title=f'Interview {index}', company='100%公司', job_description='long private body')
        await client.put(f"/api/workspace/interviews/{data['id']}", json=data)
    page = (await client.get('/api/workspace/interviews/page?page=2&size=30&q=100%25')).json()
    assert page['total'] == 33 and len(page['items']) == 3
    assert all(item['job_description'] == '' and 'conversation' not in item for item in page['items'])
    assert len((await client.get('/api/workspace/interviews/revisions')).json()) == 33
    assert (await client.get('/api/workspace/interviews/page?q=_')).json()['total'] == 0  # literal wildcard
    other = {'Authorization': 'Bearer other-token'}
    assert (await client.get('/api/workspace/interviews/page', headers=other)).json()['total'] == 0
    assert (await client.get('/api/workspace/interviews/revisions', headers=other)).json() == {}


@pytest.mark.asyncio
async def test_tool_review_stream_and_partial_review_not_cached(environment, monkeypatch):
    from app.services import workspace_llm
    async def chunks(*args):
        yield '结论。'
        yield '具体依据。'
    monkeypatch.setattr(workspace_llm, 'stream_text', chunks)
    client, _ = environment
    response = await client.post('/api/workspace/tools/answer?stream=true', json={'input': '为什么'})
    assert [json.loads(line)['type'] for line in response.text.splitlines()] == ['delta', 'delta', 'done']
    data = snapshot(status='completed', ended_at=1780000001000,
        conversation=[{'id': 'q', 'role': 'interviewer', 'text': '为什么', 'status': 'done', 'timestamp': 1780000000100}])
    path = f"/api/workspace/interviews/{data['id']}"
    await client.put(path, json=data)
    response = await client.post(path + '/review/stream')
    assert json.loads(response.text.splitlines()[-1])['type'] == 'done'
    assert (await client.get(path)).json()['review']['text'] == '结论。具体依据。'
    other = snapshot(status='completed', ended_at=1780000001000, conversation=data['conversation'])
    path = f"/api/workspace/interviews/{other['id']}"
    await client.put(path, json=other)
    async def broken(*args):
        from fastapi import HTTPException
        yield '不完整'
        raise HTTPException(502, '中断')
    monkeypatch.setattr(workspace_llm, 'stream_text', broken)
    response = await client.post(path + '/review/stream')
    assert json.loads(response.text.splitlines()[-1])['type'] == 'error'
    assert (await client.get(path)).json()['review'] is None


@pytest.mark.asyncio
async def test_audio_cleanup_preserves_transcript_and_respects_opt_in(environment, monkeypatch, tmp_path):
    from app.services import workspace_media
    from app.services.audio_retention import cleanup_once
    monkeypatch.setattr(workspace_media, 'storage_root', lambda: tmp_path)
    client, sessions = environment
    data = snapshot(status='completed', ended_at=1780000001000)
    path = f"/api/workspace/interviews/{data['id']}"
    await client.put(path, json=data)
    directory = tmp_path / hashlib.sha256(b'owner@example.test').hexdigest() / data['id']
    directory.mkdir(parents=True); (directory / 'mic.pcm').write_bytes(b'audio')
    await cleanup_once(sessions, now=1790000000)
    assert directory.exists()  # default does not silently erase old recordings
    await client.put('/api/workspace/settings', json={'audio_retention_days': 7})
    await cleanup_once(sessions, now=1790000000)
    assert not directory.exists()
    assert (await client.get(path)).status_code == 200
    paused = snapshot(status='interrupted')
    pause_path = f"/api/workspace/interviews/{paused['id']}"
    await client.put(pause_path, json=paused)
    assert (await client.delete(pause_path + '/audio')).status_code == 409
    assert (await client.delete(path + '/audio', headers={'Authorization': 'Bearer other-token'})).status_code == 404
    assert (await client.delete(path + '/audio')).status_code == 200


def test_resume_excerpt_preserves_relevant_late_project():
    from app.services.answer_context import resume_excerpt
    resume = '基础资料\n' + ('早期常规工作经历。' * 300 + '\n') * 7 + 'NimbusQueue：负责幂等请求和事务去重。'
    excerpt = resume_excerpt(resume, '介绍 NimbusQueue 的幂等请求设计')
    assert len(excerpt) <= 12000 and 'NimbusQueue' in excerpt and '基础资料' in excerpt


@pytest.mark.asyncio
async def test_ten_concurrent_paused_answers_are_isolated(environment, monkeypatch):
    from app.services.llm_service import LLMService
    async def stream(self, question, **kwargs):
        yield question + ':', False
        await asyncio.sleep(0.01)
        yield '独立回答', False
        kwargs['result_metadata']['finish_reason'] = 'stop'
    monkeypatch.setattr(LLMService, 'stream_answer', stream)
    client, _ = environment
    data = snapshot(status='interrupted')
    path = f"/api/workspace/interviews/{data['id']}"
    await client.put(path, json=data)
    results = await asyncio.gather(*(client.post(path + '/answer', json={
        'request_id': str(index), 'question_text': f'问题{index}', 'context': {}}) for index in range(10)))
    for index, result in enumerate(results):
        events = [json.loads(line) for line in result.text.splitlines()]
        assert ''.join(event['text'] for event in events if event['type'] == 'delta') == f'问题{index}:独立回答'
        assert events[-1]['type'] == 'done'


@pytest.mark.asyncio
async def test_stream_disconnect_cancels_review_provider():
    from app.services.workspace_stream import completion_events
    cancelled = asyncio.Event()
    async def operation(completion):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    stream = completion_events(operation)
    pending = asyncio.create_task(anext(stream))
    await asyncio.sleep(0)
    pending.cancel()
    await asyncio.gather(pending, return_exceptions=True)
    await stream.aclose()
    assert cancelled.is_set()


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["resume", "experience", "draft"])
async def test_material_delete_is_owned_idempotent_and_preserves_version_numbers(environment, kind):
    client, sessions = environment
    from app.models.db_models import WorkspaceResume, WorkspaceResumeDeletion
    from uuid import UUID
    item = (await client.post("/api/workspace/resumes", json={"filename": "私人资料", "text": "真实经历", "kind": kind})).json()
    path = f"/api/workspace/resumes/{item['id']}"
    assert (await client.delete(path, headers={"Authorization": "Bearer other-token"})).status_code == 404
    assert (await client.delete(path)).status_code == 200
    assert (await client.delete(path)).status_code == 200
    assert (await client.get("/api/workspace/resumes?include_drafts=true")).json() == []
    async with sessions() as db:
        assert await db.get(WorkspaceResume, UUID(item["id"])) is None
        marker = await db.get(WorkspaceResumeDeletion, UUID(item["id"]))
        assert marker.version == item["version"]
    next_item = (await client.post("/api/workspace/resumes", json={"filename": "新资料", "text": "新经历"})).json()
    assert next_item["version"] == item["version"] + 1


@pytest.mark.asyncio
async def test_deleted_material_keeps_exact_existing_snapshot_but_cannot_be_selected_again(environment):
    client, _ = environment
    item = (await client.post("/api/workspace/resumes", json={"filename": "简历", "text": "我的经历"})).json()
    saved_resume = {key: item[key] for key in ("id", "filename", "version", "text")}
    data = snapshot(resume_id=item["id"], resume_snapshot=saved_resume)
    path = f"/api/workspace/interviews/{data['id']}"
    assert (await client.put(path, json=data)).status_code == 200
    assert (await client.delete(f"/api/workspace/resumes/{item['id']}")).status_code == 200
    data.update(revision=2, expected_revision=1, duration_seconds=30)
    assert (await client.put(path, json=data)).status_code == 200
    assert (await client.get(path)).json()["resume_snapshot"] == saved_resume
    forged = {**data, "revision": 3, "expected_revision": 2, "resume_snapshot": {**saved_resume, "text": "篡改的经历"}}
    assert (await client.put(path, json=forged)).status_code == 404
    new = snapshot(resume_id=item["id"], resume_snapshot=saved_resume)
    assert (await client.put(f"/api/workspace/interviews/{new['id']}", json=new)).status_code == 404
    data.update(revision=3, expected_revision=2, status="completed", ended_at=1780000030000)
    assert (await client.put(path, json=data)).status_code == 200
