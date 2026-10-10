import asyncio
import hashlib
import json
import logging
import os
import re
import time as _time
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.models.schemas import (
    AudioStreamConfig,
    ClientHello,
    FileEnd,
    FileStart,
    PROTOCOL_NAME,
    SessionComplete,
    SessionStart,
    SessionStopped,
    TrackEnd,
    TrackStart,
)
from app.services.audio_service import (
    AudioPacketHeader,
    AudioSession,
    PCMValidator,
    ProtocolError,
    V1AudioSession,
    storage_root,
)
from app.services.llm_service import LLMService, answer_token_budget
from app.services.stt_streaming import StreamingASRSession
from app.services.asr_provider import asr_ready, create_asr_session

logger = logging.getLogger("audio")
router = APIRouter()

_ASR_READY = asr_ready()

# 0.5: mode → max_tokens 路由
# 5000 tokens ≈ 1500-1800 汉字，四维度深度回答绰绰有余
LLM_MAX_TOKENS = 1200
SESSION_AUTH_INTERVAL = 3.0
_active_sessions: dict[tuple[str, str], set[Callable[[], Awaitable[None]]]] = {}


async def stop_active_audio_session(owner_email: str, session_id: str) -> None:
    """Release local capture handles before DELETE removes media files.

    The periodic authorization check also terminates captures on other workers.
    This registry contains control callbacks, never audio or transcript queues.
    """
    callbacks = tuple(_active_sessions.get((owner_email, str(uuid.UUID(session_id))), ()))
    if not callbacks:
        return
    pending = {asyncio.create_task(callback()) for callback in callbacks}
    done, pending = await asyncio.wait(pending, timeout=15)
    for task in pending:
        task.cancel()
    await asyncio.gather(*done, *pending, return_exceptions=True)
    if pending:
        raise TimeoutError("录音关闭尚未确认，请重试删除")


class SerializedSocket:
    """One writer per connection; independent ASR sources cannot interleave frames."""
    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.lock = asyncio.Lock()

    async def send_json(self, payload):
        async with self.lock:
            await self.ws.send_json(payload)


async def authenticate_socket(ws: WebSocket) -> str | None:
    from app.db import async_session
    from app.services.auth_service import verify_token
    authorization = ws.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    async with async_session() as db:
        return await verify_token(db, token.strip())


async def authorize_audio_session(session_id: str, email: str) -> None:
    from sqlalchemy import select
    from app.db import async_session
    from app.models.db_models import WorkspaceInterview
    async with async_session() as db:
        row = await db.scalar(select(WorkspaceInterview.id).where(
            WorkspaceInterview.id == uuid.UUID(session_id), WorkspaceInterview.owner_email == email))
    if row is None:
        raise ProtocolError("E_SESSION_ACCESS", "请先保存本场面试，再开始采集")


def normalize_query(payload: dict[str, Any]) -> dict[str, Any]:
    request_id = payload.get("request_id") or str(uuid.uuid4())
    question = payload.get("question_text", payload.get("text", ""))
    if not isinstance(request_id, str) or len(request_id) > 128:
        raise ProtocolError("E_CONTROL_MESSAGE", "invalid request_id")
    if not isinstance(question, str) or not question.strip() or len(question) > 16000:
        raise ProtocolError("E_CONTROL_MESSAGE", "请选择或输入问题（最多 16000 字）")
    language = payload.get("language", "zh")
    if language not in ("zh", "en", "auto"):
        raise ProtocolError("E_CONTROL_MESSAGE", "invalid language")
    if language == "auto":
        language = "zh" if re.search(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f]", question) else "en"
    context = payload.get("context") or {}
    if not isinstance(context, dict):
        raise ProtocolError("E_CONTROL_MESSAGE", "context must be an object")
    for field in ("role", "job_description", "resume_text", "answer_length", "answer_style"):
        if field in context and not isinstance(context[field], str):
            raise ProtocolError("E_CONTROL_MESSAGE", f"context.{field} must be a string")
    ids, revisions = payload.get("source_message_ids") or [], payload.get("source_revisions") or []
    if not isinstance(ids, list) or len(ids) > 30 or any(not isinstance(x, str) or len(x) > 200 for x in ids):
        raise ProtocolError("E_CONTROL_MESSAGE", "invalid source_message_ids")
    if not isinstance(revisions, list) or any(not isinstance(x, int) or x < 0 for x in revisions):
        raise ProtocolError("E_CONTROL_MESSAGE", "invalid source_revisions")
    if revisions and len(revisions) != len(ids):
        raise ProtocolError("E_CONTROL_MESSAGE", "source revisions must match message ids")
    return {"request_id": request_id, "question_text": question.strip(), "language": language,
            "track": str(payload["track"])[:64] if payload.get("track") else None, "context": context,
            "source_message_ids": ids, "source_revisions": revisions,
            "context_version": payload.get("context_version")}


@router.websocket("/ws/audio/stream")
async def audio_stream(ws: WebSocket):
    # Credentials travel only in Authorization, never URL/query or logs.
    await ws.accept()
    socket = SerializedSocket(ws)
    try:
        email = await authenticate_socket(ws)
    except Exception:
        await send_error(socket, "E_AUTH_UNAVAILABLE", "认证服务暂不可用")
        await ws.close(code=1011)
        return
    if not email:
        await send_error(socket, "E_AUTH", "登录已失效，请重新登录")
        await ws.close(code=4401)
        return

    transcription_queue: asyncio.Queue = asyncio.Queue(maxsize=1024)
    sender_task = None
    llm_worker_task = None
    llm_workers: dict[str, asyncio.Task] = {}
    llm_service = LLMService()
    llm_config: dict[str, Any] = {}
    current_track: list[str | None] = [None]
    legacy_session = None
    legacy_validator = None
    v1_session = None
    asr_sessions: dict[str, StreamingASRSession] = {}
    background_tasks: set[asyncio.Task] = set()
    ack_counter = 0
    # Reconnects use independent files rather than overwrite the previous epoch.
    owner_root = storage_root() / hashlib.sha256(email.encode()).hexdigest()
    capture_id = uuid.uuid4()
    connection_task = asyncio.current_task()
    connection_done = asyncio.Event()
    termination_requested = False
    connection_finishing = False
    session_deleted = False
    active_key = None

    async def terminate_connection(code, message, close_code, *, deleted=False, wait=True):
        nonlocal termination_requested, session_deleted
        session_deleted = session_deleted or deleted
        if not termination_requested and not connection_done.is_set():
            termination_requested = True
            try:
                await asyncio.wait_for(safe_send_error(socket, code, message), 1)
                await asyncio.wait_for(ws.close(code=close_code), 1)
            except Exception:
                pass
            finally:
                if connection_task and not connection_task.done() and not connection_finishing:
                    connection_task.cancel()
        if wait:
            await connection_done.wait()

    async def stop_deleted_session():
        await terminate_connection("E_SESSION_DELETED", "本场面试已删除，采集已停止", 4404, deleted=True)

    async def watch_authorization():
        while True:
            await asyncio.sleep(SESSION_AUTH_INTERVAL)
            try:
                if await authenticate_socket(ws) != email:
                    await terminate_connection("E_AUTH", "登录已失效，采集已停止", 4401, wait=False)
                    return
                await authorize_audio_session(str(v1_session.session_id), email)
            except ProtocolError:
                await terminate_connection("E_SESSION_DELETED", "本场面试已删除，采集已停止", 4404, deleted=True, wait=False)
                return
            except asyncio.CancelledError:
                raise
            except Exception:
                await terminate_connection("E_AUTH_UNAVAILABLE", "暂时无法确认会话权限，采集已停止", 1011, wait=False)
                return

    async def start_asr(source_mode):
        async def open_source(src):
            session = create_asr_session(src, transcription_queue)
            asr_sessions[src] = session
            try:
                await session.connect()
            except Exception:
                await socket.send_json({"type": "error", "code": "E_ASR_UNAVAILABLE",
                    "message": f"{src} 语音识别连接失败，请检查网络与后端配置后重试",
                    "stage": "transcription", "source": src, "recoverable": False})
        await asyncio.gather(*(open_source(src) for src in ("mic", "system") if source_mode in (src, "both")))

    async def finish_asr(source=None):
        targets = [s for key, s in asr_sessions.items() if source is None or key == source]
        await asyncio.gather(*(s.finish() for s in targets), return_exceptions=True)

    try:
        first_message = await asyncio.wait_for(ws.receive(), timeout=15)
        if first_message["type"] == "websocket.disconnect":
            return
        first_text = first_message.get("text")
        if first_text is None:
            raise ProtocolError("E_HANDSHAKE", "first WebSocket message must be JSON")
        handshake = json.loads(first_text)
        if "config" in handshake and not handshake.get("type"):
            legacy_session, legacy_validator = await start_legacy_session(socket, handshake)
        else:
            hello = ClientHello.model_validate(handshake)
            await socket.send_json({"type": "ready", "protocol": PROTOCOL_NAME,
                                    "session_id": str(hello.session_id) if hello.session_id else None})
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                break
            raw, text = message.get("bytes"), message.get("text")
            if legacy_session is not None:
                if raw is not None:
                    error = legacy_validator.validate(raw)
                    if error:
                        await send_error(socket, "E_LEGACY_FRAME", error)
                    else:
                        legacy_session.record_frame(len(raw))
                continue
            if text is not None:
                payload = {}
                try:
                    if len(text) > 100000:
                        raise ProtocolError("E_CONTROL_MESSAGE", "control message too large")
                    payload = json.loads(text)
                    if not isinstance(payload, dict):
                        payload = {}
                        raise ProtocolError("E_CONTROL_MESSAGE", "control message must be an object")
                    msg_type = payload.get("type")
                    if msg_type == "config":
                        cfg = payload.get("llm") or {}
                        if not isinstance(cfg, dict):
                            raise ProtocolError("E_CONFIG", "llm config must be an object")
                        llm_config = {"enabled": cfg.get("enabled", True)}
                        if isinstance(cfg.get("max_tokens"), int):
                            llm_config["max_tokens"] = max(64, min(cfg["max_tokens"], 5000))
                        if cfg.get("model") in ("deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro"):
                            llm_config["model"] = cfg["model"]
                        if isinstance(payload.get("track"), str):
                            current_track[0] = payload["track"][:64]
                        await socket.send_json({"type": "config_ack", "llm": llm_config, "track": current_track[0]})
                    elif msg_type == "llm_cancel":
                        requested = payload.get("request_id")
                        target = llm_workers.get(requested) if requested else llm_worker_task
                        if target and not target.done():
                            target.cancel()
                    elif msg_type == "llm_query":
                        legacy_query = not payload.get("request_id")
                        if legacy_query:
                            payload["request_id"] = str(uuid.uuid4())
                        query = normalize_query(payload)
                        request_id = query["request_id"]
                        if v1_session is None:
                            raise ProtocolError("E_SESSION_STATE", "session_start is required before llm_query")
                        if llm_config.get("enabled") is False:
                            raise ProtocolError("E_LLM_DISABLED", "回答已暂停")
                        if request_id in llm_workers:
                            continue
                        if llm_worker_task and not llm_worker_task.done():
                            llm_worker_task.cancel()
                            if legacy_query:
                                await asyncio.gather(llm_worker_task, return_exceptions=True)
                        await socket.send_json({"type": "llm_start",
                            **{k: v for k, v in query.items() if k not in ("context", "track")},
                            "timestamp": int(_time.time() * 1000)})
                        llm_worker_task = asyncio.create_task(_llm_single(
                            socket, query["question_text"], query["language"], query["track"],
                            llm_service, llm_config.copy(), request_id=request_id,
                            context=query["context"], source_message_ids=query["source_message_ids"],
                            source_revisions=query["source_revisions"], context_version=query["context_version"]))
                        llm_workers[request_id] = llm_worker_task
                        # Enter worker before processing a queued immediate cancel.
                        await asyncio.sleep(0)
                    else:
                        if msg_type == "session_start":
                            session_message = SessionStart.model_validate(payload)
                            await authorize_audio_session(str(session_message.session_id), email)
                        if msg_type == "track_end":
                            ending = TrackEnd.model_validate(payload)
                            if v1_session is None:
                                raise ProtocolError("E_SESSION_STATE", "session_start is required")
                            require_session(ending.session_id, v1_session)
                            # Start both sources' finalization without blocking
                            # the next track_end; session_stopped awaits the same
                            # idempotent finish tasks and drains their revisions.
                            background_tasks.add(asyncio.create_task(finish_asr(ending.source)))
                        if msg_type == "session_stopped":
                            stopping = SessionStopped.model_validate(payload)
                            if v1_session is None:
                                raise ProtocolError("E_SESSION_STATE", "session_start is required")
                            require_session(stopping.session_id, v1_session)
                            await finish_asr()
                            if sender_task:
                                await asyncio.wait_for(transcription_queue.join(), 3)
                        was_new = v1_session is None
                        v1_session = await handle_control_message(socket, payload, v1_session, owner_root, capture_id)
                        if was_new and v1_session is not None:
                            active_key = (email, str(v1_session.session_id))
                            _active_sessions.setdefault(active_key, set()).add(stop_deleted_session)
                            background_tasks.add(asyncio.create_task(watch_authorization()))
                            sender_task = asyncio.create_task(_transcription_sender(socket, transcription_queue, current_track))
                            if llm_service.ready:
                                background_tasks.add(asyncio.create_task(llm_service.warmup()))
                            if _ASR_READY:
                                background_tasks.add(asyncio.create_task(start_asr(v1_session.source_mode)))
                            else:
                                await socket.send_json({"type": "error", "code": "E_ASR_UNAVAILABLE",
                                    "message": "语音识别未配置，请检查后端所选语音服务的凭据；可手动输入问题",
                                    "stage": "transcription", "recoverable": False})
                        if msg_type == "session_stopped":
                            await socket.send_json({"type": "session_stopped", "session_id": str(v1_session.session_id)})
                except (ProtocolError, ValidationError, ValueError, json.JSONDecodeError) as error:
                    code = error.code if isinstance(error, ProtocolError) else "E_CONTROL_MESSAGE"
                    if payload.get("type") == "llm_query":
                        await socket.send_json({"type": "llm_done", "request_id": payload.get("request_id"),
                                                "full_answer": "", "status": "failed", "error": str(error)})
                    else:
                        await send_error(socket, code, str(error))
                        if payload.get("type") == "session_start" and code == "E_SESSION_ACCESS":
                            # A resumed desktop must stop capturing if its saved
                            # interview was removed while the socket was offline.
                            await ws.close(code=4404)
                            break
                continue
            if raw is not None:
                try:
                    if v1_session is None or v1_session.status != "capturing":
                        raise ProtocolError("E_SESSION_STATE", "an active session is required before audio")
                    header, pcm = AudioPacketHeader.decode(raw)
                    require_session(header.session_id, v1_session)
                    track = v1_session.require_track(header.source)
                    ack = track.write_packet(header, pcm)
                    ack_counter += 1
                    if ack_counter % 10 == 0:
                        await socket.send_json(ack.model_dump())
                    if header.kind == "realtime" and header.source in asr_sessions:
                        asr_sessions[header.source].feed(pcm)
                except ProtocolError as error:
                    await send_error(socket, error.code, str(error))
    except WebSocketDisconnect:
        pass
    except Exception as error:
        logger.warning("Audio connection ended: %s", type(error).__name__)
        await safe_send_error(socket, "E_WEBSOCKET", "音频连接异常，请重新连接")
    finally:
        connection_finishing = True
        try:
            # The client cannot consume more answer text after disconnect; stop
            # generation immediately rather than waiting for ASR tail cleanup.
            for task in llm_workers.values():
                if not task.done():
                    task.cancel()
            for task in background_tasks:
                task.cancel()
            await asyncio.gather(*background_tasks, return_exceptions=True)
            await finish_asr()
            if sender_task:
                sender_task.cancel()
                await asyncio.gather(sender_task, return_exceptions=True)
            await asyncio.gather(*llm_workers.values(), return_exceptions=True)
            await llm_service.close()
        finally:
            try:
                if v1_session:
                    if session_deleted:
                        for track in v1_session.tracks.values():
                            track.close()
                    else:
                        v1_session.close_incomplete()
            except OSError:
                # A deletion on another worker may already have removed this
                # path. Never recreate the media directory from a stale socket.
                logger.warning("Audio files unavailable during connection cleanup")
            finally:
                if active_key:
                    callbacks = _active_sessions.get(active_key)
                    if callbacks is not None:
                        callbacks.discard(stop_deleted_session)
                        if not callbacks:
                            _active_sessions.pop(active_key, None)
                connection_done.set()


async def start_legacy_session(
    ws: WebSocket,
    handshake: dict[str, Any],
) -> tuple[AudioSession, PCMValidator]:
    config = AudioStreamConfig(**handshake.get("config", {}))
    session = AudioSession(
        session_id=handshake.get("session_id") or str(uuid.uuid4()),
        config=config,
    )
    validator = PCMValidator(config)
    await ws.send_json(
        {
            "type": "ready",
            "session_id": session.session_id,
            "config": config.model_dump(),
            "legacy": True,
        }
    )
    return session, validator


async def handle_control_message(
    ws: WebSocket,
    payload: dict[str, Any],
    session: V1AudioSession | None,
    owner_root=None,
    capture_id=None,
) -> V1AudioSession | None:
    message_type = payload.get("type")

    if message_type == "client_hello":
        ClientHello.model_validate(payload)
        await ws.send_json({"type": "ready", "protocol": PROTOCOL_NAME})
        return session

    if message_type == "session_start":
        message = SessionStart.model_validate(payload)
        if session is not None:
            raise ProtocolError("E_SESSION_STATE", "a session is already active on this WebSocket")
        session = V1AudioSession(
            session_id=message.session_id,
            source_mode=message.source_mode,
            storage_root=owner_root or storage_root(),
            capture_id=capture_id,
            started_at=message.started_at or datetime.now(timezone.utc),
        )
        await ws.send_json(
            {
                "type": "session_ready",
                "session_id": str(session.session_id),
            }
        )
        return session

    if session is None:
        raise ProtocolError("E_SESSION_STATE", "session_start is required")

    if message_type == "track_start":
        message = TrackStart.model_validate(payload)
        require_session(message.session_id, session)
        fmt = message.audio_format
        if fmt.sample_rate != 16000 or fmt.channels != 1 or fmt.bits_per_sample != 16:
            raise ProtocolError("E_AUDIO_FORMAT", "实时转写要求 16kHz、单声道、16-bit PCM")
        session.start_track(message.source, fmt)
        await ws.send_json(
            {
                "type": "track_ready",
                "session_id": str(session.session_id),
                "source": message.source,
            }
        )
    elif message_type == "track_end":
        message = TrackEnd.model_validate(payload)
        require_session(message.session_id, session)
        session.require_track(message.source).close_realtime()
    elif message_type == "session_stopped":
        message = SessionStopped.model_validate(payload)
        require_session(message.session_id, session)
        session.stop(message.stop_reason)
    elif message_type == "file_start":
        message = FileStart.model_validate(payload)
        require_session(message.session_id, session)
        session.require_track(message.source).start_backfill(message.total_bytes, message.sha256)
    elif message_type == "file_end":
        message = FileEnd.model_validate(payload)
        require_session(message.session_id, session)
        track = session.require_track(message.source)
        track.finish_backfill(message.total_bytes, message.sha256)
        await ws.send_json(
            {
                "type": "file_complete",
                "session_id": str(session.session_id),
                "source": message.source,
                "bytes": track.canonical_path.stat().st_size,
            }
        )
    elif message_type == "session_complete":
        message = SessionComplete.model_validate(payload)
        require_session(message.session_id, session)
        session.complete()
        await ws.send_json(
            {
                "type": "session_complete",
                **session.to_dict(),
            }
        )
    else:
        raise ProtocolError("E_CONTROL_TYPE", f"unknown control message type: {message_type}")

    session.persist_metadata()
    return session


def require_session(session_id: uuid.UUID, session: V1AudioSession) -> None:
    if session_id != session.session_id:
        raise ProtocolError("E_SESSION_ID", "control message session does not match active session")


async def send_error(ws: WebSocket, code: str, message: str) -> None:
    await ws.send_json({"type": "error", "code": code, "message": message})


async def safe_send_error(ws: WebSocket, code: str, message: str) -> None:
    try:
        await send_error(ws, code, message)
    except Exception:
        pass


async def _transcription_sender(ws, queue: asyncio.Queue, track=None):
    """Per-connection queue; each event revises one utterance snapshot."""
    from app.services.asr_text_corrector import correct_asr_text
    try:
        while True:
            event = await queue.get()
            try:
                if isinstance(event, tuple):
                    text, final, source = event
                    event = {"type": "transcription", "text": text, "is_final": final, "source": source}
                if event.get("type") == "transcription":
                    raw_text = event["text"]
                    track_key = track[0] if isinstance(track, list) else track
                    try:
                        corrected = correct_asr_text(raw_text, track_key)
                    except Exception:
                        corrected = raw_text
                    event = {**event, "raw_text": raw_text, "text": corrected}
                await ws.send_json(event)
            finally:
                queue.task_done()
    except asyncio.CancelledError:
        raise


async def _llm_single(ws, question: str, language: str, track: str,
                      llm_service: LLMService, llm_config: dict[str, Any],
                      request_id: str | None = None, context=None,
                      source_message_ids=None, source_revisions=None, context_version=None):
    """Forward deltas immediately; every terminal event retains its request id."""
    request_id = request_id or str(uuid.uuid4())
    context = context or {}
    source_message_ids, source_revisions = source_message_ids or [], source_revisions or []
    max_tokens = llm_config.get("max_tokens") or answer_token_budget(context)
    model = llm_config.get("model")
    full_answer, status, error = "", "completed", None
    metadata = {}
    start_time, first_chunk_ms, chunk_index = _time.monotonic(), None, 0
    stream = llm_service.stream_answer(
        question, model=model, max_tokens=max_tokens, language=language, track=track,
        context=context, result_metadata=metadata,
    )
    try:
        async for chunk, final in stream:
            if chunk:
                full_answer += chunk
                if first_chunk_ms is None:
                    first_chunk_ms = round((_time.monotonic() - start_time) * 1000)
                await ws.send_json({"type": "llm_chunk", "request_id": request_id, "delta": chunk,
                                    "chunk_index": chunk_index, "timestamp": int(_time.time() * 1000)})
                chunk_index += 1
        reason = metadata.get("finish_reason")
        if reason == "length":
            status = "truncated"
        elif reason and reason != "stop":
            status, error = "failed", "回答被服务中断，已保留生成内容"
    except asyncio.CancelledError:
        status = "cancelled"
    except Exception as exc:
        status = "failed"
        error = str(exc) if isinstance(exc, RuntimeError) else "回答暂不可用，请重试"
        logger.warning("LLM request failed: %s", type(exc).__name__)
    finally:
        try:
            await stream.aclose()
        except Exception:
            pass
        try:
            await ws.send_json({"type": "llm_done", "request_id": request_id,
                "full_answer": full_answer, "status": status, "error": error,
                "source_refs": [{"message_id": value, "revision": source_revisions[i] if i < len(source_revisions) else None}
                                for i, value in enumerate(source_message_ids)],
                "context_version": context_version, "timestamp": int(_time.time() * 1000),
                "timing": {"first_chunk_ms": first_chunk_ms,
                           "total_ms": round((_time.monotonic() - start_time) * 1000)}})
        except Exception:
            pass
