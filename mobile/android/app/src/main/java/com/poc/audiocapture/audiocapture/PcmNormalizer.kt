package com.poc.audiocapture.audiocapture

import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** Converts little-endian PCM16 input to 16 kHz mono PCM16 while preserving chunk continuity. */
class PcmNormalizer(
    private val inputFormat: AudioFormatSpec,
    private val outputSampleRate: Int = OUTPUT_SAMPLE_RATE,
) {
  private val sourceStep = inputFormat.sampleRate.toDouble() / outputSampleRate.toDouble()
  private var inputIndex = 0L
  private var nextOutputPosition = 0.0
  private var previousSample = 0.0
  private var hasPreviousSample = false

  init {
    require(inputFormat.bitsPerSample == 16) { "Only PCM16 input is supported" }
    require(inputFormat.channelCount == 1 || inputFormat.channelCount == 2) {
      "Only mono or stereo input is supported"
    }
    require(inputFormat.sampleRate > 0)
  }

  fun process(input: ByteArray, length: Int): ByteArray {
    if (length <= 0) return ByteArray(0)

    val bytesPerFrame = inputFormat.channelCount * 2
    val frameCount = length / bytesPerFrame
    if (frameCount == 0) return ByteArray(0)

    val output = ByteArrayOutputStream((frameCount / sourceStep + 2).roundToInt() * 2)

    for (frame in 0 until frameCount) {
      val offset = frame * bytesPerFrame
      val monoSample = if (inputFormat.channelCount == 1) {
        readSample(input, offset).toDouble()
      } else {
        val left = readSample(input, offset).toInt()
        val right = readSample(input, offset + 2).toInt()
        ((left + right) / 2.0)
      }

      if (!hasPreviousSample) {
        previousSample = monoSample
        hasPreviousSample = true
      }

      val currentPosition = inputIndex.toDouble()
      while (nextOutputPosition <= currentPosition) {
        val value = if (inputIndex == 0L) {
          monoSample
        } else {
          val fraction = (nextOutputPosition - (currentPosition - 1.0)).coerceIn(0.0, 1.0)
          previousSample + (monoSample - previousSample) * fraction
        }
        writeSample(output, value.roundToInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()))
        nextOutputPosition += sourceStep
      }

      previousSample = monoSample
      inputIndex += 1
    }

    return output.toByteArray()
  }

  fun reset() {
    inputIndex = 0L
    nextOutputPosition = 0.0
    previousSample = 0.0
    hasPreviousSample = false
  }

  companion object {
    const val OUTPUT_SAMPLE_RATE = 16_000
    val OUTPUT_FORMAT = AudioFormatSpec(sampleRate = OUTPUT_SAMPLE_RATE, channelCount = 1)

    fun calculateRms(pcm16Mono: ByteArray): Float {
      val sampleCount = pcm16Mono.size / 2
      if (sampleCount == 0) return 0f

      var sumSquares = 0.0
      var offset = 0
      while (offset + 1 < pcm16Mono.size) {
        val sample = readSample(pcm16Mono, offset).toDouble() / Short.MAX_VALUE.toDouble()
        sumSquares += sample * sample
        offset += 2
      }
      return sqrt(sumSquares / sampleCount).toFloat().coerceIn(0f, 1f)
    }

    private fun readSample(bytes: ByteArray, offset: Int): Short {
      val low = bytes[offset].toInt() and 0xff
      val high = bytes[offset + 1].toInt()
      return ((high shl 8) or low).toShort()
    }

    private fun writeSample(output: ByteArrayOutputStream, value: Int) {
      output.write(value and 0xff)
      output.write((value ushr 8) and 0xff)
    }
  }
}
