"""Tencent general-engine streaming ASR; credentials never leave the backend.

Contract: https://cloud.tencent.com/document/product/1093/48982
The /asr/v2 URL is also used by the ordinary API. engine_model_type=16k_zh
selects the general billing tier, NOT the V2 large model.
"""
import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import ssl
import time
import uuid
from urllib.parse import urlencode

import certifi
import websockets

from app.services.ai_config import read_proxy_config
from app.services.stt_streaming import ASRProtocolError, ASRResponse, StreamingASRSession

logger = logging.getLogger("stt_streaming")


def signed_url(app_id: str, secret_id: str, secret_key: str, voice_id: str,
               *, timestamp: int | None = None, nonce: int | None = None) -> str:
    if not app_id.isascii() or not app_id.isdigit() or not secret_id or not secret_key:
        raise ValueError("Tencent ASR credentials are incomplete")
    now = int(time.time()) if timestamp is None else timestamp
    params = {
        "convert_num_mode": 1, "engine_model_type": "16k_zh",
        "expired": now + 3600, "filter_empty_result": 0, "filter_punc": 0,
        "needvad": 1, "nonce": secrets.randbelow(1_000_000_000) if nonce is None else nonce,
        "secretid": secret_id, "timestamp": now, "vad_silence_time": 1000,
        "voice_format": 1, "voice_id": voice_id,
    }
    # Sign sorted, unescaped parameters; URL-encode only for transport.
    ordered = sorted(params.items())
    path = f"asr.cloud.tencent.com/asr/v2/{app_id}"
    canonical = path + "?" + "&".join(f"{key}={value}" for key, value in ordered)
    signature = base64.b64encode(hmac.new(secret_key.encode(), canonical.encode(), hashlib.sha1).digest()).decode()
    return "wss://" + path + "?" + urlencode(ordered + [("signature", signature)])


class TencentASRSession(StreamingASRSession):
    """Reuse bounded queues, retry/finish lifecycle; adapt only provider protocol."""

    def __init__(self, source: str, tx_queue: asyncio.Queue):
        super().__init__("", source, tx_queue)
        self._app_id = os.getenv("TENCENT_ASR_APP_ID", "").strip()
        self._secret_id = os.getenv("TENCENT_ASR_SECRET_ID", "").strip()
        self._secret_key = os.getenv("TENCENT_ASR_SECRET_KEY", "").strip()
        self._next_send_at = 0.0

    async def _connect(self) -> None:
        self._finished.clear()
        self._response_done.clear()
        self._provider_error_code = None
        self._stream_id = str(uuid.uuid4())
        self._segments = {}
        self._next_send_at = 0.0
        proxy, trust_env = read_proxy_config("ASR")
        # Never log the signed URL, raw provider response, or exception message.
        self._ws = await websockets.connect(
            signed_url(self._app_id, self._secret_id, self._secret_key, self._stream_id),
            ping_interval=20, ping_timeout=10, open_timeout=8, close_timeout=3,
            proxy=proxy if proxy is not None else True if trust_env else None,
            ssl=ssl.create_default_context(cafile=os.getenv("SSL_CERT_FILE") or certifi.where()),
            max_size=4 * 1024 * 1024,
        )
        try:
            ack = self._parse_response(await asyncio.wait_for(self._ws.recv(), 8))
            if ack.error_code is not None:
                self._reject_response(ack)
                while not self._send_queue.empty():
                    self._send_queue.get_nowait()
                self._response_done.set()
                await self._ws.close()
                return
            if ack.is_last or ack.payload.get("result"):
                raise ASRProtocolError("Expected Tencent handshake acknowledgement")
            if self._closing and (self._finish_task is None or self._finish_task.done()):
                await self._ws.close()
                return
        except BaseException:
            await self._ws.close()
            raise
        self._running = True
        self._recv_task = asyncio.create_task(self._recv_loop())
        self._send_task = asyncio.create_task(self._send_loop())

    def _parse_response(self, raw: bytes | str) -> ASRResponse:
        if not isinstance(raw, str):
            raise ASRProtocolError("Expected Tencent text response")
        try:
            body = json.loads(raw)
        except ValueError as exc:
            raise ASRProtocolError("Invalid Tencent JSON") from exc
        if not isinstance(body, dict) or type(body.get("code")) is not int:
            raise ASRProtocolError("Invalid Tencent response code")
        if body.get("voice_id") not in (None, self._stream_id):
            raise ASRProtocolError("Tencent stream identity mismatch")
        return ASRResponse(body, is_last=body.get("final") == 1,
                           error_code=body["code"] if body["code"] else None)

    def _reject_response(self, response: ASRResponse) -> None:
        self._provider_error_code = response.error_code
        messages = {
            4001: ("E_ASR_CONFIG", "腾讯语音识别参数有误，请联系管理员检查配置"),
            4002: ("E_ASR_AUTH", "腾讯语音识别鉴权失败，请检查密钥和服务器时间"),
            4003: ("E_ASR_CONFIG", "尚未开通腾讯语音识别服务，请在腾讯云控制台开通"),
            4004: ("E_ASR_QUOTA", "腾讯语音识别可用时长已耗尽，请检查通用版额度"),
            4005: ("E_ASR_QUOTA", "腾讯云账号欠费，语音识别已暂停"),
            4006: ("E_ASR_CONCURRENCY", "腾讯语音识别并发额度已满，请稍后继续"),
            4007: ("E_ASR_PROVIDER", "腾讯语音识别音频格式有误，请检查采集配置"),
            4008: ("E_ASR_PROVIDER", "语音识别等待音频超时，请检查音源后继续"),
            6001: ("E_ASR_CONFIG", "腾讯语音识别区域不匹配，请检查服务器代理配置"),
        }
        code, message = messages.get(response.error_code, ("E_ASR_PROVIDER", "腾讯语音识别暂不可用，请稍后继续"))
        logger.warning("Tencent ASR rejected: source=%s code=%s request_id=%s",
                       self._source, response.error_code, self._stream_id)
        self._emit_error(code, f"{message}（{response.error_code}）", recoverable=False,
                         provider_code=response.error_code)
        self._running = False

    async def _send_audio(self, pcm: bytes, final: bool = False) -> None:
        if self._ws is None:
            return
        # Handshake/reconnect may accumulate audio. Drain at real-time rate,
        # never burst the queue (Tencent rejects sending faster than real time).
        loop = asyncio.get_running_loop()
        if pcm or final:
            await asyncio.sleep(max(0, self._next_send_at - loop.time()))
        if pcm:
            await self._ws.send(pcm)
            self._next_send_at = loop.time() + len(pcm) / 32000
        if final:
            await asyncio.sleep(max(0, self._next_send_at - loop.time()))
            await self._ws.send(json.dumps({"type": "end"}))

    async def _consume(self, response: ASRResponse) -> None:
        result = response.payload.get("result")
        if result is None:
            return  # final=1 closes the stream, never invents sentence finals.
        if not isinstance(result, dict):
            raise ASRProtocolError("Invalid Tencent result")
        index, kind = result.get("index"), result.get("slice_type")
        if type(index) is not int or index < 0 or kind not in (0, 1, 2):
            raise ASRProtocolError("Invalid Tencent sentence identity")
        text = result.get("voice_text_str", "")
        if not isinstance(text, str):
            raise ASRProtocolError("Invalid Tencent transcript")
        key = str(index)
        existing = self._segments.get(key)
        final = kind == 2
        if existing and existing["is_final"]:
            return  # duplicate or late draft must not revert a confirmed bubble.
        if not text:
            # Empty/no-speech callbacks do not confirm the text of an old draft.
            return
        start, end = result.get("start_time", 0), result.get("end_time", 0)
        if type(start) is not int or type(end) is not int or start < 0 or end < 0:
            raise ASRProtocolError("Invalid Tencent timestamps")
        if existing and (existing["text"], existing["is_final"], existing["end_time"]) == (text, final, end):
            return
        event = {"type": "transcription", "text": text, "source": self._source,
                 "utterance_id": f"{self._stream_id}:{self._source}:{index}",
                 "revision": existing["revision"] + 1 if existing else 1,
                 "start_time": start, "end_time": end, "is_final": final,
                 "provider_final": final, "stream_id": self._stream_id, "timing_pending": False}
        self._segments[key] = event
        self._all_text[event["utterance_id"]] = text
        await self._tx_queue.put(event)
