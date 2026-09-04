import hashlib
import json
import os
import struct
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO, Literal
from uuid import UUID

from app.models.schemas import AudioFormat, AudioStreamConfig, ChunkAck, StreamStats

PACKET_MAGIC = b"ACP1"
PACKET_VERSION = 1
PACKET_HEADER = struct.Struct(">4sBBBB16sqqI")
MAX_PACKET_BYTES = 1024 * 1024

KIND_BY_ID: dict[int, Literal["realtime", "backfill"]] = {
    1: "realtime",
    2: "backfill",
}
SOURCE_BY_ID: dict[int, Literal["mic", "system"]] = {
    1: "mic",
    2: "system",
}


class ProtocolError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class AudioPacketHeader:
    kind: Literal["realtime", "backfill"]
    source: Literal["mic", "system"]
    flags: int
    session_id: UUID
    sequence: int
    capture_offset_us: int
    payload_length: int

    @classmethod
    def decode(cls, packet: bytes) -> tuple["AudioPacketHeader", bytes]:
        if len(packet) < PACKET_HEADER.size:
            raise ProtocolError("E_PACKET_HEADER", "binary packet is smaller than 44 bytes")

        (
            magic,
            version,
            kind_id,
            source_id,
            flags,
            session_bytes,
            sequence,
            capture_offset_us,
            payload_length,
        ) = PACKET_HEADER.unpack_from(packet)

        if magic != PACKET_MAGIC:
            raise ProtocolError("E_PACKET_MAGIC", "invalid packet magic")
        if version != PACKET_VERSION:
            raise ProtocolError("E_PACKET_VERSION", f"unsupported packet version: {version}")
        if kind_id not in KIND_BY_ID:
            raise ProtocolError("E_PACKET_KIND", f"unknown packet kind: {kind_id}")
        if source_id not in SOURCE_BY_ID:
            raise ProtocolError("E_PACKET_SOURCE", f"unknown packet source: {source_id}")
        if sequence < 0:
            raise ProtocolError("E_PACKET_SEQUENCE", "sequence must be non-negative")
        if capture_offset_us < 0:
            raise ProtocolError("E_PACKET_OFFSET", "capture offset must be non-negative")
        if payload_length < 0 or payload_length > MAX_PACKET_BYTES:
            raise ProtocolError("E_PACKET_LENGTH", "payload length is outside the allowed range")
        if len(packet) != PACKET_HEADER.size + payload_length:
            raise ProtocolError("E_PACKET_LENGTH", "payload length does not match packet size")

        return (
            cls(
                kind=KIND_BY_ID[kind_id],
                source=SOURCE_BY_ID[source_id],
                flags=flags,
                session_id=UUID(bytes=session_bytes),
                sequence=sequence,
                capture_offset_us=capture_offset_us,
                payload_length=payload_length,
            ),
            packet[PACKET_HEADER.size :],
        )


@dataclass
class SequenceTracker:
    next_sequence: int = 0
    through_sequence: int = -1
    chunks_received: int = 0
    bytes_received: int = 0
    gaps: list[tuple[int, int]] = field(default_factory=list)

    def accept(self, sequence: int, payload_length: int) -> None:
        if sequence < self.next_sequence:
            raise ProtocolError(
                "E_PACKET_SEQUENCE",
                f"sequence {sequence} is behind expected {self.next_sequence}",
            )
        if sequence > self.next_sequence:
            self.gaps.append((self.next_sequence, sequence - 1))

        self.through_sequence = sequence
        self.next_sequence = sequence + 1
        self.chunks_received += 1
        self.bytes_received += payload_length

    def to_ack(
        self,
        session_id: UUID,
        source: Literal["mic", "system"],
        kind: Literal["realtime", "backfill"],
    ) -> ChunkAck:
        return ChunkAck(
            session_id=str(session_id),
            source=source,
            kind=kind,
            through_sequence=self.through_sequence,
            next_sequence=self.next_sequence,
            chunks_received=self.chunks_received,
            bytes_received=self.bytes_received,
            missing_chunks=sum(end - start + 1 for start, end in self.gaps),
            gaps=self.gaps[-20:],
        )


@dataclass
class TrackReceiver:
    session_id: UUID
    source: Literal["mic", "system"]
    directory: Path
    audio_format: AudioFormat
    realtime_tracker: SequenceTracker = field(default_factory=SequenceTracker)
    backfill_tracker: SequenceTracker = field(default_factory=SequenceTracker)
    realtime_file: BinaryIO | None = None
    backfill_file: BinaryIO | None = None
    expected_backfill_bytes: int | None = None
    expected_backfill_sha256: str | None = None
    complete: bool = False
    _last_flush: float = field(default=0.0, repr=False)

    @property
    def realtime_path(self) -> Path:
        return self.directory / f"{self.source}.realtime.pcm.part"

    @property
    def backfill_path(self) -> Path:
        return self.directory / f"{self.source}.backfill.pcm.part"

    @property
    def canonical_path(self) -> Path:
        return self.directory / f"{self.source}.pcm"

    def write_packet(self, header: AudioPacketHeader, payload: bytes) -> ChunkAck:
        if header.source != self.source or header.session_id != self.session_id:
            raise ProtocolError("E_PACKET_ROUTE", "packet does not belong to this track")

        if header.kind == "realtime":
            if self.realtime_file is None:
                self.realtime_file = self.realtime_path.open("ab")
            self.realtime_tracker.accept(header.sequence, len(payload))
            self.realtime_file.write(payload)
            # 40ms 一帧的同步 flush 会间歇打断 asyncio 事件循环（磁盘忙时反压给推流端）；
            # 节流到 1s 一次，崩溃时可接受丢失 ≤1s 缓冲（canonical 修复依赖 backfill）
            now = time.monotonic()
            if now - self._last_flush >= 1.0:
                self.realtime_file.flush()
                self._last_flush = now
            return self.realtime_tracker.to_ack(self.session_id, self.source, "realtime")

        if self.backfill_file is None:
            raise ProtocolError("E_BACKFILL_STATE", "file_start must be sent before backfill packets")
        self.backfill_tracker.accept(header.sequence, len(payload))
        self.backfill_file.write(payload)
        return self.backfill_tracker.to_ack(self.session_id, self.source, "backfill")

    def start_backfill(self, total_bytes: int, sha256: str) -> None:
        self.close_backfill()
        self.backfill_path.unlink(missing_ok=True)
        self.canonical_path.unlink(missing_ok=True)
        self.backfill_tracker = SequenceTracker()
        self.expected_backfill_bytes = total_bytes
        self.expected_backfill_sha256 = sha256
        self.backfill_file = self.backfill_path.open("wb")
        self.complete = False

    def finish_backfill(self, total_bytes: int | None, sha256: str | None) -> None:
        self.close_backfill()
        expected_bytes = total_bytes if total_bytes is not None else self.expected_backfill_bytes
        expected_sha = sha256 if sha256 is not None else self.expected_backfill_sha256
        if expected_bytes is None or expected_sha is None:
            raise ProtocolError("E_BACKFILL_METADATA", "backfill length and sha256 are required")

        actual_bytes = self.backfill_path.stat().st_size if self.backfill_path.exists() else -1
        actual_sha = sha256_file(self.backfill_path) if self.backfill_path.exists() else ""
        if actual_bytes != expected_bytes:
            raise ProtocolError(
                "E_BACKFILL_LENGTH",
                f"backfill length {actual_bytes} does not match expected {expected_bytes}",
            )
        if actual_sha != expected_sha:
            raise ProtocolError("E_BACKFILL_SHA256", "backfill sha256 does not match")

        self.backfill_path.replace(self.canonical_path)
        self.complete = True

    def close_realtime(self) -> None:
        if self.realtime_file is not None:
            self.realtime_file.close()
            self.realtime_file = None

    def close_backfill(self) -> None:
        if self.backfill_file is not None:
            self.backfill_file.flush()
            self.backfill_file.close()
            self.backfill_file = None

    def close(self) -> None:
        self.close_realtime()
        self.close_backfill()

    def to_dict(self) -> dict[str, object]:
        canonical_bytes = self.canonical_path.stat().st_size if self.canonical_path.exists() else 0
        return {
            "source": self.source,
            "format": self.audio_format.model_dump(),
            "realtime_frames": self.realtime_tracker.chunks_received,
            "realtime_bytes": self.realtime_tracker.bytes_received,
            "realtime_gaps": self.realtime_tracker.gaps,
            "backfill_frames": self.backfill_tracker.chunks_received,
            "backfill_bytes": self.backfill_tracker.bytes_received,
            "canonical_bytes": canonical_bytes,
            "canonical_sha256": sha256_file(self.canonical_path) if canonical_bytes else "",
            "complete": self.complete,
        }


@dataclass
class V1AudioSession:
    session_id: UUID
    source_mode: Literal["mic", "system", "both"]
    storage_root: Path
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    ended_at: datetime | None = None
    stop_reason: str = ""
    status: str = "capturing"
    tracks: dict[Literal["mic", "system"], TrackReceiver] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        self.persist_metadata()

    @property
    def directory(self) -> Path:
        return safe_session_directory(self.storage_root, self.session_id)

    def start_track(
        self,
        source: Literal["mic", "system"],
        audio_format: AudioFormat,
    ) -> TrackReceiver:
        if source in self.tracks:
            raise ProtocolError("E_TRACK_STATE", f"track {source} has already started")
        expected_sources = {
            "mic": {"mic"},
            "system": {"system"},
            "both": {"mic", "system"},
        }[self.source_mode]
        if source not in expected_sources:
            raise ProtocolError("E_TRACK_SOURCE", f"track {source} is not allowed for {self.source_mode}")
        track = TrackReceiver(self.session_id, source, self.directory, audio_format)
        self.tracks[source] = track
        self.persist_metadata()
        return track

    def require_track(self, source: Literal["mic", "system"]) -> TrackReceiver:
        track = self.tracks.get(source)
        if track is None:
            raise ProtocolError("E_TRACK_STATE", f"track {source} has not started")
        return track

    def stop(self, reason: str) -> None:
        self.stop_reason = reason
        self.ended_at = datetime.now(timezone.utc)
        self.status = "stopped"
        for track in self.tracks.values():
            track.close_realtime()
        self.persist_metadata()

    def complete(self) -> None:
        expected_sources = {
            "mic": {"mic"},
            "system": {"system"},
            "both": {"mic", "system"},
        }[self.source_mode]
        if set(self.tracks) != expected_sources or not all(track.complete for track in self.tracks.values()):
            raise ProtocolError("E_SESSION_INCOMPLETE", "all expected tracks require verified backfill")
        self.ended_at = self.ended_at or datetime.now(timezone.utc)
        self.status = "complete"
        self.persist_metadata()

    def close_incomplete(self) -> None:
        for track in self.tracks.values():
            track.close()
        if self.status != "complete":
            self.status = "incomplete"
            self.ended_at = self.ended_at or datetime.now(timezone.utc)
        self.persist_metadata()

    def to_dict(self) -> dict[str, object]:
        return {
            "session_id": str(self.session_id),
            "source_mode": self.source_mode,
            "status": self.status,
            "stop_reason": self.stop_reason,
            "started_at": self.started_at.isoformat(),
            "ended_at": self.ended_at.isoformat() if self.ended_at else "",
            "tracks": [track.to_dict() for track in self.tracks.values()],
        }

    def persist_metadata(self) -> None:
        metadata_path = self.directory / "session.json"
        temporary_path = self.directory / "session.json.part"
        temporary_path.write_text(
            json.dumps(self.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary_path.replace(metadata_path)


@dataclass
class AudioSession:
    """Legacy WebSocket session retained for backward compatibility."""

    session_id: str
    config: AudioStreamConfig
    frames_received: int = 0
    bytes_received: int = 0
    _started_monotonic: float = field(default_factory=time.monotonic)
    _started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    errors: list[str] = field(default_factory=list)

    @property
    def duration_ms(self) -> float:
        return (time.monotonic() - self._started_monotonic) * 1000

    def record_frame(self, nbytes: int) -> None:
        self.frames_received += 1
        self.bytes_received += nbytes

    def to_stats(self) -> StreamStats:
        return StreamStats(
            session_id=self.session_id,
            config=self.config,
            frames_received=self.frames_received,
            bytes_received=self.bytes_received,
            duration_ms=round(self.duration_ms, 1),
            started_at=self._started_at.isoformat(),
            ended_at=datetime.now(timezone.utc).isoformat(),
        )


class PCMValidator:
    """Validates legacy raw PCM frames."""

    def __init__(self, expected: AudioStreamConfig):
        self.expected = expected
        self._bytes_per_sample = expected.bit_depth // 8

    def validate(self, raw: bytes) -> str | None:
        if not raw:
            return "空帧"
        bytes_per_audio_frame = self._bytes_per_sample * self.expected.channels
        if len(raw) % bytes_per_audio_frame != 0:
            return f"帧字节数 {len(raw)} 无法被 {bytes_per_audio_frame} 整除"
        total_samples = len(raw) // bytes_per_audio_frame
        duration_ms = total_samples / self.expected.sample_rate * 1000
        if duration_ms < 5 or duration_ms > 500:
            return f"帧时长 {duration_ms:.1f}ms 异常"
        return None


def storage_root() -> Path:
    configured = os.getenv("AUDIO_CAPTURE_STORAGE_DIR")
    root = Path(configured) if configured else Path(__file__).resolve().parents[2] / "data" / "audio-captures"
    root.mkdir(parents=True, exist_ok=True)
    return root.resolve()


def safe_session_directory(root: Path, session_id: UUID) -> Path:
    root = root.resolve()
    candidate = (root / str(session_id)).resolve()
    if candidate.parent != root:
        raise ProtocolError("E_STORAGE_PATH", "invalid session storage path")
    return candidate


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
