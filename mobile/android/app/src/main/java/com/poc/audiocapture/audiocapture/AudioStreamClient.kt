package com.poc.audiocapture.audiocapture

import java.io.BufferedInputStream
import java.io.FileInputStream
import java.net.URI
import java.util.ArrayDeque
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject

class AudioStreamClient {
  interface Listener {
    fun onStreamState(state: StreamState, message: String? = null)
    fun onStreamStats(stats: StreamStats)
    fun onTranscription(text: String, isFinal: Boolean, source: String)
    fun onLLMStart(questionText: String, mode: String, language: String, timestamp: Long)
    fun onLLMChunk(chunkIndex: Int, delta: String, timestamp: Long)
    fun onLLMDone(fullAnswer: String, mode: String, timestamp: Long, error: String?)
  }

  private data class OutboundPacket(val bytes: ByteArray, val droppable: Boolean)

  private val executor = Executors.newSingleThreadScheduledExecutor { runnable ->
    Thread(runnable, "audio-stream-client")
  }
  private val client = OkHttpClient.Builder()
      .pingInterval(20, TimeUnit.SECONDS)
      .retryOnConnectionFailure(true)
      .build()
  private val realtimeQueue = ArrayDeque<OutboundPacket>()

  @Volatile private var listener: Listener? = null
  private var socket: WebSocket? = null
  private var socketGeneration = 0L
  private var streamState = StreamState.IDLE
  private var stats = StreamStats()
  private val acknowledgedBytesByTrack = mutableMapOf<String, Long>()
  private var queuedBytes = 0L
  private var drainScheduled = false
  private var connectTimeout: ScheduledFuture<*>? = null
  private var pendingConnect: ((Result<Unit>) -> Unit)? = null

  fun setListener(listener: Listener?) {
    this.listener = listener
  }

  fun currentState(): StreamState = streamState

  fun currentStats(): StreamStats = stats.copy(queuedBytes = queuedBytes)

  fun connect(url: String, allowCleartext: Boolean, callback: (Result<Unit>) -> Unit) {
    val validationError = validateUrl(url, allowCleartext)
    if (validationError != null) {
      callback(Result.failure(validationError))
      return
    }

    executor.execute {
      closeSocketInternal("reconnect")
      socketGeneration += 1
      val generation = socketGeneration
      transition(StreamState.CONNECTING)
      pendingConnect = callback
      stats = StreamStats()
      acknowledgedBytesByTrack.clear()
      publishStats()

      val request = Request.Builder().url(url).build()
      socket = client.newWebSocket(request, object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
          executor.execute {
            if (generation != socketGeneration) return@execute
            webSocket.send(AudioWireProtocol.clientHello())
          }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
          executor.execute {
            if (generation != socketGeneration) return@execute
            handleTextMessage(text)
          }
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
          executor.execute {
            if (generation != socketGeneration) return@execute
            handleTextMessage(bytes.utf8())
          }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
          webSocket.close(code, reason)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          executor.execute {
            if (generation != socketGeneration) return@execute
            settleConnect(Result.failure(CaptureException(
                code = "E_WS_CLOSED",
                stage = "connect",
                message = "WebSocket closed before ready: $code",
            )))
            socket = null
            transition(StreamState.CLOSED, reason.ifBlank { null })
          }
        }

        override fun onFailure(webSocket: WebSocket, throwable: Throwable, response: Response?) {
          executor.execute {
            if (generation != socketGeneration) return@execute
            settleConnect(Result.failure(CaptureException(
                code = "E_WS_CONNECTION",
                stage = "connect",
                message = throwable.message ?: "WebSocket connection failed",
                cause = throwable,
            )))
            socket = null
            transition(StreamState.ERROR, throwable.message)
          }
        }
      })

      connectTimeout = executor.schedule({
        if (generation != socketGeneration || streamState == StreamState.READY) return@schedule
        settleConnect(Result.failure(CaptureException(
            code = "E_WS_TIMEOUT",
            stage = "connect",
            message = "WebSocket did not become ready within 10 seconds",
        )))
        transition(StreamState.ERROR, "Connection timed out")
        socket?.cancel()
        socket = null
      }, CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
    }
  }

  fun disconnect() {
    executor.execute {
      socketGeneration += 1
      closeSocketInternal("user_disconnect")
      realtimeQueue.clear()
      queuedBytes = 0
      publishStats()
      transition(StreamState.IDLE)
    }
  }

  fun startSession(sessionId: String, source: CaptureSource, tracks: Collection<TrackSource>) {
    executor.execute {
      sendControl(AudioWireProtocol.sessionStart(sessionId, source, tracks))
      tracks.forEach { sendControl(AudioWireProtocol.trackStart(sessionId, it)) }
    }
  }

  fun enqueueRealtime(
      sessionId: UUID,
      source: TrackSource,
      sequence: Long,
      captureOffsetUs: Long,
      payload: ByteArray,
      isFinal: Boolean,
  ) {
    val packet = AudioWireProtocol.encode(
        kind = AudioWireProtocol.PacketKind.REALTIME,
        source = source,
        flags = if (isFinal) AudioWireProtocol.FLAG_FINAL else 0,
        sessionId = sessionId,
        sequence = sequence,
        captureOffsetUs = captureOffsetUs,
        payload = payload,
    )

    executor.execute {
      if (streamState != StreamState.READY && streamState != StreamState.DEGRADED) return@execute
      while (queuedBytes + packet.size > MAX_REALTIME_QUEUE_BYTES && realtimeQueue.isNotEmpty()) {
        val dropped = realtimeQueue.removeFirst()
        queuedBytes -= dropped.bytes.size
        stats = stats.copy(droppedFrames = stats.droppedFrames + 1)
      }
      if (queuedBytes + packet.size > MAX_REALTIME_QUEUE_BYTES) {
        stats = stats.copy(droppedFrames = stats.droppedFrames + 1)
        transition(StreamState.DEGRADED, "Realtime queue is saturated")
        publishStats()
        return@execute
      }
      realtimeQueue.addLast(OutboundPacket(packet, droppable = true))
      queuedBytes += packet.size
      stats = stats.copy(realtimeFrames = stats.realtimeFrames + 1)
      publishStats()
      drainRealtimeQueue()
    }
  }

  fun finishRealtime(sessionId: String, source: TrackSource, lastSequence: Long) {
    executor.execute { sendControl(AudioWireProtocol.trackEnd(sessionId, source, lastSequence)) }
  }

  fun finishSession(sessionId: String, reason: String) {
    executor.execute { sendControl(AudioWireProtocol.sessionStopped(sessionId, reason)) }
  }

  fun backfill(sessionId: UUID, result: TrackFileResult, callback: (Result<Unit>) -> Unit) {
    executor.execute {
      val activeSocket = socket
      if (streamState != StreamState.READY || activeSocket == null) {
        callback(Result.failure(CaptureException(
            code = "E_BACKFILL_OFFLINE",
            stage = "backfill",
            source = result.source,
            message = "WebSocket is not ready for file backfill",
        )))
        return@execute
      }

      transition(StreamState.BACKFILLING)
      sendControl(AudioWireProtocol.fileStart(sessionId.toString(), result))
      var sequence = 0L
      var offsetBytes = 0L

      try {
        BufferedInputStream(FileInputStream(result.pcmFile)).use { input ->
          val buffer = ByteArray(BACKFILL_CHUNK_BYTES)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            waitForSocketCapacity(activeSocket)
            val payload = if (read == buffer.size) buffer.copyOf() else buffer.copyOf(read)
            val packet = AudioWireProtocol.encode(
                kind = AudioWireProtocol.PacketKind.BACKFILL,
                source = result.source,
                flags = if (offsetBytes + read >= result.pcmBytes) AudioWireProtocol.FLAG_FINAL else 0,
                sessionId = sessionId,
                sequence = sequence,
                captureOffsetUs = offsetBytes * 1_000_000L / result.outputFormat.bytesPerSecond,
                payload = payload,
            )
            check(activeSocket.send(packet.toByteString())) { "WebSocket rejected backfill packet" }
            sequence += 1
            offsetBytes += read
            stats = stats.copy(
                transportBytes = stats.transportBytes + packet.size,
                backfillBytes = offsetBytes,
            )
            publishStats()
          }
        }
        sendControl(AudioWireProtocol.fileEnd(sessionId.toString(), result, sequence - 1))
        transition(StreamState.READY)
        callback(Result.success(Unit))
      } catch (error: Throwable) {
        transition(StreamState.DEGRADED, error.message)
        callback(Result.failure(CaptureException(
            code = "E_BACKFILL_FAILED",
            stage = "backfill",
            source = result.source,
            message = error.message ?: "Backfill failed",
            cause = error,
        )))
      }
    }
  }

  fun completeSession(sessionId: String) {
    executor.execute { sendControl(AudioWireProtocol.sessionComplete(sessionId)) }
  }

  fun sendTextMessage(json: JSONObject) {
    executor.execute {
      val text = json.toString()
      android.util.Log.d("AudioStreamClient", "发送文本消息: ${text.take(120)}")
      socket?.send(text)
    }
  }

  fun shutdown() {
    executor.execute {
      socketGeneration += 1
      closeSocketInternal("shutdown")
      realtimeQueue.clear()
      queuedBytes = 0
      client.dispatcher.executorService.shutdown()
      client.connectionPool.evictAll()
      executor.shutdown()
    }
  }

  private fun handleTextMessage(text: String) {
    val message = runCatching { JSONObject(text) }.getOrNull() ?: return
    val msgType = message.optString("type")
    android.util.Log.d("AudioStreamClient", "收到消息 type=$msgType text=${text.take(100)}")
    when (msgType) {
      "ready" -> {
        connectTimeout?.cancel(false)
        transition(StreamState.READY)
        settleConnect(Result.success(Unit))
        drainRealtimeQueue()
      }
      "chunk_ack" -> {
        val source = message.optString("source", "unknown")
        val kind = message.optString("kind", "unknown")
        acknowledgedBytesByTrack["$source:$kind"] = message.optLong("bytes_received", 0L)
        stats = stats.copy(acknowledgedBytes = acknowledgedBytesByTrack.values.sum())
        publishStats()
        val socketQueueSize = socket?.queueSize() ?: Long.MAX_VALUE
        if (streamState == StreamState.DEGRADED && socketQueueSize < LOW_WATER_BYTES) {
          transition(StreamState.READY)
        }
      }
      "error" -> transition(StreamState.DEGRADED, message.optString("message", "Server rejected audio data"))
      "transcription" -> {
        val t = message.optString("text", "")
        val isFinal = message.optBoolean("is_final", false)
        val src = message.optString("source", "mic")
        android.util.Log.d("AudioStreamClient", "转录: text=$t isFinal=$isFinal source=$src")
        if (t.isNotEmpty()) {
          listener?.onTranscription(t, isFinal, src)
        }
      }
      "llm_start" -> {
        val questionText = message.optString("question_text", "")
        val mode = message.optString("mode", "normal")
        val language = message.optString("language", "zh")
        val timestamp = message.optLong("timestamp", 0L)
        android.util.Log.d("AudioStreamClient", "LLM start: mode=$mode lang=$language qText=${questionText.take(60)}")
        listener?.onLLMStart(questionText, mode, language, timestamp)
      }
      "llm_chunk" -> {
        val chunkIndex = message.optInt("chunk_index", 0)
        val delta = message.optString("delta", "")
        val timestamp = message.optLong("timestamp", 0L)
        android.util.Log.d("AudioStreamClient", "LLM chunk: idx=$chunkIndex delta=${delta.take(40)}")
        listener?.onLLMChunk(chunkIndex, delta, timestamp)
      }
      "llm_done" -> {
        val fullAnswer = message.optString("full_answer", "")
        val mode = message.optString("mode", "normal")
        val timestamp = message.optLong("timestamp", 0L)
        val error = if (message.has("error")) message.optString("error") else null
        android.util.Log.d("AudioStreamClient", "LLM done: mode=$mode len=${fullAnswer.length} error=$error")
        listener?.onLLMDone(fullAnswer, mode, timestamp, error)
      }
      else -> android.util.Log.w("AudioStreamClient", "未处理的消息类型: $msgType")
    }
  }

  private fun drainRealtimeQueue() {
    if (drainScheduled) return
    drainScheduled = true
    executor.execute {
      drainScheduled = false
      val activeSocket = socket ?: return@execute
      if (streamState != StreamState.READY && streamState != StreamState.DEGRADED) return@execute

      while (realtimeQueue.isNotEmpty() && activeSocket.queueSize() < HIGH_WATER_BYTES) {
        val packet = realtimeQueue.removeFirst()
        queuedBytes -= packet.bytes.size
        if (!activeSocket.send(packet.bytes.toByteString())) {
          stats = stats.copy(droppedFrames = stats.droppedFrames + 1)
          transition(StreamState.DEGRADED, "WebSocket rejected realtime packet")
          break
        }
        stats = stats.copy(transportBytes = stats.transportBytes + packet.bytes.size)
      }
      publishStats()

      if (realtimeQueue.isNotEmpty()) {
        executor.schedule({ drainRealtimeQueue() }, DRAIN_RETRY_MS, TimeUnit.MILLISECONDS)
      } else if (streamState == StreamState.DEGRADED && activeSocket.queueSize() < LOW_WATER_BYTES) {
        transition(StreamState.READY)
      }
    }
  }

  private fun waitForSocketCapacity(activeSocket: WebSocket) {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(BACKFILL_QUEUE_TIMEOUT_SECONDS)
    while (activeSocket.queueSize() >= HIGH_WATER_BYTES) {
      if (System.nanoTime() >= deadline) {
        throw CaptureException(
            code = "E_BACKFILL_TIMEOUT",
            stage = "backfill",
            message = "Timed out waiting for WebSocket capacity",
        )
      }
      Thread.sleep(25)
    }
  }

  fun sendControl(message: String): Boolean {
    val activeSocket = socket ?: return false
    return activeSocket.send(message)
  }

  private fun settleConnect(result: Result<Unit>) {
    connectTimeout?.cancel(false)
    connectTimeout = null
    val callback = pendingConnect ?: return
    pendingConnect = null
    callback(result)
  }

  private fun closeSocketInternal(reason: String) {
    settleConnect(Result.failure(CaptureException(
        code = "E_WS_REPLACED",
        stage = "connect",
        message = "WebSocket request replaced: $reason",
    )))
    socket?.close(1000, reason)
    socket = null
  }

  private fun transition(state: StreamState, message: String? = null) {
    streamState = state
    listener?.onStreamState(state, message)
  }

  private fun publishStats() {
    listener?.onStreamStats(stats.copy(queuedBytes = queuedBytes))
  }

  private fun validateUrl(url: String, allowCleartext: Boolean): CaptureException? {
    val scheme = runCatching { URI(url).scheme?.lowercase() }.getOrNull()
    if (scheme != "ws" && scheme != "wss") {
      return CaptureException(
          code = "E_WS_URL",
          stage = "connect",
          message = "WebSocket URL must use ws:// or wss://",
      )
    }
    if (!allowCleartext && scheme != "wss") {
      return CaptureException(
          code = "E_WS_CLEARTEXT",
          stage = "connect",
          message = "Release builds require wss://",
      )
    }
    return null
  }

  companion object {
    private const val CONNECT_TIMEOUT_SECONDS = 10L
    private const val BACKFILL_QUEUE_TIMEOUT_SECONDS = 10L
    private const val BACKFILL_CHUNK_BYTES = 64 * 1024
    private const val MAX_REALTIME_QUEUE_BYTES = 512L * 1024L
    private const val HIGH_WATER_BYTES = 512L * 1024L
    private const val LOW_WATER_BYTES = 128L * 1024L
    private const val DRAIN_RETRY_MS = 50L
  }
}
