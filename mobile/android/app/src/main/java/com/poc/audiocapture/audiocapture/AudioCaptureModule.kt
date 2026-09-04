package com.poc.audiocapture.audiocapture

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.IBinder
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import java.io.File
import java.util.ArrayDeque
import java.util.UUID

class AudioCaptureModule(
    private val context: ReactApplicationContext,
) : ReactContextBaseJavaModule(context),
    ActivityEventListener,
    LifecycleEventListener,
    AudioCaptureService.Listener {

  private data class PendingServiceAction(
      val onReady: (AudioCaptureService) -> Unit,
      val onFailure: (Throwable) -> Unit,
  )

  private var service: AudioCaptureService? = null
  private var serviceBound = false
  private var bindingInProgress = false
  private val pendingActions = ArrayDeque<PendingServiceAction>()

  private var pendingProjectionPromise: Promise? = null
  private var projectionConsent: AudioCaptureService.ProjectionConsent? = null
  private var listenerCount = 0

  private val serviceConnection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
      val connected = (binder as? AudioCaptureService.LocalBinder)?.service()
      if (connected == null) {
        failPendingActions(CaptureException(
            code = "E_SERVICE_BIND",
            stage = "service",
            message = "Audio capture service returned an invalid binder",
        ))
        return
      }
      service = connected
      serviceBound = true
      bindingInProgress = false
      connected.addListener(this@AudioCaptureModule)
      drainPendingActions(connected)
    }

    override fun onServiceDisconnected(name: ComponentName?) {
      service?.removeListener(this@AudioCaptureModule)
      service = null
      serviceBound = false
      bindingInProgress = false
    }

    override fun onBindingDied(name: ComponentName?) {
      onServiceDisconnected(name)
      failPendingActions(CaptureException(
          code = "E_SERVICE_DIED",
          stage = "service",
          message = "Audio capture service binding died",
      ))
    }
  }

  init {
    context.addActivityEventListener(this)
    context.addLifecycleEventListener(this)
    ensureServiceBound()
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun getCapabilities(promise: Promise) {
    val map = Arguments.createMap().apply {
      putInt("apiLevel", Build.VERSION.SDK_INT)
      putBoolean("microphone", true)
      putBoolean("systemAudio", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
      putInt("outputSampleRate", PcmNormalizer.OUTPUT_FORMAT.sampleRate)
      putInt("outputChannels", PcmNormalizer.OUTPUT_FORMAT.channelCount)
      putInt("outputBitDepth", PcmNormalizer.OUTPUT_FORMAT.bitsPerSample)
      putInt("chunkDurationMs", 40)
    }
    promise.resolve(map)
  }

  @ReactMethod
  fun requestProjectionConsent(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.reject("E_SYSTEM_AUDIO_UNSUPPORTED", "System audio capture requires Android 10 or newer")
      return
    }
    if (pendingProjectionPromise != null) {
      promise.reject("E_INVALID_STATE", "A MediaProjection request is already active")
      return
    }
    val activity = currentActivity
    if (activity == null) {
      promise.reject("E_ACTIVITY", "No foreground Activity is available")
      return
    }

    val manager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    pendingProjectionPromise = promise
    projectionConsent = null
    try {
      activity.startActivityForResult(manager.createScreenCaptureIntent(), PROJECTION_REQUEST_CODE)
    } catch (error: Throwable) {
      pendingProjectionPromise = null
      promise.reject("E_PROJECTION_REQUEST", error.message, error)
    }
  }

  @ReactMethod
  fun startCapture(options: ReadableMap, promise: Promise) {
    val source = try {
      CaptureSource.fromWireName(options.getString("source") ?: "mic")
    } catch (error: Throwable) {
      reject(promise, error)
      return
    }
    val operationId = options.takeIf { it.hasKey("operationId") }?.getString("operationId")
        ?: UUID.randomUUID().toString()

    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) !=
        PackageManager.PERMISSION_GRANTED) {
      promise.reject("E_RECORD_PERMISSION", "RECORD_AUDIO permission has not been granted")
      return
    }
    if (source.needsSystem && Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.reject("E_SYSTEM_AUDIO_UNSUPPORTED", "System audio capture requires Android 10 or newer")
      return
    }

    val consent = if (source.needsSystem) projectionConsent.also { projectionConsent = null } else null
    if (source.needsSystem && consent == null) {
      promise.reject("E_PROJECTION_REQUIRED", "Request fresh MediaProjection consent before starting")
      return
    }

    try {
      ContextCompat.startForegroundService(context, AudioCaptureService.startIntent(context, source))
    } catch (error: Throwable) {
      promise.reject("E_SERVICE_START", error.message, error)
      return
    }

    withService(
        onReady = { connected ->
          connected.startCapture(CaptureRequest(operationId, source), consent) { result ->
            result.fold(
                onSuccess = { promise.resolve(startInfoToMap(it)) },
                onFailure = { reject(promise, it) },
            )
          }
        },
        onFailure = { reject(promise, it) },
    )
  }

  @ReactMethod
  fun stopCapture(promise: Promise) {
    withService(
        onReady = { connected ->
          connected.stopCapture("user") { result ->
            result.fold(
                onSuccess = { promise.resolve(captureResultToMap(it)) },
                onFailure = { reject(promise, it) },
            )
          }
        },
        onFailure = { reject(promise, it) },
    )
  }

  @ReactMethod
  fun getSnapshot(promise: Promise) {
    withService(
        onReady = { promise.resolve(snapshotToMap(it.snapshot())) },
        onFailure = { reject(promise, it) },
    )
  }

  @ReactMethod
  fun connectStream(url: String, promise: Promise) {
    withService(
        onReady = { connected ->
          connected.connectStream(url) { result ->
            result.fold(
                onSuccess = { promise.resolve(null) },
                onFailure = { reject(promise, it) },
            )
          }
        },
        onFailure = { reject(promise, it) },
    )
  }

  @ReactMethod
  fun disconnectStream(promise: Promise) {
    withService(
        onReady = {
          it.disconnectStream()
          promise.resolve(null)
        },
        onFailure = { reject(promise, it) },
    )
  }

  @ReactMethod
  fun retryBackfill(promise: Promise) {
    withService(
        onReady = { connected ->
          connected.retryBackfill { result ->
            result.fold(
                onSuccess = { promise.resolve(null) },
                onFailure = { reject(promise, it) },
            )
          }
        },
        onFailure = { reject(promise, it) },
    )
  }

  @ReactMethod
  fun sendControl(message: String) {
    withService(
        onReady = { connected ->
          connected.sendControl(message)
        },
        onFailure = { android.util.Log.w("AudioCaptureModule", "sendControl: service not ready: ${it.message}") },
    )
  }

  @ReactMethod
  fun shareOutput(sessionId: String, sourceValue: String, kind: String, promise: Promise) {
    val source = TrackSource.entries.firstOrNull { it.wireName == sourceValue }
    if (source == null) {
      promise.reject("E_FILE_SOURCE", "Unknown file source: $sourceValue")
      return
    }
    withService(
        onReady = { connected ->
          val file = connected.findOutput(sessionId, source, kind)
          if (file == null) {
            promise.reject("E_FILE_MISSING", "The requested output file does not exist")
            return@withService
          }
          try {
            shareFile(file, kind)
            promise.resolve(null)
          } catch (error: Throwable) {
            promise.reject("E_FILE_SHARE", error.message, error)
          }
        },
        onFailure = { reject(promise, it) },
    )
  }

  @ReactMethod
  fun addListener(eventName: String) {
    listenerCount += 1
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    listenerCount = (listenerCount - count).coerceAtLeast(0)
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != PROJECTION_REQUEST_CODE) return
    val promise = pendingProjectionPromise ?: return
    pendingProjectionPromise = null

    if (resultCode == Activity.RESULT_OK && data != null) {
      projectionConsent = AudioCaptureService.ProjectionConsent(resultCode, Intent(data))
      promise.resolve(true)
    } else {
      projectionConsent = null
      promise.resolve(false)
    }
  }

  override fun onNewIntent(intent: Intent?) = Unit

  override fun onHostResume() = Unit

  override fun onHostPause() = Unit

  override fun onHostDestroy() {
    pendingProjectionPromise?.reject("E_ACTIVITY_DESTROYED", "Activity was destroyed during MediaProjection consent")
    pendingProjectionPromise = null
    projectionConsent = null
    unbindService()
  }

  override fun invalidate() {
    pendingProjectionPromise?.reject("E_MODULE_INVALIDATED", "Audio capture module was invalidated")
    pendingProjectionPromise = null
    projectionConsent = null
    context.removeActivityEventListener(this)
    context.removeLifecycleEventListener(this)
    unbindService()
    super.invalidate()
  }

  override fun onCaptureState(
      state: CaptureState,
      snapshot: AudioCaptureService.ServiceSnapshot,
  ) {
    val event = snapshotToMap(snapshot).apply { putString("state", state.wireName) }
    emit(EVENT_CAPTURE_STATE, event)
  }

  override fun onAudioLevels(mic: Float, system: Float) {
    emit(EVENT_AUDIO_LEVELS, Arguments.createMap().apply {
      putDouble("mic", mic.toDouble())
      putDouble("system", system.toDouble())
    })
  }

  override fun onStreamState(state: StreamState, message: String?) {
    emit(EVENT_STREAM_STATE, Arguments.createMap().apply {
      putString("state", state.wireName)
      message?.let { putString("message", it) }
    })
  }

  override fun onStreamStats(stats: StreamStats) {
    emit(EVENT_STREAM_STATS, streamStatsToMap(stats))
  }

  override fun onNativeError(error: CaptureException) {
    emit(EVENT_NATIVE_ERROR, errorToMap(error))
  }

  override fun onTranscription(text: String, isFinal: Boolean, source: String) {
    android.util.Log.d("AudioCaptureModule", "发射转录事件: text=$text isFinal=$isFinal source=$source")
    emit(EVENT_TRANSCRIPTION, Arguments.createMap().apply {
      putString("text", text)
      putBoolean("isFinal", isFinal)
      putString("source", source)
    })
  }

  override fun onLLMStart(questionText: String, mode: String, language: String, timestamp: Long) {
    android.util.Log.d("AudioCaptureModule", "发射LLM start: mode=$mode lang=$language qText=${questionText.take(60)}")
    emit(EVENT_LLM_START, Arguments.createMap().apply {
      putString("question_text", questionText)
      putString("mode", mode)
      putString("language", language)
      putDouble("timestamp", timestamp.toDouble())
    })
  }

  override fun onLLMChunk(chunkIndex: Int, delta: String, timestamp: Long) {
    emit(EVENT_LLM_CHUNK, Arguments.createMap().apply {
      putInt("chunk_index", chunkIndex)
      putString("delta", delta)
      putDouble("timestamp", timestamp.toDouble())
    })
  }

  override fun onLLMDone(fullAnswer: String, mode: String, timestamp: Long, error: String?) {
    android.util.Log.d("AudioCaptureModule", "发射LLM done: mode=$mode len=${fullAnswer.length} error=$error")
    emit(EVENT_LLM_DONE, Arguments.createMap().apply {
      putString("full_answer", fullAnswer)
      putString("mode", mode)
      putDouble("timestamp", timestamp.toDouble())
      if (error != null) putString("error", error)
    })
  }

  private fun ensureServiceBound() {
    if (serviceBound || bindingInProgress) return
    bindingInProgress = true
    val bound = context.bindService(
        Intent(context, AudioCaptureService::class.java),
        serviceConnection,
        Context.BIND_AUTO_CREATE,
    )
    if (!bound) {
      bindingInProgress = false
      failPendingActions(CaptureException(
          code = "E_SERVICE_BIND",
          stage = "service",
          message = "Unable to bind the audio capture service",
      ))
    }
  }

  private fun withService(
      onReady: (AudioCaptureService) -> Unit,
      onFailure: (Throwable) -> Unit,
  ) {
    val connected = service
    if (connected != null) {
      onReady(connected)
      return
    }
    synchronized(pendingActions) {
      pendingActions.addLast(PendingServiceAction(onReady, onFailure))
    }
    ensureServiceBound()
  }

  private fun drainPendingActions(connected: AudioCaptureService) {
    val actions = synchronized(pendingActions) {
      buildList {
        while (pendingActions.isNotEmpty()) add(pendingActions.removeFirst())
      }
    }
    actions.forEach { action -> runCatching { action.onReady(connected) }.onFailure(action.onFailure) }
  }

  private fun failPendingActions(error: Throwable) {
    val actions = synchronized(pendingActions) {
      buildList {
        while (pendingActions.isNotEmpty()) add(pendingActions.removeFirst())
      }
    }
    actions.forEach { it.onFailure(error) }
  }

  private fun unbindService() {
    val connected = service
    if (connected != null) connected.removeListener(this)
    if (serviceBound || bindingInProgress) {
      runCatching { context.unbindService(serviceConnection) }
    }
    service = null
    serviceBound = false
    bindingInProgress = false
  }

  private fun shareFile(file: File, kind: String) {
    val uri: Uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    val mimeType = if (kind == "wav") "audio/wav" else "application/octet-stream"
    val sendIntent = Intent(Intent.ACTION_SEND).apply {
      type = mimeType
      putExtra(Intent.EXTRA_STREAM, uri)
      clipData = android.content.ClipData.newRawUri(file.name, uri)
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(Intent.createChooser(sendIntent, "Share ${file.name}").apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    })
  }

  private fun emit(eventName: String, payload: WritableMap) {
    if (!context.hasActiveReactInstance()) return
    context
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(eventName, payload)
  }

  private fun startInfoToMap(info: AudioCaptureService.StartInfo): WritableMap = Arguments.createMap().apply {
    putString("operationId", info.operationId)
    putString("sessionId", info.sessionId)
    putString("source", info.source.wireName)
    putString("startedAtUtc", info.startedAtUtc)
    val formats = Arguments.createMap()
    info.inputFormats.forEach { (source, format) -> formats.putMap(source.wireName, formatToMap(format)) }
    putMap("inputFormats", formats)
    putMap("outputFormat", formatToMap(PcmNormalizer.OUTPUT_FORMAT))
  }

  private fun snapshotToMap(snapshot: AudioCaptureService.ServiceSnapshot): WritableMap = Arguments.createMap().apply {
    putString("captureState", snapshot.captureState.wireName)
    putString("streamState", snapshot.streamState.wireName)
    snapshot.operationId?.let { putString("operationId", it) }
    snapshot.sessionId?.let { putString("sessionId", it) }
    snapshot.source?.let { putString("source", it.wireName) }
    snapshot.startedAtUtc?.let { putString("startedAtUtc", it) }
    putMap("levels", Arguments.createMap().apply {
      putDouble("mic", snapshot.micLevel.toDouble())
      putDouble("system", snapshot.systemLevel.toDouble())
    })
    snapshot.lastResult?.let { putMap("lastResult", captureResultToMap(it)) }
    putMap("streamStats", streamStatsToMap(snapshot.streamStats))
    putBoolean("pendingBackfill", snapshot.pendingBackfill)
  }

  private fun captureResultToMap(result: CaptureResult): WritableMap = Arguments.createMap().apply {
    putString("operationId", result.operationId)
    putString("sessionId", result.sessionId)
    putString("source", result.source.wireName)
    putString("startedAtUtc", result.startedAtUtc)
    putString("endedAtUtc", result.endedAtUtc)
    putString("stopReason", result.stopReason)
    val tracks: WritableArray = Arguments.createArray()
    result.tracks.forEach { tracks.pushMap(trackResultToMap(it)) }
    putArray("tracks", tracks)
  }

  private fun trackResultToMap(result: TrackFileResult): WritableMap = Arguments.createMap().apply {
    putString("source", result.source.wireName)
    putMap("inputFormat", formatToMap(result.inputFormat))
    putMap("outputFormat", formatToMap(result.outputFormat))
    putString("pcmPath", result.pcmFile.absolutePath)
    putString("wavPath", result.wavFile.absolutePath)
    putDouble("pcmBytes", result.pcmBytes.toDouble())
    putDouble("durationMs", result.durationMs.toDouble())
    putString("pcmSha256", result.pcmSha256)
    putString("wavSha256", result.wavSha256)
  }

  @ReactMethod
  fun storePreference(key: String, value: String, promise: Promise) {
    try {
      val prefs = reactApplicationContext.getSharedPreferences("ai_interview_prefs", Context.MODE_PRIVATE)
      prefs.edit().putString(key, value).apply()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_PREF", e.message, e)
    }
  }

  @ReactMethod
  fun getPreference(key: String, promise: Promise) {
    try {
      val prefs = reactApplicationContext.getSharedPreferences("ai_interview_prefs", Context.MODE_PRIVATE)
      val value = prefs.getString(key, null)
      promise.resolve(value)
    } catch (e: Exception) {
      promise.reject("E_PREF", e.message, e)
    }
  }

  @ReactMethod
  fun removePreference(key: String, promise: Promise) {
    try {
      val prefs = reactApplicationContext.getSharedPreferences("ai_interview_prefs", Context.MODE_PRIVATE)
      prefs.edit().remove(key).apply()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_PREF", e.message, e)
    }
  }

  @ReactMethod
  fun readFileBase64(fileUri: String, promise: Promise) {
    try {
      val path = fileUri.removePrefix("file://")
      val bytes = java.io.File(path).readBytes()
      promise.resolve(android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
    } catch (e: Exception) {
      promise.reject("E_READ", e.message, e)
    }
  }

  @ReactMethod
  fun saveFile(fileName: String, base64Data: String, promise: Promise) {
    try {
      val bytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT)
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
        val mime = when {
          fileName.endsWith(".pdf") -> "application/pdf"
          fileName.endsWith(".docx") -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          else -> "application/octet-stream"
        }
        val values = android.content.ContentValues().apply {
          put(android.provider.MediaStore.Downloads.DISPLAY_NAME, fileName)
          put(android.provider.MediaStore.Downloads.MIME_TYPE, mime)
        }
        val uri = reactApplicationContext.contentResolver.insert(
          android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values
        )
        uri?.let {
          reactApplicationContext.contentResolver.openOutputStream(it)?.use { out -> out.write(bytes) }
          promise.resolve(uri.toString())
        } ?: promise.reject("E_SAVE", "无法创建文件")
      } else {
        val downloadsDir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS)
        val dest = java.io.File(downloadsDir, fileName)
        dest.writeBytes(bytes)
        promise.resolve("file://${dest.absolutePath}")
      }
    } catch (e: Exception) {
      promise.reject("E_SAVE", e.message, e)
    }
  }

  private fun formatToMap(format: AudioFormatSpec): WritableMap = Arguments.createMap().apply {
    putInt("sampleRate", format.sampleRate)
    putInt("channelCount", format.channelCount)
    putInt("bitsPerSample", format.bitsPerSample)
  }

  private fun streamStatsToMap(stats: StreamStats): WritableMap = Arguments.createMap().apply {
    putDouble("queuedBytes", stats.queuedBytes.toDouble())
    putDouble("transportBytes", stats.transportBytes.toDouble())
    putDouble("acknowledgedBytes", stats.acknowledgedBytes.toDouble())
    putDouble("realtimeFrames", stats.realtimeFrames.toDouble())
    putDouble("droppedFrames", stats.droppedFrames.toDouble())
    putDouble("backfillBytes", stats.backfillBytes.toDouble())
  }

  private fun errorToMap(error: CaptureException): WritableMap = Arguments.createMap().apply {
    putString("code", error.code)
    putString("stage", error.stage)
    error.source?.let { putString("source", it.wireName) }
    putBoolean("recoverable", error.recoverable)
    putString("message", error.message)
  }

  private fun reject(promise: Promise, error: Throwable) {
    if (error is CaptureException) {
      promise.reject(error.code, error.message, error)
    } else {
      promise.reject("E_AUDIO_CAPTURE", error.message, error)
    }
  }

  companion object {
    const val NAME = "AudioCapture"
    const val EVENT_CAPTURE_STATE = "AudioCaptureState"
    const val EVENT_AUDIO_LEVELS = "AudioCaptureLevels"
    const val EVENT_STREAM_STATE = "AudioStreamState"
    const val EVENT_STREAM_STATS = "AudioStreamStats"
    const val EVENT_NATIVE_ERROR = "AudioCaptureError"
    const val EVENT_TRANSCRIPTION = "AudioTranscription"
    const val EVENT_LLM_START = "AudioLLMStart"
    const val EVENT_LLM_CHUNK = "AudioLLMChunk"
    const val EVENT_LLM_DONE = "AudioLLMDone"
    private const val PROJECTION_REQUEST_CODE = 9201
  }
}
