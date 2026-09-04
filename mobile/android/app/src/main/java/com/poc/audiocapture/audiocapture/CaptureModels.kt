package com.poc.audiocapture.audiocapture

import java.io.File

enum class CaptureSource(val wireName: String) {
  MIC("mic"),
  SYSTEM("system"),
  BOTH("both");

  val needsMic: Boolean
    get() = this == MIC || this == BOTH

  val needsSystem: Boolean
    get() = this == SYSTEM || this == BOTH

  companion object {
    fun fromWireName(value: String): CaptureSource =
        entries.firstOrNull { it.wireName == value }
            ?: throw CaptureException(
                code = "E_CAPTURE_SOURCE",
                stage = "validate",
                message = "Unsupported capture source: $value",
            )
  }
}

enum class TrackSource(val wireName: String, val wireId: Byte) {
  MIC("mic", 1),
  SYSTEM("system", 2),
}

enum class CaptureState(val wireName: String) {
  IDLE("idle"),
  PREPARING("preparing"),
  CAPTURING("capturing"),
  STOPPING("stopping"),
  FINALIZING("finalizing"),
  COMPLETED("completed"),
  ERROR("error"),
}

enum class StreamState(val wireName: String) {
  IDLE("idle"),
  CONNECTING("connecting"),
  READY("ready"),
  DEGRADED("degraded"),
  BACKFILLING("backfilling"),
  CLOSED("closed"),
  ERROR("error"),
}

data class AudioFormatSpec(
    val sampleRate: Int,
    val channelCount: Int,
    val bitsPerSample: Int = 16,
) {
  val bytesPerSample: Int
    get() = bitsPerSample / 8

  val bytesPerSecond: Int
    get() = sampleRate * channelCount * bytesPerSample

  val frameBytes40Ms: Int
    get() = bytesPerSecond * 40 / 1_000
}

data class CaptureRequest(
    val operationId: String,
    val source: CaptureSource,
)

data class TrackFileResult(
    val source: TrackSource,
    val inputFormat: AudioFormatSpec,
    val outputFormat: AudioFormatSpec,
    val pcmFile: File,
    val wavFile: File,
    val pcmBytes: Long,
    val durationMs: Long,
    val pcmSha256: String,
    val wavSha256: String,
)

data class CaptureResult(
    val operationId: String,
    val sessionId: String,
    val source: CaptureSource,
    val startedAtUtc: String,
    val endedAtUtc: String,
    val stopReason: String,
    val tracks: List<TrackFileResult>,
)

data class StreamStats(
    val queuedBytes: Long = 0,
    val transportBytes: Long = 0,
    val acknowledgedBytes: Long = 0,
    val realtimeFrames: Long = 0,
    val droppedFrames: Long = 0,
    val backfillBytes: Long = 0,
)

class CaptureException(
    val code: String,
    val stage: String,
    val source: TrackSource? = null,
    val recoverable: Boolean = true,
    message: String,
    cause: Throwable? = null,
) : RuntimeException(message, cause)
