package com.poc.audiocapture.audiocapture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.poc.audiocapture.BuildConfig
import com.poc.audiocapture.MainActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executor
import org.json.JSONObject

class AudioCaptureService : Service(), AudioCaptureEngine.Callback, AudioStreamClient.Listener {
  data class ProjectionConsent(val resultCode: Int, val data: Intent)

  data class StartInfo(
      val operationId: String,
      val sessionId: String,
      val source: CaptureSource,
      val startedAtUtc: String,
      val inputFormats: Map<TrackSource, AudioFormatSpec>,
  )

  interface Listener {
    fun onCaptureState(state: CaptureState, snapshot: ServiceSnapshot)
    fun onAudioLevels(mic: Float, system: Float)
    fun onStreamState(state: StreamState, message: String?)
    fun onStreamStats(stats: StreamStats)
    fun onNativeError(error: CaptureException)
    fun onTranscription(text: String, isFinal: Boolean, source: String)
    fun onLLMStart(questionText: String, mode: String, language: String, timestamp: Long)
    fun onLLMChunk(chunkIndex: Int, delta: String, timestamp: Long)
    fun onLLMDone(fullAnswer: String, mode: String, timestamp: Long, error: String?)
  }

  data class ServiceSnapshot(
      val captureState: CaptureState,
      val streamState: StreamState,
      val operationId: String?,
      val sessionId: String?,
      val source: CaptureSource?,
      val startedAtUtc: String?,
      val micLevel: Float,
      val systemLevel: Float,
      val lastResult: CaptureResult?,
      val streamStats: StreamStats,
      val pendingBackfill: Boolean,
  )

  inner class LocalBinder : Binder() {
    fun service(): AudioCaptureService = this@AudioCaptureService
  }

  private val binder = LocalBinder()
  private val commandThread = HandlerThread("audio-capture-service").apply { start() }
  private val commandExecutor = Executor { runnable -> Handler(commandThread.looper).post(runnable) }
  private val listeners = CopyOnWriteArraySet<Listener>()

  private lateinit var fileStore: CaptureFileStore
  private lateinit var captureEngine: AudioCaptureEngine
  private lateinit var streamClient: AudioStreamClient

  @Volatile private var captureState = CaptureState.IDLE
  @Volatile private var operationId: String? = null
  @Volatile private var sessionId: UUID? = null
  @Volatile private var source: CaptureSource? = null
  @Volatile private var startedAtUtc: String? = null
  @Volatile private var micLevel = 0f
  @Volatile private var systemLevel = 0f
  @Volatile private var lastResult: CaptureResult? = null
  @Volatile private var pendingBackfill = false

  private var mediaProjection: MediaProjection? = null
  private var projectionCallback: MediaProjection.Callback? = null
  private var projectionStopping = false
  private val lastSequences = ConcurrentHashMap<TrackSource, Long>()

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    fileStore = CaptureFileStore(this)
    captureEngine = AudioCaptureEngine(fileStore, this)
    streamClient = AudioStreamClient().also { it.setListener(this) }
  }

  override fun onBind(intent: Intent?): IBinder = binder

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> stopCapture("notification", null)
      ACTION_START -> {
        val requestedSource = runCatching {
          CaptureSource.fromWireName(intent.getStringExtra(EXTRA_SOURCE) ?: "mic")
        }.getOrDefault(CaptureSource.MIC)
        ensureForeground(requestedSource)
      }
    }
    return START_NOT_STICKY
  }

  fun addListener(listener: Listener) {
    listeners += listener
    listener.onCaptureState(captureState, snapshot())
    listener.onStreamState(streamClient.currentState(), null)
    listener.onStreamStats(streamClient.currentStats())
  }

  fun removeListener(listener: Listener) {
    listeners -= listener
  }

  fun startCapture(
      request: CaptureRequest,
      projectionConsent: ProjectionConsent?,
      callback: (Result<StartInfo>) -> Unit,
  ) {
    commandExecutor.execute {
      if (captureState !in setOf(CaptureState.IDLE, CaptureState.COMPLETED, CaptureState.ERROR)) {
        callback(Result.failure(CaptureException(
            code = "E_INVALID_STATE",
            stage = "start",
            message = "Cannot start capture while state is ${captureState.wireName}",
        )))
        return@execute
      }

      transitionCapture(CaptureState.PREPARING)
      operationId = request.operationId
      source = request.source
      val newSessionId = UUID.randomUUID()
      sessionId = newSessionId
      startedAtUtc = utcNow()
      lastResult = null
      pendingBackfill = false
      lastSequences.clear()
      micLevel = 0f
      systemLevel = 0f

      try {
        ensureForeground(request.source)
        val projection = if (request.source.needsSystem) {
          val consent = projectionConsent ?: throw CaptureException(
              code = "E_PROJECTION_REQUIRED",
              stage = "start",
              source = TrackSource.SYSTEM,
              message = "System audio capture requires fresh MediaProjection consent",
          )
          createProjection(consent)
        } else {
          null
        }

        val inputFormats = captureEngine.start(newSessionId, request.source, projection)
        val tracks = inputFormats.keys
        if (streamClient.currentState() == StreamState.READY) {
          streamClient.startSession(newSessionId.toString(), request.source, tracks)
        }
        transitionCapture(CaptureState.CAPTURING)
        callback(Result.success(StartInfo(
            operationId = request.operationId,
            sessionId = newSessionId.toString(),
            source = request.source,
            startedAtUtc = startedAtUtc!!,
            inputFormats = inputFormats,
        )))
      } catch (error: Throwable) {
        cleanupProjection()
        stopForegroundCompat()
        val captureError = asCaptureException(error, "E_CAPTURE_START", "start")
        transitionCapture(CaptureState.ERROR)
        notifyError(captureError)
        callback(Result.failure(captureError))
      }
    }
  }

  fun stopCapture(reason: String, callback: ((Result<CaptureResult>) -> Unit)?) {
    commandExecutor.execute {
      if (!captureEngine.isRunning()) {
        val existing = lastResult
        if (existing != null) {
          callback?.invoke(Result.success(existing))
        } else {
          callback?.invoke(Result.failure(CaptureException(
              code = "E_INVALID_STATE",
              stage = "stop",
              message = "No capture session is active",
          )))
        }
        return@execute
      }

      transitionCapture(CaptureState.STOPPING)
      val activeSession = requireNotNull(sessionId)
      val activeSource = requireNotNull(source)
      val activeOperation = requireNotNull(operationId)
      val activeStartedAt = requireNotNull(startedAtUtc)

      try {
        val tracks = captureEngine.stop()
        transitionCapture(CaptureState.FINALIZING)
        tracks.forEach { result ->
          streamClient.finishRealtime(
              activeSession.toString(),
              result.source,
              lastSequences[result.source] ?: -1,
          )
        }
        streamClient.finishSession(activeSession.toString(), reason)
        cleanupProjection()

        val result = CaptureResult(
            operationId = activeOperation,
            sessionId = activeSession.toString(),
            source = activeSource,
            startedAtUtc = activeStartedAt,
            endedAtUtc = utcNow(),
            stopReason = reason,
            tracks = tracks,
        )
        lastResult = result
        micLevel = 0f
        systemLevel = 0f
        transitionCapture(CaptureState.COMPLETED)
        stopForegroundCompat()
        callback?.invoke(Result.success(result))

        if (streamClient.currentState() == StreamState.READY && tracks.isNotEmpty()) {
          backfillTracks(activeSession, tracks, 0)
        } else if (tracks.isNotEmpty()) {
          pendingBackfill = true
          notifyCaptureState()
        }
      } catch (error: Throwable) {
        cleanupProjection()
        stopForegroundCompat()
        val captureError = asCaptureException(error, "E_CAPTURE_STOP", "stop")
        transitionCapture(CaptureState.ERROR)
        notifyError(captureError)
        callback?.invoke(Result.failure(captureError))
      }
    }
  }

  fun connectStream(url: String, callback: (Result<Unit>) -> Unit) {
    streamClient.connect(url, allowCleartext = BuildConfig.DEBUG) { result ->
      if (result.isFailure) {
        callback(result)
      } else {
        commandExecutor.execute {
          val activeSession = sessionId
          val activeSource = source
          if (captureState == CaptureState.CAPTURING && activeSession != null && activeSource != null) {
            val tracks = buildList {
              if (activeSource.needsMic) add(TrackSource.MIC)
              if (activeSource.needsSystem) add(TrackSource.SYSTEM)
            }
            streamClient.startSession(activeSession.toString(), activeSource, tracks)
          }
          callback(Result.success(Unit))
        }
      }
    }
  }

  fun disconnectStream() {
    streamClient.disconnect()
  }

  fun sendControl(message: String) {
    streamClient.sendControl(message)
  }

  fun retryBackfill(callback: (Result<Unit>) -> Unit) {
    commandExecutor.execute {
      val result = lastResult
      if (result == null || result.tracks.isEmpty()) {
        callback(Result.failure(CaptureException(
            code = "E_BACKFILL_MISSING",
            stage = "backfill",
            message = "No completed capture is available for backfill",
        )))
        return@execute
      }
      if (streamClient.currentState() != StreamState.READY) {
        callback(Result.failure(CaptureException(
            code = "E_BACKFILL_OFFLINE",
            stage = "backfill",
            message = "Connect the WebSocket before retrying backfill",
        )))
        return@execute
      }
      pendingBackfill = false
      backfillTracks(UUID.fromString(result.sessionId), result.tracks, 0, callback)
    }
  }

  fun snapshot(): ServiceSnapshot = ServiceSnapshot(
      captureState = captureState,
      streamState = streamClient.currentState(),
      operationId = operationId,
      sessionId = sessionId?.toString(),
      source = source,
      startedAtUtc = startedAtUtc,
      micLevel = micLevel,
      systemLevel = systemLevel,
      lastResult = lastResult,
      streamStats = streamClient.currentStats(),
      pendingBackfill = pendingBackfill,
  )

  fun findOutput(sessionId: String, source: TrackSource, kind: String) =
      fileStore.findOutput(sessionId, source, kind)

  override fun onAudioLevel(source: TrackSource, level: Float) {
    when (source) {
      TrackSource.MIC -> micLevel = level
      TrackSource.SYSTEM -> systemLevel = level
    }
    listeners.forEach { it.onAudioLevels(micLevel, systemLevel) }
  }

  override fun onPcmFrame(
      sessionId: UUID,
      source: TrackSource,
      sequence: Long,
      captureOffsetUs: Long,
      bytes: ByteArray,
      isFinal: Boolean,
  ) {
    lastSequences[source] = sequence
    streamClient.enqueueRealtime(
        sessionId = sessionId,
        source = source,
        sequence = sequence,
        captureOffsetUs = captureOffsetUs,
        payload = bytes,
        isFinal = isFinal,
    )
  }

  override fun onTrackError(error: CaptureException) {
    notifyError(error)
    stopCapture("native_error", null)
  }

  override fun onStreamState(state: StreamState, message: String?) {
    listeners.forEach { it.onStreamState(state, message) }
  }

  override fun onStreamStats(stats: StreamStats) {
    listeners.forEach { it.onStreamStats(stats) }
  }

  override fun onTranscription(text: String, isFinal: Boolean, source: String) {
    android.util.Log.d("AudioCaptureService", "转发转录: text=$text isFinal=$isFinal source=$source listeners=${listeners.size}")
    listeners.forEach { it.onTranscription(text, isFinal, source) }
  }

  override fun onLLMStart(questionText: String, mode: String, language: String, timestamp: Long) {
    listeners.forEach { it.onLLMStart(questionText, mode, language, timestamp) }
  }

  override fun onLLMChunk(chunkIndex: Int, delta: String, timestamp: Long) {
    listeners.forEach { it.onLLMChunk(chunkIndex, delta, timestamp) }
  }

  override fun onLLMDone(fullAnswer: String, mode: String, timestamp: Long, error: String?) {
    listeners.forEach { it.onLLMDone(fullAnswer, mode, timestamp, error) }
  }

  override fun onDestroy() {
    listeners.clear()
    runCatching { if (captureEngine.isRunning()) captureEngine.stop() }
    cleanupProjection()
    streamClient.shutdown()
    commandThread.quitSafely()
    super.onDestroy()
  }

  private fun createProjection(consent: ProjectionConsent): MediaProjection {
    val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    val projection = manager.getMediaProjection(consent.resultCode, consent.data)
        ?: throw CaptureException(
            code = "E_PROJECTION_CREATE",
            stage = "start",
            source = TrackSource.SYSTEM,
            message = "Unable to create MediaProjection",
        )
    val callback = object : MediaProjection.Callback() {
      override fun onStop() {
        if (projectionStopping) return
        notifyError(CaptureException(
            code = "E_PROJECTION_REVOKED",
            stage = "capture",
            source = TrackSource.SYSTEM,
            message = "System audio permission was revoked",
        ))
        stopCapture("projection_revoked", null)
      }
    }
    projection.registerCallback(callback, null)
    mediaProjection = projection
    projectionCallback = callback
    return projection
  }

  private fun cleanupProjection() {
    val projection = mediaProjection ?: return
    projectionStopping = true
    projectionCallback?.let { runCatching { projection.unregisterCallback(it) } }
    runCatching { projection.stop() }
    projectionCallback = null
    mediaProjection = null
    projectionStopping = false
  }

  private fun backfillTracks(
      sessionId: UUID,
      tracks: List<TrackFileResult>,
      index: Int,
      finalCallback: ((Result<Unit>) -> Unit)? = null,
  ) {
    if (index >= tracks.size) {
      pendingBackfill = false
      streamClient.completeSession(sessionId.toString())
      notifyCaptureState()
      finalCallback?.invoke(Result.success(Unit))
      return
    }

    streamClient.backfill(sessionId, tracks[index]) { result ->
      commandExecutor.execute {
        if (result.isSuccess) {
          backfillTracks(sessionId, tracks, index + 1, finalCallback)
        } else {
          pendingBackfill = true
          notifyCaptureState()
          finalCallback?.invoke(result)
        }
      }
    }
  }

  private fun ensureForeground(source: CaptureSource) {
    val notification = buildNotification(source)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      var type = 0
      if (source.needsSystem) {
        type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
      }
      if (source.needsMic && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      }
      if (type != 0) {
        startForeground(NOTIFICATION_ID, notification, type)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun stopForegroundCompat() {
    stopForeground(STOP_FOREGROUND_REMOVE)
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
        NOTIFICATION_CHANNEL_ID,
        "Audio capture",
        NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Shows when microphone or system audio capture is active"
      setSound(null, null)
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun buildNotification(source: CaptureSource): Notification {
    val contentIntent = PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val stopIntent = PendingIntent.getService(
        this,
        1,
        Intent(this, AudioCaptureService::class.java).setAction(ACTION_STOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
        .setContentTitle("Audio Capture")
        .setContentText("Capturing ${source.wireName} audio")
        .setContentIntent(contentIntent)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .addAction(0, "Stop", stopIntent)
        .build()
  }

  private fun transitionCapture(state: CaptureState) {
    captureState = state
    notifyCaptureState()
  }

  private fun notifyCaptureState() {
    val snapshot = snapshot()
    listeners.forEach { it.onCaptureState(captureState, snapshot) }
  }

  private fun notifyError(error: CaptureException) {
    listeners.forEach { it.onNativeError(error) }
  }

  private fun asCaptureException(error: Throwable, code: String, stage: String): CaptureException =
      if (error is CaptureException) error else CaptureException(
          code = code,
          stage = stage,
          message = error.message ?: "Audio capture failed",
          cause = error,
      )

  companion object {
    const val ACTION_START = "com.poc.audiocapture.action.START"
    const val ACTION_STOP = "com.poc.audiocapture.action.STOP"
    const val EXTRA_SOURCE = "capture_source"
    private const val NOTIFICATION_CHANNEL_ID = "audio_capture"
    private const val NOTIFICATION_ID = 2001

    fun startIntent(context: Context, source: CaptureSource): Intent =
        Intent(context, AudioCaptureService::class.java)
            .setAction(ACTION_START)
            .putExtra(EXTRA_SOURCE, source.wireName)

    private fun utcNow(): String {
      val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
      formatter.timeZone = TimeZone.getTimeZone("UTC")
      return formatter.format(Date())
    }
  }
}
