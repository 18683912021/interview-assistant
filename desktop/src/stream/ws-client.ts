/**
 * AudioStreamClient —— WebSocket 音频流客户端
 *
 * 使用浏览器原生 WebSocket，和 Android 端 AudioStreamClient 协议等价。
 * 替代 RN 的 OkHttp WebSocket + AudioWireProtocol。
 *
 * 重连机制：指数退避，最多 10 次，30s 上限。
 */
import { EventEmitter } from 'eventemitter3';

// ── Types ──
export type StreamState = 'idle' | 'connecting' | 'ready' | 'degraded' | 'reconnecting' | 'dead' | 'closed';

export interface ClientHello {
  type: 'client_hello';
  protocol: 'audio.capture.v1';
  client: 'pc-windows' | 'pc-macos' | 'web';
}

export interface TranscriptionEvent {
  type: 'transcription';
  source: 'mic' | 'system';
  text: string;
  is_final: boolean;
}

export interface LLMStartEvent {
  type: 'llm_start';
  question_text: string;
  language: string;
}

export interface LLMChunkEvent {
  type: 'llm_chunk';
  delta: string;
  chunk_index: number;
}

export interface LLMDoneEvent {
  type: 'llm_done';
  full_answer: string;
  error?: string;
}

// ── Config ──
const MAX_RETRY = 10;
const INITIAL_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;

// ── Client ──
export class AudioStreamClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private clientType: 'pc-windows' | 'pc-macos' | 'web';
  private sessionId: string | null = null;
  private generation = 0;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private activeTracks = new Set<'mic' | 'system'>();

  constructor(url: string) {
    super();
    this.url = url;

    // 检测客户端类型
    const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;
    if (!isElectron) {
      this.clientType = 'web';
    } else {
      // simple platform detection — 后续可细化
      const ua = navigator.userAgent;
      this.clientType = ua.includes('Mac') ? 'pc-macos' : 'pc-windows';
    }
  }

  // ── Connect ──
  async connect(): Promise<void> {
    this.retryCount = 0;
    return this._connect();
  }

  private async _connect(): Promise<void> {
    this.generation += 1;
    const gen = this.generation;

    this.emit('streamState', 'connecting' as StreamState);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (gen !== this.generation) return;
        this.ws?.close();
        reject(new Error('WebSocket connect timeout'));
      }, CONNECT_TIMEOUT_MS);

      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        clearTimeout(timeout);
        if (gen !== this.generation) return;
        this.retryCount = 0;

        // 发送 client_hello
        const hello: ClientHello = {
          type: 'client_hello',
          protocol: 'audio.capture.v1',
          client: this.clientType,
        };
        this.ws!.send(JSON.stringify(hello));

        // 重连后恢复会话
        this._resyncAfterReconnect();
        resolve();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        if (gen !== this.generation) return;
        if (typeof event.data === 'string') {
          this._handle(JSON.parse(event.data));
        }
        // 二进制消息当前不需要处理（服务端只发 JSON 控制消息）
      };

      this.ws.onclose = (e: CloseEvent) => {
        clearTimeout(timeout);
        if (gen !== this.generation) return;
        if (e.code === 1000) {
          this.emit('streamState', 'closed' as StreamState);
          return;
        }
        this.emit('streamState', 'degraded' as StreamState);
        this._scheduleReconnect();
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
        if (gen !== this.generation) return;
        reject(new Error('WebSocket connection failed'));
      };
    });
  }

  // ── Reconnect ──
  private _scheduleReconnect(): void {
    if (this.retryCount >= MAX_RETRY) {
      this.emit('streamState', 'dead' as StreamState);
      this.emit('error', {
        code: 'E_WS_MAX_RETRY',
        stage: 'stream',
        message: `WebSocket 重连失败，已达最大重试次数 (${MAX_RETRY})`,
        recoverable: false,
      });
      return;
    }

    const delay = Math.min(
      INITIAL_DELAY_MS * Math.pow(2, this.retryCount),
      MAX_DELAY_MS,
    );
    this.retryCount += 1;

    this.emit('streamState', 'reconnecting' as StreamState, {
      attempt: this.retryCount,
      maxRetry: MAX_RETRY,
      delayMs: delay,
    });

    this.retryTimer = setTimeout(() => {
      this._connect().catch(() => {
        // _scheduleReconnect 在 onclose 中触发
      });
    }, delay);
  }

  // ── Session resync ──
  private _resyncAfterReconnect(): void {
    if (!this.sessionId || this.activeTracks.size === 0) return;

    this._send({
      type: 'session_start',
      session_id: this.sessionId,
      source_mode: this.activeTracks.size > 1 ? 'both' : this.activeTracks.has('mic') ? 'mic' : 'system',
    });

    for (const source of this.activeTracks) {
      this._send({
        type: 'track_start',
        session_id: this.sessionId,
        source,
        format: {
          sample_rate: 16000,
          bit_depth: 16,
          channels: 1,
          encoding: 'pcm_s16le',
          chunk_duration_ms: 40,
        },
      });
    }
  }

  // ── Incoming message handler ──
  private _handle(msg: any): void {
    switch (msg.type) {
      case 'ready':
        this.sessionId = msg.session_id;
        this.emit('streamState', 'ready' as StreamState);
        break;
      case 'session_ready':
        break;
      case 'transcription':
        this.emit('transcription', msg as TranscriptionEvent);
        break;
      case 'llm_start':
        this.emit('llmStart', msg as LLMStartEvent);
        break;
      case 'llm_chunk':
        this.emit('llmChunk', msg as LLMChunkEvent);
        break;
      case 'llm_done':
        this.emit('llmDone', msg as LLMDoneEvent);
        break;
      case 'chunk_ack':
        break;
      case 'error':
        this.emit('error', msg);
        break;
    }
  }

  // ── Send PCM ──
  sendPcm(frame: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(frame);
  }

  // ── Send control ──
  private _send(msg: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  sendControl(msg: object): void {
    this._send(msg);
  }

  // ── Track management ──
  startSession(sessionId: string, sourceMode: 'mic' | 'system' | 'both'): void {
    this.sessionId = sessionId;

    if (sourceMode === 'mic' || sourceMode === 'both') {
      this.activeTracks.add('mic');
    }
    if (sourceMode === 'system' || sourceMode === 'both') {
      this.activeTracks.add('system');
    }

    this._send({
      type: 'session_start',
      session_id: sessionId,
      source_mode: sourceMode,
    });

    for (const source of this.activeTracks) {
      this._send({
        type: 'track_start',
        session_id: sessionId,
        source,
        format: {
          sample_rate: 16000,
          bit_depth: 16,
          channels: 1,
          encoding: 'pcm_s16le',
          chunk_duration_ms: 40,
        },
      });
    }
  }

  // ── Disconnect ──
  disconnect(): void {
    this.retryCount = MAX_RETRY; // 防止重连
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close(1000);
    this.ws = null;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// ── 全局单例 ──
let _instance: AudioStreamClient | null = null;

export const wsClient = {
  getInstance: (): AudioStreamClient | null => _instance,
  createInstance: (url: string): AudioStreamClient => {
    _instance = new AudioStreamClient(url);
    return _instance;
  },
};
