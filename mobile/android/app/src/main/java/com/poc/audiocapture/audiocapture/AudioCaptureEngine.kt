package com.poc.audiocapture.audiocapture

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Process
import androidx.annotation.RequiresApi
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max

class AudioCaptureEngine(
    private val fileStore: CaptureFileStore,
    private val callback: Callback,
) {
  interface Callback {
    fun onAudioLevel(source: TrackSource, level: Float)
    fun onPcmFrame(
        sessionId: UUID,
        source: TrackSource,
        sequence: Long,
        captureOffsetUs: Long,
        bytes: ByteArray,
        isFinal: Boolean,
    )
    fun onTrackError(error: CaptureException)
  }

  private data class PreparedRecorder(
      val recorder: AudioRecord,
      val format: AudioFormatSpec,
      val bufferSize: Int,
  )

  private data class TrackRuntime(
      val sessionId: UUID,
      val source: TrackSource,
      val inputFormat: AudioFormatSpec,
      val recorder: AudioRecord,
      val bufferSize: Int,
      val writer: CaptureFileStore.TrackWriter,
      val normalizer: PcmNormalizer,
      val frameAccumulator: PcmFrameAccumulator = PcmFrameAccumulator(),
      val running: AtomicBoolean = AtomicBoolean(false),
      var thread: Thread? = null,
      var networkBytes: Long = 0,
      var sequence: Long = 0,
      var lastLevelAtNanos: Long = 0,
      var fatalError: CaptureException? = null,
  )

  private val lock = Any()
  private var activeTracks: List<TrackRuntime> = emptyList()

  fun start(
      sessionId: UUID,
      source: CaptureSource,
      mediaProjection: MediaProjection?,
  ): Map<TrackSource, AudioFormatSpec> = synchronized(lock) {
    check(activeTracks.isEmpty()) { "Audio capture engine is already active" }

    val preparedTracks = mutableListOf<TrackRuntime>()
    try {
      if (source.needsMic) {
        val prepared = prepareMicRecorder()
        preparedTracks += createRuntime(sessionId, TrackSource.MIC, prepared)
      }
      if (source.needsSystem) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
          throw CaptureException(
              code = "E_SYSTEM_AUDIO_UNSUPPORTED",
              stage = "prepare",
              source = TrackSource.SYSTEM,
              message = "System audio capture requires Android 10 or newer",
          )
        }
        val projection = mediaProjection ?: throw CaptureException(
            code = "E_PROJECTION_REQUIRED",
            stage = "prepare",
            source = TrackSource.SYSTEM,
            message = "System audio capture requires MediaProjection consent",
        )
        val prepared = prepareSystemRecorder(projection)
        preparedTracks += createRuntime(sessionId, TrackSource.SYSTEM, prepared)
      }

      preparedTracks.forEach { runtime ->
        runtime.recorder.startRecording()
        if (runtime.recorder.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
          throw CaptureException(
              code = "E_CAPTURE_START",
              stage = "start",
              source = runtime.source,
              message = "AudioRecord did not enter the recording state",
          )
        }
      }

      preparedTracks.forEach { runtime ->
        runtime.running.set(true)
        runtime.thread = Thread({ captureLoop(runtime) }, "${runtime.source.wireName}-audio-capture").apply {
          start()
        }
      }
      activeTracks = preparedTracks.toList()
      activeTracks.associate { it.source to it.inputFormat }
    } catch (error: Throwable) {
      rollback(preparedTracks)
      throw if (error is CaptureException) error else CaptureException(
          code = "E_CAPTURE_PREPARE",
          stage = "prepare",
          message = error.message ?: "Unable to prepare audio capture",
          cause = error,
      )
    }
  }

  fun stop(): List<TrackFileResult> {
    val tracks = synchronized(lock) {
      val copy = activeTracks
      activeTracks = emptyList()
      copy
    }
    if (tracks.isEmpty()) return emptyList()

    tracks.forEach { runtime ->
      runtime.running.set(false)
      runCatching {
        if (runtime.recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
          runtime.recorder.stop()
        }
      }
    }

    val timeoutErrors = mutableListOf<CaptureException>()
    tracks.forEach { runtime ->
      val thread = runtime.thread
      if (thread != null && thread !== Thread.currentThread()) {
        thread.join(STOP_JOIN_TIMEOUT_MS)
        if (thread.isAlive) {
          thread.interrupt()
          thread.join(500)
        }
        if (thread.isAlive) {
          timeoutErrors += CaptureException(
              code = "E_STOP_TIMEOUT",
              stage = "stop",
              source = runtime.source,
              message = "Timed out waiting for ${runtime.source.wireName} capture thread",
          )
        }
      }
      runCatching { runtime.recorder.release() }
    }

    if (timeoutErrors.isNotEmpty()) {
      tracks.forEach { it.writer.abort() }
      throw timeoutErrors.first()
    }

    val results = mutableListOf<TrackFileResult>()
    tracks.forEach { runtime ->
      runtime.fatalError?.let { error ->
        if (runtime.networkBytes <= 0) {
          runtime.writer.abort()
          throw error
        }
      }
      results += runtime.writer.finalizeFiles(runtime.inputFormat)
    }
    return results
  }

  fun isRunning(): Boolean = synchronized(lock) { activeTracks.isNotEmpty() }

  private fun createRuntime(
      sessionId: UUID,
      source: TrackSource,
      prepared: PreparedRecorder,
  ): TrackRuntime = TrackRuntime(
      sessionId = sessionId,
      source = source,
      inputFormat = prepared.format,
      recorder = prepared.recorder,
      bufferSize = prepared.bufferSize,
      writer = fileStore.createTrackWriter(sessionId.toString(), source),
      normalizer = PcmNormalizer(prepared.format),
  )

  private fun prepareMicRecorder(): PreparedRecorder {
    var lastError: Throwable? = null
    for (sampleRate in SAMPLE_RATE_CANDIDATES) {
      for (channelMask in listOf(AudioFormat.CHANNEL_IN_MONO, AudioFormat.CHANNEL_IN_STEREO)) {
        try {
          val prepared = buildRecorder(
              source = MediaRecorder.AudioSource.MIC,
              sampleRate = sampleRate,
              channelMask = channelMask,
          )
          return prepared
        } catch (error: Throwable) {
          lastError = error
        }
      }
    }
    throw CaptureException(
        code = "E_MIC_INITIALIZE",
        stage = "prepare",
        source = TrackSource.MIC,
        message = lastError?.message ?: "No supported microphone format was found",
        cause = lastError,
    )
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun prepareSystemRecorder(mediaProjection: MediaProjection): PreparedRecorder {
    val captureConfiguration = AudioPlaybackCaptureConfiguration.Builder(mediaProjection)
        .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
        .addMatchingUsage(AudioAttributes.USAGE_GAME)
        .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
        .build()

    var lastError: Throwable? = null
    for (sampleRate in SAMPLE_RATE_CANDIDATES) {
      for (channelMask in listOf(AudioFormat.CHANNEL_IN_MONO, AudioFormat.CHANNEL_IN_STEREO)) {
        try {
          val channelCount = if (channelMask == AudioFormat.CHANNEL_IN_MONO) 1 else 2
          val minBuffer = AudioRecord.getMinBufferSize(
              sampleRate,
              channelMask,
              AudioFormat.ENCODING_PCM_16BIT,
          )
          check(minBuffer > 0) { "Unsupported system audio format" }
          val target40Ms = sampleRate * channelCount * 2 / 25
          val bufferSize = max(minBuffer, target40Ms)
          val format = AudioFormat.Builder()
              .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
              .setSampleRate(sampleRate)
              .setChannelMask(channelMask)
              .build()
          val recorder = AudioRecord.Builder()
              .setAudioPlaybackCaptureConfig(captureConfiguration)
              .setAudioFormat(format)
              .setBufferSizeInBytes(bufferSize)
              .build()
          if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            recorder.release()
            error("System AudioRecord initialization failed")
          }
          return PreparedRecorder(
              recorder = recorder,
              format = AudioFormatSpec(sampleRate, channelCount),
              bufferSize = bufferSize,
          )
        } catch (error: Throwable) {
          lastError = error
        }
      }
    }
    throw CaptureException(
        code = "E_SYSTEM_INITIALIZE",
        stage = "prepare",
        source = TrackSource.SYSTEM,
        message = lastError?.message ?: "No supported system audio format was found",
        cause = lastError,
    )
  }

  private fun buildRecorder(source: Int, sampleRate: Int, channelMask: Int): PreparedRecorder {
    val channelCount = if (channelMask == AudioFormat.CHANNEL_IN_MONO) 1 else 2
    val minBuffer = AudioRecord.getMinBufferSize(sampleRate, channelMask, AudioFormat.ENCODING_PCM_16BIT)
    check(minBuffer > 0) { "Unsupported AudioRecord format" }
    // READ_BLOCKING 缓冲区：目标 40ms，不低于硬件最小值
    // 原来 / 5 = 200ms，延迟 160ms 浪费在手机端
    val target40Ms = sampleRate * channelCount * 2 / 25
    val bufferSize = max(minBuffer, target40Ms)
    val format = AudioFormat.Builder()
        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
        .setSampleRate(sampleRate)
        .setChannelMask(channelMask)
        .build()
    val recorder = AudioRecord.Builder()
        .setAudioSource(source)
        .setAudioFormat(format)
        .setBufferSizeInBytes(bufferSize)
        .build()
    if (recorder.state != AudioRecord.STATE_INITIALIZED) {
      recorder.release()
      error("AudioRecord initialization failed")
    }
    return PreparedRecorder(
        recorder = recorder,
        format = AudioFormatSpec(sampleRate, channelCount),
        bufferSize = bufferSize,
    )
  }

  private fun captureLoop(runtime: TrackRuntime) {
    Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
    val inputBuffer = ByteArray(runtime.bufferSize)
    try {
      while (runtime.running.get()) {
        val read = runtime.recorder.read(inputBuffer, 0, inputBuffer.size, AudioRecord.READ_BLOCKING)
        when {
          read > 0 -> processInput(runtime, inputBuffer, read)
          read == 0 -> Unit
          !runtime.running.get() -> break
          else -> throw CaptureException(
              code = "E_CAPTURE_READ",
              stage = "capture",
              source = runtime.source,
              message = "AudioRecord.read failed with code $read",
          )
        }
      }
    } catch (error: Throwable) {
      if (runtime.running.get()) {
        val captureError = if (error is CaptureException) error else CaptureException(
            code = "E_CAPTURE_READ",
            stage = "capture",
            source = runtime.source,
            message = error.message ?: "Audio capture thread failed",
            cause = error,
        )
        runtime.fatalError = captureError
        callback.onTrackError(captureError)
      }
    } finally {
      runtime.frameAccumulator.flush { frame, isFinal -> emitFrame(runtime, frame, isFinal) }
      runtime.running.set(false)
    }
  }

  private fun processInput(runtime: TrackRuntime, input: ByteArray, read: Int) {
    val normalized = runtime.normalizer.process(input, read)
    if (normalized.isEmpty()) return

    runtime.writer.write(normalized)
    runtime.frameAccumulator.append(normalized) { frame, isFinal -> emitFrame(runtime, frame, isFinal) }

    val now = System.nanoTime()
    if (now - runtime.lastLevelAtNanos >= LEVEL_INTERVAL_NANOS) {
      runtime.lastLevelAtNanos = now
      callback.onAudioLevel(runtime.source, PcmNormalizer.calculateRms(normalized))
    }
  }

  private fun emitFrame(runtime: TrackRuntime, frame: ByteArray, isFinal: Boolean) {
    val captureOffsetUs = runtime.networkBytes * 1_000_000L / PcmNormalizer.OUTPUT_FORMAT.bytesPerSecond
    callback.onPcmFrame(
        sessionId = runtime.sessionId,
        source = runtime.source,
        sequence = runtime.sequence,
        captureOffsetUs = captureOffsetUs,
        bytes = frame,
        isFinal = isFinal,
    )
    runtime.sequence += 1
    runtime.networkBytes += frame.size
  }

  private fun rollback(tracks: Collection<TrackRuntime>) {
    tracks.forEach { runtime ->
      runtime.running.set(false)
      runCatching {
        if (runtime.recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
          runtime.recorder.stop()
        }
      }
      runtime.thread?.takeIf { it !== Thread.currentThread() }?.join(500)
      runCatching { runtime.recorder.release() }
      runtime.writer.abort()
    }
    activeTracks = emptyList()
  }

  companion object {
    private val SAMPLE_RATE_CANDIDATES = listOf(16_000, 48_000, 44_100)
    private const val STOP_JOIN_TIMEOUT_MS = 3_000L
    private val LEVEL_INTERVAL_NANOS = 500_000_000L
  }
}
