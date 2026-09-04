/**
 * StreamClient —— 主进程 WebSocket 音频流客户端
 *
 * 与移动端 AudioStreamClient 语义对齐：
 *   - connect() 在收到服务端 `ready` 后才 resolve（client_hello 握手完成）
 *   - 断线指数退避重连，最多 10 次，30s 上限
 *   - sendFrame 只在连接就绪时发送，未就绪直接丢弃实时帧（移动端同语义）
 *   - 服务端消息 → 事件：transcription / llmStart / llmChunk / llmDone / error / streamState
 */
import { EventEmitter } from 'events';
import WebSocket from 'ws';

export type StreamState = 'idle' | 'connecting' | 'ready' | 'degraded' | 'reconnecting' | 'dead' | 'closed';

const MAX_RETRY = 10;
const INITIAL_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;

export class StreamClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private url = '';
  private generation = 0;
  private retryCount = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private connectTimeoutTimer: NodeJS.Timeout | null = null;
  private pendingConnect: ((err: Error | null) => void) | null = null;

  /** 建立连接，握手（client_hello → ready）完成后 resolve */
  connect(url: string): Promise<void> {
    this.url = url;
    this.retryCount = 0;
    this.emit('streamState', 'connecting' as StreamState);
    return new Promise((resolve, reject) => {
      this.pendingConnect = (err) => {
        if (err) { reject(err); } else { resolve(); }
      };
      this._open();
    });
  }

  private _open(): void {
    if (this.ws) {
      try { this.ws.terminate(); } catch { /* ignore */ }
      this.ws = null;
    }

    this.generation += 1;
    const gen = this.generation;

    let ws: WebSocket;
    try {
      console.log(`[ws] 连接 ${this.url}`);
      ws = new WebSocket(this.url);
    } catch (e: any) {
      this._settle(new Error(`WebSocket 创建失败: ${e.message}`));
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    this.connectTimeoutTimer = setTimeout(() => {
      if (gen !== this.generation) return;
      console.log('[ws] 握手超时（10s 未收到 ready）');
      this._settle(new Error('WebSocket 握手超时（10s 未收到 ready）'));
      this.emit('streamState', 'degraded' as StreamState, '握手超时');
      ws.terminate();
      this.ws = null;
      this._scheduleReconnect();
    }, CONNECT_TIMEOUT_MS);

    ws.on('open', () => {
      if (gen !== this.generation) return;
      console.log('[ws] TCP+WS 已连接');
      // 首条消息必须是 client_hello（后端协议要求）
      ws.send(JSON.stringify({
        type: 'client_hello',
        protocol: 'audio.capture.v1',
        client: process.platform === 'darwin' ? 'pc-macos' : 'pc-windows',
      }));
    });

    ws.on('message', (data: WebSocket.RawData) => {
      if (gen !== this.generation) return;
      if (typeof data === 'string') {
        this._handle(data);
      } else {
        // 服务端二进制消息当前不处理（只发 JSON 控制消息）
      }
    });

    ws.on('error', (e: Error) => {
      if (gen !== this.generation) return;
      // error 后必跟 close，交给 close 处理重连；这里仅记录，便于诊断网络层问题
      console.log(`[ws] error: ${e?.message}`);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      if (gen !== this.generation) return;
      console.log(`[ws] close: code=${code} reason=${reason?.toString() || ''}`);
      if (this.connectTimeoutTimer) { clearTimeout(this.connectTimeoutTimer); this.connectTimeoutTimer = null; }
      this.ws = null;
      if (code === 1000) {
        // 用户主动断开，不重连
        this.emit('streamState', 'closed' as StreamState);
        this._settle(new Error('连接已关闭'));
        return;
      }
      this.emit('streamState', 'degraded' as StreamState);
      this._scheduleReconnect();
    });
  }

  /** 主动断开（停止会话时调用），阻止重连 */
  disconnect(): void {
    this.retryCount = MAX_RETRY; // 防止重连
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.connectTimeoutTimer) { clearTimeout(this.connectTimeoutTimer); this.connectTimeoutTimer = null; }
    this.generation += 1;
    this._settle(new Error('主动断开'));
    if (this.ws) {
      this.ws.close(1000, 'user_disconnect');
      this.ws = null;
    }
    this.emit('streamState', 'idle' as StreamState);
  }

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

    const delay = Math.min(INITIAL_DELAY_MS * Math.pow(2, this.retryCount), MAX_DELAY_MS);
    this.retryCount += 1;
    this.emit('streamState', 'reconnecting' as StreamState, {
      attempt: this.retryCount,
      maxRetry: MAX_RETRY,
      delayMs: delay,
    });

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this._open();
    }, delay);
  }

  /** 发送 JSON 控制消息（连接未就绪时静默丢弃） */
  sendControl(msg: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  /** 发送二进制实时帧（连接未就绪时丢弃 —— 移动端同语义） */
  sendFrame(frame: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(frame);
  }

  isReady(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  private _settle(err: Error | null): void {
    const cb = this.pendingConnect;
    this.pendingConnect = null;
    if (cb) { cb(err); }
  }

  private _handle(text: string): void {
    let msg: any;
    try { msg = JSON.parse(text); } catch { return; }

    switch (msg.type) {
      case 'ready':
        console.log('[ws] 收到 ready，握手完成');
        if (this.connectTimeoutTimer) { clearTimeout(this.connectTimeoutTimer); this.connectTimeoutTimer = null; }
        this._settle(null);
        this.emit('streamState', 'ready' as StreamState);
        break;
      case 'transcription':
        this.emit('transcription', msg);
        break;
      case 'llm_start':
        this.emit('llmStart', msg);
        break;
      case 'llm_chunk':
        this.emit('llmChunk', msg);
        break;
      case 'llm_done':
        this.emit('llmDone', msg);
        break;
      case 'error':
        this.emit('error', msg);
        break;
      // session_ready / track_ready / chunk_ack / config_ack：无需处理
      default:
        break;
    }
  }
}
