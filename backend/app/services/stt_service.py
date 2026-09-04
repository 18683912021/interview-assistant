"""火山引擎流式语音识别服务。

使用 bigmodel_async WebSocket 协议。
鉴权：X-Api-App-Key + X-Api-Access-Key（通过 HMAC-SHA256 签名生成 Token）。
"""

import asyncio
import gzip
import hashlib
import hmac
import json
import logging
import struct
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import websockets
from websockets.asyncio.client import ClientConnection

logger = logging.getLogger("stt")

# ── 协议常量 ──────────────────────────────────────────
WS_ENDPOINT = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"
RESOURCE_ID = "volc.bigasr.sauc.duration"  # 小时版

PROTOCOL_VERSION = 1
HEADER_SIZE = 4
# 消息类型
FULL_CLIENT_REQUEST = 0b0001
AUDIO_ONLY_REQUEST = 0b0010
# 标志
POS_SEQUENCE = 0b0000
NEG_WITH_SEQUENCE = 0b0010  # 最后一帧

# 音频参数
SAMPLE_RATE = 16000
BITS_PER_SAMPLE = 16
CHANNELS = 1
CHUNK_MS = 200  # 每包 200ms

# ── 鉴权 ──────────────────────────────────────────────

def _hmac_sha256(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).digest()


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def generate_token(access_key_id: str, secret_access_key: str) -> str:
    """使用 AK/SK 生成火山引擎鉴权 Token。"""
    # 解码 Secret Access Key（可能是 Base64）
    import base64

    try:
        sk_bytes = base64.b64decode(secret_access_key)
    except Exception:
        sk_bytes = secret_access_key.encode("utf-8")

    now = datetime.now(timezone.utc)
    date_stamp = now.strftime("%Y%m%dT%H%M%SZ")
    # 使用 v4 签名
    region = "cn-beijing"
    service = "speech"

    # 1. Canonical Request
    http_method = "GET"
    canonical_uri = "/api/v3/sauc/bigmodel_async"
    canonical_querystring = ""
    canonical_headers = f"host:openspeech.bytedance.com\nx-content-sha256:UNSIGNED-PAYLOAD\n"
    signed_headers = "host;x-content-sha256"
    payload_hash = "UNSIGNED-PAYLOAD"

    canonical_request = (
        f"{http_method}\n"
        f"{canonical_uri}\n"
        f"{canonical_querystring}\n"
        f"{canonical_headers}\n"
        f"{signed_headers}\n"
        f"{payload_hash}"
    )

    # 2. String to Sign
    credential_scope = f"{date_stamp[:8]}/{region}/{service}/request"
    string_to_sign = (
        f"HMAC-SHA256\n{date_stamp}\n{credential_scope}\n"
        f"{_sha256_hex(canonical_request.encode('utf-8'))}"
    )

    # 3. Signature
    k_date = _hmac_sha256(sk_bytes, date_stamp[:8])
    k_region = _hmac_sha256(k_date, region)
    k_service = _hmac_sha256(k_region, service)
    k_signing = _hmac_sha256(k_service, "request")
    signature = _hmac_sha256(k_signing, string_to_sign).hex()

    token = (
        f"HMAC-SHA256 "
        f"Credential={access_key_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, "
        f"Signature={signature}"
    )
    return token


# ── 二进制帧编码 ──────────────────────────────────────

def encode_client_request(config: dict) -> bytes:
    """编码 FULL_CLIENT_REQUEST 帧。"""
    payload = gzip.compress(json.dumps(config).encode("utf-8"))
    return _encode_frame(FULL_CLIENT_REQUEST, POS_SEQUENCE, payload)


def encode_audio_frame(pcm_data: bytes, is_last: bool = False) -> bytes:
    """编码 AUDIO_ONLY_REQUEST 帧。"""
    flags = NEG_WITH_SEQUENCE if is_last else POS_SEQUENCE
    payload = gzip.compress(pcm_data)
    return _encode_frame(AUDIO_ONLY_REQUEST, flags, payload)


def _encode_frame(msg_type: int, flags: int, payload: bytes) -> bytes:
    header = bytearray(HEADER_SIZE)
    header[0] = (PROTOCOL_VERSION << 4) | (HEADER_SIZE // 4)
    header[1] = (msg_type << 4) | flags
    header[2] = 0x00  # 序列化: JSON, 压缩: none（因为我们在 payload 层面 gzip）
    header[3] = 0x00
    size_bytes = struct.pack(">I", len(payload))
    return bytes(header) + size_bytes + payload


# ── 解码 ──────────────────────────────────────────────

def decode_server_response(frame: bytes) -> dict | None:
    """解码服务端响应帧。返回解析后的 JSON 字典。"""
    if len(frame) < HEADER_SIZE + 4:
        return None
    size = struct.unpack(">I", frame[HEADER_SIZE:HEADER_SIZE + 4])[0]
    compressed = frame[HEADER_SIZE + 4:HEADER_SIZE + 4 + size]
    try:
        payload = gzip.decompress(compressed)
        return json.loads(payload.decode("utf-8"))
    except Exception:
        return None


# ── 主流程 ────────────────────────────────────────────

@dataclass
class TranscribeResult:
    text: str
    duration_ms: float


async def transcribe_pcm(
    pcm_path: str,
    app_id: str,
    access_key_id: str,
    secret_access_key: str,
) -> TranscribeResult:
    """将 16kHz 16bit mono PCM 文件送火山引擎 ASR，返回识别文本。

    流程：
    1. 建立 WebSocket + 发送初始化配置
    2. 整个 PCM 文件分片发送（200ms/包），最后一帧带结束标志
    3. 接收所有识别结果，拼接为完整文本
    """
    connect_id = str(uuid.uuid4())
    started_at = time.monotonic()

    async with websockets.connect(
        WS_ENDPOINT,
        additional_headers={
            "X-Api-App-Key": app_id,
            "X-Api-Access-Key": access_key_id,
            "X-Api-Resource-Id": RESOURCE_ID,
            "X-Api-Connect-Id": connect_id,
        },
    ) as ws:
        # ── 发送初始化配置 ──
        await ws.send(encode_client_request({
            "audio_format": "pcm",
            "sample_rate": SAMPLE_RATE,
            "bits": BITS_PER_SAMPLE,
            "channel": CHANNELS,
            "language": "zh-CN",
            "model_name": "bigmodel",
            "enable_punctuation": True,
            "enable_itn": True,
        }))

        # ── 流式发送 PCM ──
        chunk_bytes = SAMPLE_RATE * (BITS_PER_SAMPLE // 8) * CHANNELS * CHUNK_MS // 1000
        file_size = Path(pcm_path).stat().st_size
        sent = 0
        with open(pcm_path, "rb") as f:
            while True:
                chunk = f.read(chunk_bytes)
                if not chunk:
                    break
                sent += len(chunk)
                is_last = sent >= file_size
                await ws.send(encode_audio_frame(chunk, is_last=is_last))

        # 文件为空则发一个空结束帧
        if sent == 0:
            await ws.send(encode_audio_frame(b"", is_last=True))

        # ── 接收识别结果 ──
        all_text: list[str] = []
        try:
            while True:
                raw = await asyncio.wait_for(ws.recv(), timeout=3.0)
                result = decode_server_response(raw)
                if result:
                    text = _extract_text(result)
                    if text:
                        all_text.append(text)
        except TimeoutError:
            pass  # 超时 = 服务端没有更多结果了
        except websockets.exceptions.ConnectionClosed:
            pass

    full_text = "".join(all_text)
    duration_ms = (time.monotonic() - started_at) * 1000
    logger.info("ASR 完成 | 文本=%s | 耗时=%.0fms", full_text[:80], duration_ms)
    return TranscribeResult(text=full_text, duration_ms=duration_ms)


def _extract_text(result: dict) -> str:
    """从服务端 JSON 响应中提取识别文本。"""
    try:
        # bigmodel 返回格式: {"payload_msg": {"result": [{"words": [{"text": "..."}]}]}}
        utterances = result.get("payload_msg", {}).get("result", [])
        parts = []
        for utterance in utterances:
            for word in utterance.get("words", []):
                t = word.get("text", "")
                if t:
                    parts.append(t)
        return "".join(parts)
    except Exception:
        return ""
