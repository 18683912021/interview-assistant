package com.poc.audiocapture.audiocapture

import java.util.UUID
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class AudioWireProtocolTest {
  @Test
  fun roundTripsBinaryPacket() {
    val sessionId = UUID.fromString("123e4567-e89b-12d3-a456-426614174000")
    val payload = ByteArray(1_280) { (it % 127).toByte() }

    val encoded = AudioWireProtocol.encode(
        kind = AudioWireProtocol.PacketKind.REALTIME,
        source = TrackSource.SYSTEM,
        flags = 0,
        sessionId = sessionId,
        sequence = 42,
        captureOffsetUs = 1_680_000,
        payload = payload,
    )
    val decoded = AudioWireProtocol.decode(encoded)

    assertEquals(AudioWireProtocol.HEADER_SIZE + payload.size, encoded.size)
    assertEquals(sessionId, decoded.header.sessionId)
    assertEquals(TrackSource.SYSTEM, decoded.header.source)
    assertEquals(42, decoded.header.sequence)
    assertEquals(1_680_000, decoded.header.captureOffsetUs)
    assertArrayEquals(payload, decoded.payload)
  }
}
