package com.poc.audiocapture.audiocapture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PcmNormalizerTest {
  @Test
  fun passesThrough16kMono() {
    val input = pcm16((0 until 160).map { it * 10 - 800 })
    val output = PcmNormalizer(AudioFormatSpec(16_000, 1)).process(input, input.size)
    assertEquals(input.toList(), output.toList())
  }

  @Test
  fun downmixesAndResamples48kStereo() {
    val samples = buildList {
      repeat(480) { index ->
        add(index.toShort())
        add((-index).toShort())
      }
    }
    val input = pcm16(samples.map { it.toInt() })
    val output = PcmNormalizer(AudioFormatSpec(48_000, 2)).process(input, input.size)
    assertEquals(160 * 2, output.size)
    assertTrue(PcmNormalizer.calculateRms(output) < 0.001f)
  }

  private fun pcm16(samples: List<Int>): ByteArray {
    val bytes = ByteArray(samples.size * 2)
    samples.forEachIndexed { index, value ->
      bytes[index * 2] = (value and 0xff).toByte()
      bytes[index * 2 + 1] = ((value ushr 8) and 0xff).toByte()
    }
    return bytes
  }
}
