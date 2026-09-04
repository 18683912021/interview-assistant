package com.poc.audiocapture.audiocapture

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream

object WavWriter {
  fun write(pcmFile: File, wavFile: File, format: AudioFormatSpec) {
    require(format.bitsPerSample == 16) { "Only PCM16 WAV output is supported" }
    val dataLength = pcmFile.length()
    require(dataLength <= 0xffffffffL) { "PCM file is too large for RIFF/WAVE" }

    wavFile.parentFile?.mkdirs()
    BufferedOutputStream(FileOutputStream(wavFile)).use { output ->
      writeAscii(output, "RIFF")
      writeIntLE(output, (36L + dataLength).toInt())
      writeAscii(output, "WAVE")
      writeAscii(output, "fmt ")
      writeIntLE(output, 16)
      writeShortLE(output, 1)
      writeShortLE(output, format.channelCount)
      writeIntLE(output, format.sampleRate)
      writeIntLE(output, format.bytesPerSecond)
      writeShortLE(output, format.channelCount * format.bytesPerSample)
      writeShortLE(output, format.bitsPerSample)
      writeAscii(output, "data")
      writeIntLE(output, dataLength.toInt())

      BufferedInputStream(FileInputStream(pcmFile)).use { input ->
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          output.write(buffer, 0, read)
        }
      }
    }
  }

  private fun writeAscii(output: BufferedOutputStream, value: String) {
    output.write(value.toByteArray(Charsets.US_ASCII))
  }

  private fun writeShortLE(output: BufferedOutputStream, value: Int) {
    output.write(value and 0xff)
    output.write((value ushr 8) and 0xff)
  }

  private fun writeIntLE(output: BufferedOutputStream, value: Int) {
    output.write(value and 0xff)
    output.write((value ushr 8) and 0xff)
    output.write((value ushr 16) and 0xff)
    output.write((value ushr 24) and 0xff)
  }
}
