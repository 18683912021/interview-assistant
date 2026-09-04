package com.poc.audiocapture.audiocapture

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

object AudioWireProtocol {
  const val VERSION: Byte = 1
  const val HEADER_SIZE = 44
  const val FLAG_FINAL: Byte = 1
  private val MAGIC = byteArrayOf('A'.code.toByte(), 'C'.code.toByte(), 'P'.code.toByte(), '1'.code.toByte())

  enum class PacketKind(val wireId: Byte, val wireName: String) {
    REALTIME(1, "realtime"),
    BACKFILL(2, "backfill");

    companion object {
      fun fromWireId(value: Byte): PacketKind = entries.firstOrNull { it.wireId == value }
          ?: throw IllegalArgumentException("Unknown packet kind: $value")
    }
  }

  data class Header(
      val kind: PacketKind,
      val source: TrackSource,
      val flags: Byte,
      val sessionId: UUID,
      val sequence: Long,
      val captureOffsetUs: Long,
      val payloadLength: Int,
  )

  data class Packet(val header: Header, val payload: ByteArray)

  fun encode(
      kind: PacketKind,
      source: TrackSource,
      flags: Byte,
      sessionId: UUID,
      sequence: Long,
      captureOffsetUs: Long,
      payload: ByteArray,
  ): ByteArray {
    val buffer = ByteBuffer.allocate(HEADER_SIZE + payload.size).order(ByteOrder.BIG_ENDIAN)
    buffer.put(MAGIC)
    buffer.put(VERSION)
    buffer.put(kind.wireId)
    buffer.put(source.wireId)
    buffer.put(flags)
    buffer.putLong(sessionId.mostSignificantBits)
    buffer.putLong(sessionId.leastSignificantBits)
    buffer.putLong(sequence)
    buffer.putLong(captureOffsetUs)
    buffer.putInt(payload.size)
    buffer.put(payload)
    return buffer.array()
  }

  fun decode(packet: ByteArray): Packet {
    require(packet.size >= HEADER_SIZE) { "Packet is smaller than the protocol header" }
    val buffer = ByteBuffer.wrap(packet).order(ByteOrder.BIG_ENDIAN)
    val magic = ByteArray(4)
    buffer.get(magic)
    require(magic.contentEquals(MAGIC)) { "Invalid packet magic" }
    require(buffer.get() == VERSION) { "Unsupported protocol version" }
    val kind = PacketKind.fromWireId(buffer.get())
    val sourceId = buffer.get()
    val source = TrackSource.entries.firstOrNull { it.wireId == sourceId }
        ?: throw IllegalArgumentException("Unknown track source: $sourceId")
    val flags = buffer.get()
    val sessionId = UUID(buffer.long, buffer.long)
    val sequence = buffer.long
    val captureOffsetUs = buffer.long
    val payloadLength = buffer.int
    require(payloadLength >= 0) { "Negative payload length" }
    require(packet.size == HEADER_SIZE + payloadLength) { "Payload length does not match packet size" }
    val payload = ByteArray(payloadLength)
    buffer.get(payload)
    return Packet(
        header = Header(kind, source, flags, sessionId, sequence, captureOffsetUs, payloadLength),
        payload = payload,
    )
  }

  fun clientHello(): String = JSONObject()
      .put("type", "client_hello")
      .put("protocol", "audio.capture.v1")
      .put("client", "rn-android")
      .toString()

  fun sessionStart(sessionId: String, source: CaptureSource, tracks: Collection<TrackSource>): String =
      JSONObject()
          .put("type", "session_start")
          .put("session_id", sessionId)
          .put("source_mode", source.wireName)
          .put("tracks", JSONArray(tracks.map { it.wireName }))
          .toString()

  fun trackStart(sessionId: String, source: TrackSource): String = JSONObject()
      .put("type", "track_start")
      .put("session_id", sessionId)
      .put("source", source.wireName)
      .put("format", JSONObject()
          .put("sample_rate", PcmNormalizer.OUTPUT_FORMAT.sampleRate)
          .put("bit_depth", PcmNormalizer.OUTPUT_FORMAT.bitsPerSample)
          .put("channels", PcmNormalizer.OUTPUT_FORMAT.channelCount)
          .put("encoding", "pcm_s16le")
          .put("chunk_duration_ms", 40))
      .toString()

  fun trackEnd(sessionId: String, source: TrackSource, sequence: Long): String = JSONObject()
      .put("type", "track_end")
      .put("session_id", sessionId)
      .put("source", source.wireName)
      .put("last_sequence", sequence)
      .toString()

  fun sessionStopped(sessionId: String, reason: String): String = JSONObject()
      .put("type", "session_stopped")
      .put("session_id", sessionId)
      .put("reason", reason)
      .toString()

  fun fileStart(sessionId: String, result: TrackFileResult): String = JSONObject()
      .put("type", "file_start")
      .put("session_id", sessionId)
      .put("source", result.source.wireName)
      .put("bytes", result.pcmBytes)
      .put("sha256", result.pcmSha256)
      .toString()

  fun fileEnd(sessionId: String, result: TrackFileResult, sequence: Long): String = JSONObject()
      .put("type", "file_end")
      .put("session_id", sessionId)
      .put("source", result.source.wireName)
      .put("last_sequence", sequence)
      .put("bytes", result.pcmBytes)
      .put("sha256", result.pcmSha256)
      .toString()

  fun sessionComplete(sessionId: String): String = JSONObject()
      .put("type", "session_complete")
      .put("session_id", sessionId)
      .toString()
}
