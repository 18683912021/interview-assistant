import asyncio
import json
import logging
import os
import time as _time
import uuid
from datetime import datetime, timezone
from typing import Any

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
from app.services.llm_service import LLMService
from app.services.stt_streaming import StreamingASRSession

logger = logging.getLogger("audio")
router = APIRouter()

# 火山引擎 API Key（新版控制台，Realtime API）
_VOLC_API_KEY = os.getenv("VOLC_API_KEY", "")
_ASR_READY = bool(_VOLC_API_KEY)

# 0.5: mode → max_tokens 路由
# 5000 tokens ≈ 1500-1800 汉字，四维度深度回答绰绰有余
LLM_MAX_TOKENS = 5000


@router.websocket("/ws/audio/stream")
async def audio_stream(ws: WebSocket):
    await ws.accept()
    logger.info("WebSocket 已连接")

    global _transcription_queue, _old_sender_task
    # 如果有旧连接残留的 sender task，先取消
    if '_old_sender_task' in globals() and _old_sender_task is not None and not _old_sender_task.done():
        _old_sender_task.cancel()
    _transcription_queue = asyncio.Queue(maxsize=256)
    sender_task: "asyncio.Task | None" = None

    # ── LLM 上下文（per-connection，按需启动） ──
    llm_worker_task: "asyncio.Task | None" = None
    llm_service: LLMService | None = None
    llm_config: dict[str, Any] = {}  # FE 可通过 config 帧动态覆盖 enabled/max_tokens/model
    current_track: list[str] = ["javascript"]  # 可变容器，sender 和 config handler 共享引用

    legacy_session: AudioSession | None = None
    legacy_validator: PCMValidator | None = None
    v1_session: V1AudioSession | None = None
    asr_sessions: dict[str, StreamingASRSession] = {}
    ack_counter = 0

    try:
        first_message = await ws.receive()
        if first_message["type"] == "websocket.disconnect":
            return
        first_text = first_message.get("text")
        if first_text is None:
            await send_error(ws, "E_HANDSHAKE", "first WebSocket message must be JSON")
            await ws.close(code=1008)
            return

        handshake = json.loads(first_text)
        if "config" in handshake and not handshake.get("type"):
            legacy_session, legacy_validator = await start_legacy_session(ws, handshake)
        else:
            hello = ClientHello.model_validate(handshake)
            await ws.send_json(
                {
                    "type": "ready",
                    "protocol": PROTOCOL_NAME,
                    "session_id": str(hello.session_id) if hello.session_id else None,
                }
            )

        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                break

            raw = message.get("bytes")
            text = message.get("text")

            if legacy_session is not None:
                if raw is None:
                    continue
                error = legacy_validator.validate(raw) if legacy_validator else "validator 未初始化"
                if error:
                    legacy_session.errors.append(error)
                    await send_error(ws, "E_LEGACY_FRAME", error)
                    continue
                legacy_session.record_frame(len(raw))
                continue

            if text is not None:
                try:
                    payload = json.loads(text)
                    msg_type = payload.get("type")

                    if msg_type == "config":
                        # ── FE 动态 LLM 配置（enabled/max_tokens/model） ──
                        llm_cfg = payload.get("llm")
                        if llm_cfg is not None and not isinstance(llm_cfg, dict):
                            raise ProtocolError("E_CONFIG", "llm config must be an object")
                        if llm_cfg is not None:
                            llm_config["enabled"] = llm_cfg.get("enabled", True)
                            llm_config["max_tokens"] = llm_cfg.get("max_tokens")
                            llm_config["model"] = llm_cfg.get("model")
                        else:
                            llm_config.clear()
                        # 赛道切换
                        track_val = payload.get("track")
                        if track_val and isinstance(track_val, str):
                            current_track[0] = track_val.lower()
                        logger.info("LLM config 已更新: %s, track=%s", llm_config, current_track[0])
                        await ws.send_json({"type": "config_ack", "llm": llm_config, "track": current_track[0]})

                    elif msg_type == "llm_query":
                        # ── 手动触发 LLM——总是响应用户最新点击 ──
                        if v1_session is None:
                            raise ProtocolError("E_SESSION_STATE", "session_start is required before llm_query")
                        if llm_config.get("enabled") is False:
                            raise ProtocolError("E_LLM_DISABLED", "LLM 已被 config 禁用")
                        text_val = payload.get("text", "")
                        language = payload.get("language", "zh")
                        if language not in ("zh", "en"):
                            raise ProtocolError("E_CONTROL_MESSAGE", f"invalid language: {language}")
                        if not text_val:
                            raise ProtocolError("E_CONTROL_MESSAGE", "llm_query requires text")

                        if llm_service is None:
                            llm_service = LLMService()
                        if not llm_service.ready:
                            await send_error(ws, "E_LLM_UNAVAILABLE", "LLM 服务不可用，请检查 API Key")
                            continue

                        # request_id：新协议下新旧请求互相隔离，取消无须串行等待
                        request_id = payload.get("request_id")

                        # 取消正在进行的旧回答，立即响应新请求
                        if llm_worker_task is not None and not llm_worker_task.done():
                            llm_worker_task.cancel()
                            if not request_id:
                                # 老客户端（无 request_id）：等待旧任务完全退出，
                                # 防止其 llm_done 覆盖新气泡
                                try:
                                    await asyncio.wait_for(llm_worker_task, timeout=2.0)
                                except (asyncio.CancelledError, asyncio.TimeoutError):
                                    pass
                            # 有 request_id：不等待，旧任务后台退场（其 llm_done 带旧 id，
                            # 前端按 id 过滤），新请求零延迟启动

                        track = payload.get("track", "javascript")
                        # llm_start 由 handler 立即发送（在 create_task 前）：快速连点/取消旧任务
                        # 时新回答的提示零延迟上屏（worker 内发送会与旧任务退场竞争）
                        await ws.send_json({
                            "type": "llm_start",
                            "question_text": text_val,
                            "language": language,
                            "request_id": request_id,
                            "timestamp": int(_time.time() * 1000),
                        })
                        llm_worker_task = asyncio.create_task(
                            _llm_single(ws, text_val, language, track, llm_service, llm_config, request_id=request_id)
                        )
                        logger.info("LLM 新请求: lang=%s track=%s text=%.60s", language, track, text_val)
                    else:
                        # 非 llm_query 控制消息（session_start / track_start 等）
                        was_new = v1_session is None
                        v1_session = await handle_control_message(ws, payload, v1_session)
                        # 新会话建立后：预热 DeepSeek 连接（首个 llm_query 免 ~1.1s 握手），
                        # 并按轨迹创建 ASR 连接（LLM worker 按需启动）
                        if was_new and v1_session is not None:
                            if llm_service is None and os.getenv("ANTHROPIC_API_KEY"):
                                llm_service = LLMService()
                                asyncio.create_task(llm_service.warmup())
                        if was_new and v1_session is not None and _ASR_READY:
                            if sender_task is None:
                                sender_task = asyncio.create_task(
                                    _transcription_sender(ws, current_track[0])
                                )
                            source_mode = payload.get("source_mode", "mic")
                            track_sources: list[str] = []
                            if source_mode in ("mic", "both"):
                                track_sources.append("mic")
                            if source_mode in ("system", "both"):
                                track_sources.append("system")
                            for src in track_sources:
                                try:
                                    s = StreamingASRSession(
                                        api_key=_VOLC_API_KEY,
                                        source=src,
                                        tx_queue=_transcription_queue,
                                    )
                                    await s.connect()
                                    asr_sessions[src] = s
                                    logger.info("实时 ASR [%s] 已启动", src)
                                except Exception:
                                    logger.exception("ASR [%s] 连接失败", src)
                except (ProtocolError, ValidationError, ValueError, json.JSONDecodeError) as error:
                    code = error.code if isinstance(error, ProtocolError) else "E_CONTROL_MESSAGE"
                    await send_error(ws, code, str(error))
                continue

            if raw is not None:
                try:
                    if v1_session is None:
                        raise ProtocolError("E_SESSION_STATE", "session_start is required before binary packets")
                    header, pcm_payload = AudioPacketHeader.decode(raw)
                    if header.session_id != v1_session.session_id:
                        raise ProtocolError("E_SESSION_ID", "binary packet session does not match active session")
                    track = v1_session.require_track(header.source)
                    ack = track.write_packet(header, pcm_payload)
                    # ACK 降频：每 10 帧发一次，避免锁死 WebSocket
                    ack_counter += 1
                    if ack_counter % 10 == 0:
                        await ws.send_json(ack.model_dump())
                    # 实时 ASR：按 source 路由到对应会话
                    s = asr_sessions.get(header.source)
                    if s is not None:
                        s.feed(pcm_payload)
                except ProtocolError as error:
                    await send_error(ws, error.code, str(error))

    except WebSocketDisconnect:
        pass
    except Exception as error:
        logger.exception("音频 WebSocket 异常")
        await safe_send_error(ws, "E_WEBSOCKET", str(error))
    finally:
        # 1. 先停 sender（不再往前端发）
        if sender_task is not None:
            sender_task.cancel()
            _old_sender_task = sender_task  # 防止重连时旧 task 泄漏
        # 2. 停 ASR 会话（不再往里发转录）
        for s in asr_sessions.values():
            try:
                await s.finish()
            except Exception:
                pass
        asr_sessions.clear()
        # 3. 停 LLM worker
        if llm_worker_task is not None:
            llm_worker_task.cancel()
        if llm_service is not None:
            try:
                await llm_service.close()
            except Exception:
                pass
        for s in asr_sessions.values():
            try:
                await s.finish()
            except Exception:
                pass
        asr_sessions.clear()
        if _transcription_queue:
            # 清空队列
            while not _transcription_queue.empty():
                try:
                    _transcription_queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
        if v1_session is not None:
            v1_session.close_incomplete()
            logger.info(
                "v1 会话 %s 结束 | 状态=%s",
                v1_session.session_id,
                v1_session.status,
            )
        if legacy_session is not None:
            stats = legacy_session.to_stats()
            logger.info(
                "legacy 会话 %s 结束 | 帧数=%d 字节=%d 时长=%.1fms 错误=%d",
                stats.session_id,
                stats.frames_received,
                stats.bytes_received,
                stats.duration_ms,
                len(legacy_session.errors),
            )
            try:
                await ws.send_json({"type": "stats", **stats.model_dump()})
            except Exception:
                pass


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
            storage_root=storage_root(),
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
        session.start_track(message.source, message.audio_format)
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


async def _transcription_sender(ws: WebSocket, track: str | None = None):
    """后台任务：从队列取转录消息并发送到客户端。
    发送前先经 asr_text_corrector 纠正，前端看到的已是修正后的文本。"""
    from app.services.asr_text_corrector import correct_asr_text

    logger.info("转录发送器已启动（含ASR纠正，track=%s）", track)
    try:
        while True:
            text, is_final, source = await _transcription_queue.get()
            logger.info("转录发送器收到: [%s] %s (final=%s)", source, text[:50], is_final)
            try:
                corrected = correct_asr_text(text, track)
            except Exception as e:
                logger.exception("ASR 纠正异常，用原文: %.30s", text[:30])
                corrected = text
            try:
                await ws.send_json({
                    "type": "transcription",
                    "text": corrected,
                    "is_final": is_final,
                    "source": source,
                })
                if corrected != text:
                    logger.info("转录纠正[%s]: %.30s → %.30s", source, text, corrected)
                else:
                    logger.debug("转录已发送[%s]: %s", source, corrected[:50])
            except Exception:
                logger.debug("转录发送器 WebSocket 已断开")
                break
    except asyncio.CancelledError:
        pass


async def _llm_single(
    ws: WebSocket,
    question: str,
    language: str,
    track: str,
    llm_service: LLMService,
    llm_config: dict[str, Any],
    request_id: str | None = None,
):
    """处理单次 LLM 请求——被新请求取消时立即停止。

    协议（v2 — 对标 FE 三态）：
        llm_start  → FE 创建 AI loading 气泡
        llm_chunk  → FE 追加 delta 到当前 AI 气泡
        llm_done   → FE 标记 done（含取消/失败场景）
    """
    model: str = llm_config.get("model") or "deepseek-v4-flash"
    max_tokens: int = llm_config.get("max_tokens") or LLM_MAX_TOKENS
    full_answer: str = ""

    try:
        chunk_queue: "asyncio.Queue[dict[str, Any] | None]" = asyncio.Queue(maxsize=64)

        async def _chunk_sender():
            while True:
                msg = await chunk_queue.get()
                if msg is None:
                    break
                await ws.send_json(msg)

        sender_task = asyncio.create_task(_chunk_sender())

        chunk_index: int = 0
        async for chunk, is_final in llm_service.stream_answer(
            question, model=model, max_tokens=max_tokens, language=language, track=track,
        ):
            full_answer += chunk
            if chunk:
                chunk_queue.put_nowait({
                    "type": "llm_chunk",
                    "chunk_index": chunk_index,
                    "delta": chunk,
                    "request_id": request_id,
                    "timestamp": int(_time.time() * 1000),
                })
                chunk_index += 1
            if is_final:
                # is_final 常与最后一个 content 块同包（DeepSeek 也可能整段一块返回），
                # 内容已入队（done 时前端全量替换，不重复）；空串仅表示结束
                break

        chunk_queue.put_nowait(None)
        await sender_task

        await ws.send_json({
            "type": "llm_done",
            "full_answer": full_answer,
            "request_id": request_id,
            "timestamp": int(_time.time() * 1000),
        })
        logger.info("LLM 完成: %.50s → %d chunks", question, chunk_index + 1)

    except asyncio.CancelledError:
        logger.info("LLM 被新请求中断: %.50s", question)
        if 'sender_task' in locals() and not sender_task.done():
            try:
                chunk_queue.put_nowait(None)
                sender_task.cancel()
            except Exception:
                pass
        try:
            await ws.send_json({
                "type": "llm_done",
                "full_answer": full_answer,
                "request_id": request_id,
                "timestamp": int(_time.time() * 1000),
            })
        except Exception:
            pass

    except Exception as exc:
        logger.exception("LLM 失败: %.50s", question)
        if 'sender_task' in locals() and not sender_task.done():
            try:
                chunk_queue.put_nowait(None)
                sender_task.cancel()
            except Exception:
                pass
        try:
            await ws.send_json({
                "type": "llm_done",
                "full_answer": f"[生成失败] {exc}",
                "error": str(exc),
                "request_id": request_id,
                "timestamp": int(_time.time() * 1000),
            })
        except Exception:
            pass
