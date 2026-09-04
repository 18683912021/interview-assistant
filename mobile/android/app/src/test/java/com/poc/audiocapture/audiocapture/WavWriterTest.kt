package com.poc.audiocapture.audiocapture

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.io.path.createTempDirectory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WavWriterTest {
  @Test
  fun writesValidMonoPcm16Header() {
    val directory = createTempDirectory(prefix = "wav-test-").toFile()
    try {
      val pcm = File(directory, "input.pcm")
      val wav = File(directory, "output.wav")
      val data = ByteArray(3_200) { (it % 251).toByte() }
      pcm.writeBytes(data)

      WavWriter.write(pcm, wav, PcmNormalizer.OUTPUT_FORMAT)
      val bytes = wav.readBytes()

      assertEquals("RIFF", bytes.copyOfRange(0, 4).toString(Charsets.US_ASCII))
      assertEquals("WAVE", bytes.copyOfRange(8, 12).toString(Charsets.US_ASCII))
      assertEquals("data", bytes.copyOfRange(36, 40).toString(Charsets.US_ASCII))
      val header = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
      assertEquals(16_000, header.getInt(24))
      assertEquals(1, header.getShort(22).toInt())
      assertEquals(16, header.getShort(34).toInt())
      assertEquals(data.size, header.getInt(40))
      assertEquals(data.size + 44, bytes.size)
      assertTrue(bytes.copyOfRange(44, bytes.size).contentEquals(data))
    } finally {
      directory.deleteRecursively()
    }
  }
}
