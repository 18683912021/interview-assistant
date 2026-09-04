from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)

PROTOCOL_NAME = "audio.capture.v1"

AudioSourceName = Literal["mic", "system"]
AudioSourceMode = Literal["mic", "system", "both"]
PacketKindName = Literal["realtime", "backfill"]


class AudioStreamConfig(BaseModel):
    """客户端握手时上报的音频流配置。"""

    sample_rate: int = Field(default=16000, ge=8000, le=48000)
    bit_depth: int = Field(default=16, ge=8, le=32)
    channels: int = Field(default=1, ge=1, le=8)


class ControlMessage(BaseModel):
    """v1 控制消息公共配置，兼容 snake_case 与 camelCase 字段。"""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class ClientHello(ControlMessage):
    type: Literal["client_hello"]
    protocol: Literal[PROTOCOL_NAME] = PROTOCOL_NAME
    session_id: UUID | None = Field(
        default=None,
        validation_alias=AliasChoices("session_id", "sessionId"),
    )


class SessionStart(ControlMessage):
    type: Literal["session_start"]
    session_id: UUID = Field(
        validation_alias=AliasChoices("session_id", "sessionId")
    )
    source_mode: AudioSourceMode = Field(
        validation_alias=AliasChoices("source_mode", "sourceMode")
    )
    started_at: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("started_at", "startedAt", "startedAtUtc"),
    )
    protocol: Literal[PROTOCOL_NAME] = PROTOCOL_NAME


class AudioFormat(ControlMessage):
    sample_rate: int = Field(
        default=16000,
        ge=8000,
        le=48000,
        validation_alias=AliasChoices("sample_rate", "sampleRate"),
    )
    channels: int = Field(default=1, ge=1, le=8)
    encoding: str = "pcm_s16le"
    bits_per_sample: int = Field(
        default=16,
        validation_alias=AliasChoices("bits_per_sample", "bitsPerSample", "bit_depth"),
    )
    chunk_duration_ms: int = Field(
        default=40,
        ge=5,
        le=500,
        validation_alias=AliasChoices("chunk_duration_ms", "chunkDurationMs"),
    )
    byte_order: str = Field(
        default="little_endian",
        validation_alias=AliasChoices("byte_order", "byteOrder"),
    )

    @field_validator("encoding")
    @classmethod
    def normalize_encoding(cls, value: str) -> str:
        normalized = value.strip().lower()
        aliases = {"pcm_s16le", "pcm16le", "pcm_16bit", "s16le"}
        if normalized not in aliases:
            raise ValueError("仅支持 PCM signed 16-bit little-endian")
        return "pcm_s16le"

    @field_validator("byte_order")
    @classmethod
    def normalize_byte_order(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"little_endian", "little", "le"}:
            raise ValueError("仅支持 little-endian PCM")
        return "little_endian"


class TrackStart(ControlMessage):
    type: Literal["track_start"]
    session_id: UUID = Field(
        validation_alias=AliasChoices("session_id", "sessionId")
    )
    source: AudioSourceName
    audio_format: AudioFormat = Field(
        validation_alias=AliasChoices("format", "audio_format", "actualFormat")
    )
    chunk_duration_ms: int = Field(
        default=40,
        validation_alias=AliasChoices("chunk_duration_ms", "chunkDurationMs"),
    )


class TrackEnd(ControlMessage):
    type: Literal["track_end"]
    session_id: UUID = Field(
        validation_alias=AliasChoices("session_id", "sessionId")
    )
    source: AudioSourceName
    ended_at: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("ended_at", "endedAt", "endedAtUtc"),
    )


class SessionStopped(ControlMessage):
    type: Literal["session_stopped"]
    session_id: UUID = Field(
        validation_alias=AliasChoices("session_id", "sessionId")
    )
    ended_at: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("ended_at", "endedAt", "endedAtUtc"),
    )
    stop_reason: str = Field(
        default="client_stop",
        validation_alias=AliasChoices("stop_reason", "stopReason", "reason"),
    )


class FileStart(ControlMessage):
    type: Literal["file_start"]
    session_id: UUID = Field(
        validation_alias=AliasChoices("session_id", "sessionId")
    )
    source: AudioSourceName
    total_bytes: int = Field(
        ge=0,
        validation_alias=AliasChoices("total_bytes", "totalBytes", "length", "bytes"),
    )
    sha256: str = Field(min_length=64, max_length=64)

    @field_validator("sha256")
    @classmethod
    def validate_sha256(cls, value: str) -> str:
        normalized = value.strip().lower()
        if any(char not in "0123456789abcdef" for char in normalized):
            raise ValueError("sha256 必须是 64 位十六进制字符串")
        return normalized


class FileEnd(ControlMessage):
    type: Literal["file_end"]
    session_id: UUID = Field(
        validation_alias=AliasChoices("session_id", "sessionId")
    )
    source: AudioSourceName
    total_bytes: int | None = Field(
        default=None,
        ge=0,
        validation_alias=AliasChoices("total_bytes", "totalBytes", "length", "bytes"),
    )
    sha256: str | None = Field(default=None, min_length=64, max_length=64)

    @field_validator("sha256")
    @classmethod
    def validate_optional_sha256(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if any(char not in "0123456789abcdef" for char in normalized):
            raise ValueError("sha256 必须是 64 位十六进制字符串")
        return normalized


class SessionComplete(ControlMessage):
    type: Literal["session_complete"]
    session_id: UUID = Field(
        validation_alias=AliasChoices("session_id", "sessionId")
    )


class ChunkAck(BaseModel):
    """服务端对单个 source/kind 序列空间的累计确认。"""

    type: Literal["chunk_ack"] = "chunk_ack"
    session_id: str
    source: AudioSourceName
    kind: PacketKindName
    through_sequence: int
    next_sequence: int
    chunks_received: int
    bytes_received: int
    missing_chunks: int = 0
    gaps: list[tuple[int, int]] = Field(default_factory=list)


class StreamStats(BaseModel):
    """单次采集会话的统计信息。"""

    session_id: str
    config: AudioStreamConfig
    frames_received: int = 0
    bytes_received: int = 0
    duration_ms: float = 0.0
    started_at: str = ""
    ended_at: str = ""
