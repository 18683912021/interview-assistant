"""Continuous Volcengine ASR, binary protocol v1 over the v3 WebSocket API.

Reference: https://docs.volcengine.com/docs/DoubaoVoice/bidirectional-streaming-automatic-speech-recognition-websocket
A provider-confirmed utterance is distinct from the last packet of the stream.
Audio silence never closes this connection or manufactures a final transcript.
"""
import asyncio
import gzip
import json
import logging
import os
import re
import ssl
import struct
import uuid
from dataclasses import dataclass
from typing import Any

import websockets
import certifi
from app.services.ai_config import read_proxy_config

logger = logging.getLogger("stt_streaming")
WS_ENDPOINT = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"


def configured_resource_id() -> str:
    resource = os.getenv("VOLC_ASR_RESOURCE_ID", "").strip() or "volc.seedasr.sauc.duration"
    if resource not in {
        "volc.seedasr.sauc.duration", "volc.seedasr.sauc.concurrent",
        "volc.bigasr.sauc.duration", "volc.bigasr.sauc.concurrent",
    }:
        raise ValueError("VOLC_ASR_RESOURCE_ID must be a supported streaming ASR resource")
    return resource


RESOURCE_ID = configured_resource_id()
PACKET_BYTES = 6400  # 200 ms, 16 kHz mono PCM signed 16-bit little-endian
FINISH_CONNECT_TIMEOUT = 3.0


class ASRProtocolError(ValueError):
    pass


@dataclass(frozen=True)
class ASRResponse:
    payload: dict[str, Any]
    sequence: int | None = None
    is_last: bool = False
    error_code: int | None = None


def provider_failure(response: ASRResponse) -> tuple[str, str, str]:
    """Classify the provider's reason without exposing its raw payload.

    45000292 covers multiple quota types. A concurrency refusal must not be
    mistaken for exhausted audio duration (or solved by retrying indefinitely).
    """
    details = []
    for field in ("error", "message"):
        value = response.payload.get(field)
        if isinstance(value, dict):
            value = value.get("message")
        if isinstance(value, str):
            details.append(value[:2048].lower())
    detail = " ".join(details)
    suffix = f"（{response.error_code}）"
    if "quota exceeded" in detail:
        if "concurrency" in detail:
            return ("E_ASR_CONCURRENCY", "concurrency",
                    f"语音识别并发额度已满{suffix}，请稍后继续，或联系管理员增加并发额度")
        if "audio_duration" in detail:
            return ("E_ASR_QUOTA", "audio_duration",
                    f"语音识别可用时长额度不足{suffix}，请联系管理员检查服务额度")
        return ("E_ASR_QUOTA", "quota",
                f"语音识别服务额度受限{suffix}，请联系管理员检查并发与用量额度")
    if response.error_code == 45000292:
        return ("E_ASR_QUOTA", "quota_unspecified",
                f"语音识别服务额度受限{suffix}，请联系管理员检查并发与用量额度")
    messages = {
        45000001: ("invalid_request", "语音识别请求参数有误，请联系管理员检查服务配置"),
        45000002: ("empty_audio", "未收到有效音频，请检查音源后继续"),
        45000081: ("audio_timeout", "语音识别等待音频超时，请检查音源后继续"),
        45000151: ("invalid_audio", "语音识别音频格式有误，请联系管理员检查采集配置"),
        55000031: ("provider_busy", "语音识别服务暂时繁忙，请稍后继续"),
    }
    reason, message = messages.get(response.error_code, ("unknown", "语音识别服务暂不可用，请稍后重试"))
    return "E_ASR_PROVIDER", reason, f"{message}{suffix}"


def _header(msg_type: int, flags: int, ser: int, comp: int) -> bytes:
    return bytes((0x11, (msg_type << 4) | flags, (ser << 4) | comp, 0))


def parse_server_frame(raw: bytes) -> ASRResponse:
    """Decode framing before decoding JSON; never scan compressed bytes for '{'."""
    if len(raw) < 8:
        raise ASRProtocolError("ASR frame is too short")
    if raw[0] >> 4 != 1:
        raise ASRProtocolError("Unsupported ASR binary protocol version")
    offset = (raw[0] & 0xF) * 4
    if offset < 4 or offset > len(raw):
        raise ASRProtocolError("Invalid ASR header size")
    msg_type, flags = raw[1] >> 4, raw[1] & 0xF
    serialization, compression = raw[2] >> 4, raw[2] & 0xF
    sequence = None
    error_code = None
    if msg_type == 0xF:
        if len(raw) < offset + 4:
            raise ASRProtocolError("Missing ASR error code")
        error_code = struct.unpack_from(">I", raw, offset)[0]
        offset += 4
    elif msg_type == 0x9:
        if flags & 1:
            if len(raw) < offset + 4:
                raise ASRProtocolError("Missing ASR sequence")
            sequence = struct.unpack_from(">i", raw, offset)[0]
            offset += 4
    else:
        raise ASRProtocolError(f"Unexpected ASR message type {msg_type}")
    if len(raw) < offset + 4:
        raise ASRProtocolError("Missing ASR payload size")
    size = struct.unpack_from(">I", raw, offset)[0]
    offset += 4
    if len(raw) != offset + size:
        raise ASRProtocolError("ASR payload size mismatch")
    body = raw[offset:]
    if compression == 1:
        try:
            body = gzip.decompress(body)
        except (OSError, EOFError) as exc:
            raise ASRProtocolError("Invalid ASR gzip payload") from exc
    elif compression != 0:
        raise ASRProtocolError("Unsupported ASR compression")
    if error_code is not None:
        try:
            payload = json.loads(body)
        except (ValueError, UnicodeDecodeError):
            payload = {"message": body.decode("utf-8", errors="replace")}
        if not isinstance(payload, dict):
            payload = {"message": str(payload)}
        return ASRResponse(payload, error_code=error_code)
    if serialization != 1:
        raise ASRProtocolError("Expected JSON ASR response")
    try:
        payload = json.loads(body)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ASRProtocolError("Invalid ASR JSON payload") from exc
    if not isinstance(payload, dict):
        raise ASRProtocolError("Expected object ASR payload")
    return ASRResponse(payload, sequence, bool(flags & 2))


class StreamingASRSession:
    """A separate connection, queue, and transcript namespace for each audio source."""
    def __init__(self, api_key: str, source: str, tx_queue: asyncio.Queue):
        self._api_key = api_key
        self._source = source
        self._tx_queue = tx_queue
        self._ws = None
        self._recv_task = None
        self._send_task = None
        self._reconnect_task = None
        self._connect_task = None
        self._finish_task = None
        self._send_queue: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=250)
        self._running = False
        self._connecting = False
        self._closing = False
        self._seq = 1
        self._stream_id = str(uuid.uuid4())
        self._segments: dict[str, dict[str, Any]] = {}
        self._next_segment = 0
        self._all_text: dict[str, str] = {}
        self._finished = asyncio.Event()
        self._response_done = asyncio.Event()
        self._provider_error_code: int | None = None
        self._overflow_reported = False
        self._audio_received = False

    async def connect(self) -> None:
        if self._closing:
            return
        if self._connect_task and not self._connect_task.done():
            await asyncio.shield(self._connect_task)
            return
        self._connecting = True
        self._connect_task = asyncio.create_task(self._connect())
        try:
            await self._connect_task
        finally:
            self._connecting = False

    async def _connect(self) -> None:
        self._finished.clear()
        self._response_done.clear()
        self._provider_error_code = None
        self._seq = 1
        self._stream_id = str(uuid.uuid4())
        self._segments = {}
        proxy, trust_env = read_proxy_config("ASR")
        self._ws = await websockets.connect(
            WS_ENDPOINT, ping_interval=20, ping_timeout=10, open_timeout=8, close_timeout=3,
            # websockets 15 otherwise inherits desktop/system proxies implicitly.
            # Keep server traffic direct unless ASR explicitly opts into a proxy.
            proxy=proxy if proxy is not None else True if trust_env else None,
            ssl=ssl.create_default_context(cafile=os.getenv("SSL_CERT_FILE") or certifi.where()),
            max_size=4 * 1024 * 1024,
            additional_headers={
                "X-Api-Key": self._api_key,
                "X-Api-Resource-Id": RESOURCE_ID,
                "X-Api-Request-Id": self._stream_id,
                "X-Api-Connect-Id": self._stream_id,
                "X-Api-Sequence": "-1",
            },
        )
        # A stop during the initial handshake still drains audio already queued.
        # A connection arriving after finalization must never start new workers.
        if self._closing and (self._finish_task is None or self._finish_task.done()):
            await self._ws.close()
            return
        config = {
            "user": {"uid": "interview-desktop"},
            "audio": {"format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1},
            "request": {
                "model_name": "bigmodel", "enable_itn": True, "enable_punc": True,
                "show_utterances": True, "result_type": "full", "enable_nonstream": True,
                # No首字加速: unstable early words hurt technical terms. Clicking a
                # partial transcript is allowed; finalization does not gate the LLM.
                "end_window_size": 1000,
            },
        }
        body = gzip.compress(json.dumps(config).encode())
        try:
            await self._ws.send(_header(1, 0, 1, 1) + struct.pack(">I", len(body)) + body)
        except BaseException:
            await self._ws.close()
            raise
        # The server auto-assigns sequence 1 to the full request even though that
        # frame omits an explicit sequence. The first audio frame must be 2.
        self._seq = 2
        self._running = True
        self._recv_task = asyncio.create_task(self._recv_loop())
        self._send_task = asyncio.create_task(self._send_loop())

    def feed(self, pcm: bytes) -> None:
        if self._closing or self._provider_error_code is not None or not pcm:
            return
        self._audio_received = True
        try:
            self._send_queue.put_nowait(pcm)
        except asyncio.QueueFull:
            if not self._overflow_reported:
                self._overflow_reported = True
                self._emit_error("E_ASR_BACKPRESSURE", "语音识别连接过慢，部分实时转写可能缺失，录音记录仍保留")
        if not self._running and not self._connecting:
            self._schedule_reconnect()

    def _emit_error(self, code: str, message: str, *, recoverable: bool = True, provider_code: int | None = None) -> None:
        try:
            event = {"type": "error", "code": code, "message": message,
                     "stage": "transcription", "source": self._source, "recoverable": recoverable}
            if provider_code is not None:
                event["provider_code"] = provider_code
            self._tx_queue.put_nowait(event)
        except asyncio.QueueFull:
            logger.warning("ASR output queue full")

    async def _send_audio(self, pcm: bytes, final: bool = False) -> None:
        if self._ws is None:
            return
        seq = -self._seq if final else self._seq
        self._seq += 1
        await self._ws.send(_header(2, 3 if final else 1, 0, 0)
                            + struct.pack(">iI", seq, len(pcm)) + pcm)

    async def _send_loop(self) -> None:
        pending = bytearray()
        try:
            while self._running:
                pcm = await self._send_queue.get()
                if pcm is None:
                    await self._send_audio(bytes(pending), final=True)
                    return
                pending.extend(pcm)
                while len(pending) >= PACKET_BYTES:
                    await self._send_audio(bytes(pending[:PACKET_BYTES]))
                    del pending[:PACKET_BYTES]
        except asyncio.CancelledError:
            raise
        except Exception:
            self._running = False
            self._emit_error("E_ASR_CONNECTION", "语音识别连接中断，正在恢复；中断片段可能不完整")
            self._schedule_reconnect()

    def _parse_response(self, raw: bytes | str) -> ASRResponse:
        if not isinstance(raw, bytes):
            raise ASRProtocolError("Expected binary ASR response")
        return parse_server_frame(raw)

    def _reject_response(self, response: ASRResponse) -> None:
        self._provider_error_code = response.error_code
        code, reason, message = provider_failure(response)
        headers = getattr(getattr(self._ws, "response", None), "headers", {})
        log_id = headers.get("X-Tt-Logid", "")
        if not isinstance(log_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", log_id):
            log_id = "unavailable"
        logger.warning("ASR rejected: source=%s code=%s reason=%s resource=%s request_id=%s log_id=%s",
                       self._source, response.error_code, reason, RESOURCE_ID, self._stream_id, log_id)
        self._emit_error(code, message, recoverable=False, provider_code=response.error_code)
        self._running = False

    async def _recv_loop(self) -> None:
        try:
            async for raw in self._ws:
                response = self._parse_response(raw)
                if response.error_code is not None:
                    self._reject_response(response)
                    break
                await self._consume(response)
                if response.is_last:
                    self._finished.set()
                    break
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("ASR receive failed: %s", type(exc).__name__)
            self._emit_error("E_ASR_CONNECTION", "语音识别连接中断，正在恢复；中断片段可能不完整")
        finally:
            self._running = False
            # A provider rejection is not a broken transport. Retrying the same
            # invalid request can consume quota and obscure the original error.
            if self._provider_error_code is not None:
                if self._send_task:
                    self._send_task.cancel()
                    await asyncio.gather(self._send_task, return_exceptions=True)
                # Release rejected streams even if a client never acknowledges
                # the error. Stop sending/queuing audio until an explicit restart.
                while not self._send_queue.empty():
                    self._send_queue.get_nowait()
                try:
                    await self._ws.close()
                except Exception:
                    logger.warning("ASR rejected stream close failed: source=%s", self._source)
            self._response_done.set()
            if not self._closing and self._provider_error_code is None:
                self._schedule_reconnect()

    async def _consume(self, response: ASRResponse) -> None:
        # raw protocol carries result directly; also accept official demo wrappers.
        body = response.payload.get("payload_msg", response.payload)
        results = body.get("result", {})
        if isinstance(results, dict):
            results = [results]
        if not isinstance(results, list):
            raise ASRProtocolError("Invalid ASR result")
        for result in results:
            utterances = result.get("utterances") or []
            if not utterances and result.get("text"):
                # Compatibility for providers without utterances: one mutable
                # snapshot; only an actual final frame may finalize it.
                draft = result["text"]
                confirmed = "".join(item["text"] for item in self._segments.values() if item["is_final"])
                if confirmed and draft.startswith(confirmed):
                    draft = draft[len(confirmed):]
                utterances = [{"text": draft, "start_time": 0, "end_time": 0,
                               "definite": response.is_last, "_untimed": True}]
            assigned: set[str] = set()
            for utterance in utterances:
                text = utterance.get("text", "")
                if not isinstance(text, str) or not text:
                    continue
                start = int(utterance.get("start_time", 0))
                end = int(utterance.get("end_time", start))
                key = "draft" if utterance.get("_untimed") else str(start)
                existing = self._segments.get(key)
                # A draft timestamp may move after two-pass correction. Preserve
                # its identity when its audio interval still overlaps.
                if existing is None:
                    for candidate in self._segments.values():
                        if candidate["utterance_id"] not in assigned and not candidate["is_final"] and (candidate.get("timing_pending") or (
                            start < candidate["end_time"] and end > candidate["start_time"])):
                            existing = candidate
                            break
                final = utterance.get("definite") is True or response.is_last
                if existing:
                    assigned.add(existing["utterance_id"])
                if existing and existing["is_final"] and not final:
                    continue
                if existing and existing["text"] == text and existing["is_final"] == final and existing["end_time"] == end:
                    continue
                if existing is None:
                    self._next_segment += 1
                event = {"type": "transcription", "text": text, "source": self._source,
                         "utterance_id": existing["utterance_id"] if existing else f"{self._stream_id}:{self._source}:{start}:{self._next_segment}",
                         "revision": existing["revision"] + 1 if existing else 1,
                         "start_time": start, "end_time": end, "is_final": final,
                         "provider_final": final, "stream_id": self._stream_id,
                         "timing_pending": bool(utterance.get("_untimed"))}
                if existing is not None:
                    for old_key, old in list(self._segments.items()):
                        if old["utterance_id"] == event["utterance_id"]:
                            del self._segments[old_key]
                self._segments[key] = event
                assigned.add(event["utterance_id"])
                self._all_text[event["utterance_id"]] = text
                await self._tx_queue.put(event)

    def _schedule_reconnect(self) -> None:
        if self._closing or (self._reconnect_task and not self._reconnect_task.done()):
            return
        self._reconnect_task = asyncio.create_task(self._reconnect())

    async def _reconnect(self) -> None:
        for task in (self._send_task, self._recv_task):
            if task and not task.done():
                task.cancel()
        await asyncio.gather(*(t for t in (self._send_task, self._recv_task) if t), return_exceptions=True)
        if self._ws:
            await self._ws.close()
        for delay in (0.5, 1, 2, 4, 8):
            if self._closing:
                return
            await asyncio.sleep(delay)
            try:
                await self.connect()
                self._overflow_reported = False
                return
            except Exception as exc:
                logger.warning("ASR reconnect failed: %s", type(exc).__name__)
        self._emit_error("E_ASR_UNAVAILABLE", "实时转写暂不可用，请检查网络后重试；可手动输入问题", recoverable=False)

    async def finish(self) -> str:
        if self._finish_task is None:
            self._finish_task = asyncio.create_task(self._finish())
        return await asyncio.shield(self._finish_task)

    async def _finish(self) -> str:
        self._closing = True
        if self._reconnect_task and not self._reconnect_task.done():
            self._reconnect_task.cancel()
            await asyncio.gather(self._reconnect_task, return_exceptions=True)
        if self._connect_task and not self._connect_task.done():
            try:
                await asyncio.wait_for(asyncio.shield(self._connect_task), FINISH_CONNECT_TIMEOUT)
            except Exception:
                self._connect_task.cancel()
                await asyncio.gather(self._connect_task, return_exceptions=True)
        confirmed = self._finished.is_set()
        if self._running and self._send_task and not self._send_task.done():
            try:
                await asyncio.wait_for(self._send_queue.put(None), 1)
                await asyncio.wait_for(asyncio.shield(self._send_task), 3)
                await asyncio.wait_for(self._response_done.wait(), 4)
                confirmed = self._finished.is_set()
            except Exception:
                pass
        if not confirmed and self._provider_error_code is None and (self._audio_received or any(not segment["is_final"] for segment in self._segments.values())):
            self._emit_error("E_ASR_FINAL_TIMEOUT", "转写收尾未确认，最后一段保留为草稿")
        self._running = False
        for task in (self._send_task, self._recv_task):
            if task and not task.done():
                task.cancel()
        await asyncio.gather(*(t for t in (self._send_task, self._recv_task) if t), return_exceptions=True)
        if self._ws:
            await self._ws.close()
            self._ws = None
        return "\n".join(self._all_text.values())
