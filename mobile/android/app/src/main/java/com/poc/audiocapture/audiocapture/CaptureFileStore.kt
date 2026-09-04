package com.poc.audiocapture.audiocapture

import android.content.Context
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest

class CaptureFileStore(context: Context) {
  private val capturesRoot = File(context.filesDir, "captures").apply { mkdirs() }

  fun createTrackWriter(sessionId: String, source: TrackSource): TrackWriter {
    validateSessionId(sessionId)
    val sessionDirectory = File(capturesRoot, sessionId).apply { mkdirs() }
    return TrackWriter(sessionDirectory, source)
  }

  fun findOutput(sessionId: String, source: TrackSource, kind: String): File? {
    validateSessionId(sessionId)
    val extension = when (kind) {
      "pcm" -> "pcm"
      "wav" -> "wav"
      else -> return null
    }
    return File(File(capturesRoot, sessionId), "${source.wireName}.$extension")
        .takeIf { it.isFile && it.length() > 0L }
  }

  fun sessionDirectory(sessionId: String): File {
    validateSessionId(sessionId)
    return File(capturesRoot, sessionId)
  }

  private fun validateSessionId(sessionId: String) {
    require(SESSION_ID_PATTERN.matches(sessionId)) { "Invalid session id" }
  }

  class TrackWriter(
      sessionDirectory: File,
      private val source: TrackSource,
  ) {
    private val partFile = File(sessionDirectory, "${source.wireName}.pcm.part")
    private val pcmFile = File(sessionDirectory, "${source.wireName}.pcm")
    private val wavFile = File(sessionDirectory, "${source.wireName}.wav")
    private val output = BufferedOutputStream(FileOutputStream(partFile, false))
    private var closed = false
    private var bytesWritten = 0L

    fun write(bytes: ByteArray) {
      check(!closed) { "Track writer is already closed" }
      output.write(bytes)
      bytesWritten += bytes.size
    }

    fun abort() {
      if (!closed) {
        runCatching { output.close() }
        closed = true
      }
      partFile.delete()
      pcmFile.delete()
      wavFile.delete()
    }

    fun finalizeFiles(inputFormat: AudioFormatSpec): TrackFileResult {
      check(!closed) { "Track writer is already closed" }
      output.flush()
      output.close()
      closed = true

      if (bytesWritten <= 0L) {
        abortCompletedFiles()
        throw CaptureException(
            code = "E_EMPTY_CAPTURE",
            stage = "finalize",
            source = source,
            message = "No PCM data was captured for ${source.wireName}",
        )
      }

      pcmFile.delete()
      if (!partFile.renameTo(pcmFile)) {
        partFile.copyTo(pcmFile, overwrite = true)
        if (!partFile.delete()) {
          throw CaptureException(
              code = "E_FILE_FINALIZE",
              stage = "finalize",
              source = source,
              message = "Unable to remove temporary PCM file",
          )
        }
      }

      WavWriter.write(pcmFile, wavFile, PcmNormalizer.OUTPUT_FORMAT)
      val durationMs = pcmFile.length() * 1_000L / PcmNormalizer.OUTPUT_FORMAT.bytesPerSecond

      return TrackFileResult(
          source = source,
          inputFormat = inputFormat,
          outputFormat = PcmNormalizer.OUTPUT_FORMAT,
          pcmFile = pcmFile,
          wavFile = wavFile,
          pcmBytes = pcmFile.length(),
          durationMs = durationMs,
          pcmSha256 = sha256(pcmFile),
          wavSha256 = sha256(wavFile),
      )
    }

    private fun abortCompletedFiles() {
      partFile.delete()
      pcmFile.delete()
      wavFile.delete()
    }
  }

  companion object {
    private val SESSION_ID_PATTERN = Regex("^[0-9a-fA-F-]{36}$")

    fun sha256(file: File): String {
      val digest = MessageDigest.getInstance("SHA-256")
      FileInputStream(file).use { input ->
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
          val read = input.read(buffer)
          if (read < 0) break
          digest.update(buffer, 0, read)
        }
      }
      return digest.digest().joinToString(separator = "") { byte -> "%02x".format(byte) }
    }
  }
}
