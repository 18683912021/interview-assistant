/**
 * AudioCaptureManager —— 主进程统一推流层
 *
 * 采集（WASAPI system + renderer mic）与 WebSocket 推流都在主进程，
 * 对齐移动端 "native 层统一采集+推流、JS 只消费事件" 的架构。
 *
 * 数据流：
 *   system：WASAPI addon（任意格式）→ int16 归一 → 16kHz mono → 1280B 帧 → WS
 *   mic：   renderer getUserMedia → AudioContext 16kHz mono float → IPC → int16 → 1280B 帧 → WS
 * 事件：   streamState / transcription / llmStart / llmChunk / llmDone / levels / error
 */
import { EventEmitter } from 'events';
import { normalizePcm, floatToPcm16 } from './pcm-normalizer.js';
import { PcmFrameAccumulator } from './frame-accumulator.js';
import { encodeRealtimeFrame, SourceKind } from './wire-protocol.js';
import { StreamClient, type StreamState } from './stream-client.js';

export type CaptureState = 'idle' | 'preparing' | 'capturing' | 'completed';
export type CaptureSource = 'mic' | 'system' | 'both';
export type TrackName = 'mic' | 'system';

export interface AudioLevels {
  mic: number;
  system: number;
}

interface TrackState {
  accum: PcmFrameAccumulator;
  seq: number;
  offsetBytes: number;   // 归一化后累计字节数（用于 captureOffsetUs）
  rmsSum: number;        // 平方和累加（500ms 窗口）
  rmsCount: number;
}

const OUTPUT_BYTES_PER_SEC = 16000 * 2; // 16kHz mono PCM16

export class AudioCaptureManager extends EventEmitter {
  private state: CaptureState = 'idle';
  private startedAtUtc: string | null = null;
  private sessionId: string | null = null;
  private source: CaptureSource = 'both';
  private stream = new StreamClient();
  private wasapi: any = null;
  private tracks = new Map<TrackName, TrackState>();
  private levelsTimer: NodeJS.Timeout | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private lastLevels: AudioLevels = { mic: 0, system: 0 };

  constructor() {
    super();
    // StreamClient 事件 → 自身事件（ipc-handlers 只监听 manager 事件）
    this.stream.on('streamState', (s: StreamState, message?: string) => {
      this.emit('streamState', { state: s, message });
    });
    this.stream.on('transcription', (m: any) => {
      this.emit('transcription', { text: m.text, is_final: m.is_final, source: m.source });
    });
    this.stream.on('llmStart', (m: any) => this.emit('llmStart', m));
    this.stream.on('llmChunk', (m: any) => this.emit('llmChunk', m));
    this.stream.on('llmDone', (m: any) => this.emit('llmDone', m));
    this.stream.on('error', (m: any) => this.emit('error', m));
  }

  getState(): CaptureState { return this.state; }
  getStreamState(): StreamState { return this.stream.isReady() ? 'ready' : this.state === 'capturing' ? 'reconnecting' : 'idle'; }

  /**
   * 开始采集 + 推流
   * 顺序（对齐移动端）：connectStream(等 ready) → session_start → 每轨 track_start → 启动采集
   */
  async start(source: CaptureSource, sessionId: string, streamUrl: string): Promise<{ startedAtUtc: string }> {
    // 状态守卫：stop 未完成/重入 start 时拒绝，避免重复建连接与重复启动 WASAPI
    if (this.state === 'capturing' || this.state === 'preparing') {
      throw new Error('采集已在进行中（E_STATE）');
    }
    this.source = source;
    this.sessionId = sessionId;
    this.startedAtUtc = new Date().toISOString();
    this.state = 'capturing';
    this.emit('captureState', { state: 'capturing', startedAtUtc: this.startedAtUtc });

    const needs = {
      mic: source === 'mic' || source === 'both',
      system: source === 'system' || source === 'both',
    };

    // ── 1. 连接 WS（client_hello → ready 握手完成后才继续） ──
    try {
      await this.stream.connect(streamUrl);
    } catch (e: any) {
      // 用户主动停止（stop() → disconnect() 结掉 pending 连接）：不是错误，
      // 状态已由 stop() 管理，原样上抛让渲染进程静默处理
      if (e?.message === '主动断开') throw e;
      this.state = 'idle';
      const err = { code: 'E_STREAM_CONNECT', stage: 'connect', message: e?.message || '音频流连接失败', recoverable: true };
      this.emit('error', err);
      this.emit('captureState', { state: 'idle' });
      throw new Error(err.message);
    }

    // ── 2. 发起会话（会话就绪后补发，避免握手竞态） ──
    this.stream.sendControl({ type: 'session_start', session_id: sessionId, source_mode: source });
    for (const s of ['mic', 'system'] as TrackName[]) {
      if (!needs[s]) continue;
      this.stream.sendControl({
        type: 'track_start',
        session_id: sessionId,
        source: s,
        format: { sample_rate: 16000, bit_depth: 16, channels: 1, encoding: 'pcm_s16le', chunk_duration_ms: 40 },
      });
      const accum = new PcmFrameAccumulator();
      accum.onFrame((frame) => this.sendFrame(s, frame, false));
      this.tracks.set(s, { accum, seq: 0, offsetBytes: 0, rmsSum: 0, rmsCount: 0 });
    }

    // ── 3. system 轨 ──
    // Windows：WASAPI Loopback addon（主进程采集）
    // macOS：渲染进程 getDisplayMedia（SCK 系统选择器）采集后经 audio:system-frame 送入
    if (needs.system && process.platform === 'win32') {
      try {
        const { WasapiLoopback } = require('./native/build/Release/wasapi_loopback.node');
        this.wasapi = new WasapiLoopback();
        const rate = this.wasapi.sampleRate || 48000;
        const channels = this.wasapi.channels || 2;
        const isFloat = !!this.wasapi.isFloat;
        const bits = this.wasapi.bitsPerSample || 16;

        this.wasapi.start((err: Error | null, buf: Buffer) => {
          if (err) {
            this.emit('error', { code: 'E_WASAPI', stage: 'capture', source: 'system', message: err.message, recoverable: false });
            return;
          }
          try {
            const pcm16 = this.toInt16(Buffer.from(buf), isFloat, bits);
            const norm = normalizePcm(pcm16, rate, channels);
            this.pushNorm('system', norm);
          } catch (e: any) {
            this.emit('error', { code: 'E_PCM', stage: 'capture', source: 'system', message: e.message, recoverable: true });
          }
        });
      } catch (e: any) {
        // 不再静默降级：system 轨失败必须让用户看到
        this.emit('error', {
          code: 'E_WASAPI_ADDON', stage: 'capture', source: 'system',
          message: `系统音频采集不可用：${e?.message || e}（需 node-gyp 编译 addon）`, recoverable: true,
        });
      }
    }

    // ── 4. levels 定时上报（500ms，对齐移动端 engine） ──
    this.levelsTimer = setInterval(() => this.reportLevels(), 500);

    // 无信号检测：8s 后仍一帧未发出（系统无播放流 / 麦克风未授权 / 设备不可用），
    // 上屏明确提示，避免 UI 显示"连接中"却全程无声、无从排查
    this.silenceTimer = setTimeout(() => {
      if (this.state !== 'capturing') return;
      const frames = [...this.tracks.values()].reduce((n, t) => n + t.seq, 0);
      if (frames === 0) {
        this.emit('error', {
          code: 'E_NO_SIGNAL',
          stage: 'capture',
          message: this.tracks.has('system') && !this.tracks.has('mic')
            ? '未检测到系统音频信号（8 秒）。请确认电脑正在播放声音、默认输出设备已启用'
            : '未检测到音频信号（8 秒）。请确认麦克风已授权且系统正在播放声音',
          recoverable: true,
        });
      }
    }, 8000);

    return { startedAtUtc: this.startedAtUtc };
  }

  /** renderer 麦克风帧（16kHz mono int16，经 IPC 送入），对齐移动端 native 帧语义 */
  pushMicFrame(buffer: Buffer): void {
    if (this.state !== 'capturing') return;
    if (!this.tracks.has('mic')) return;
    // 已是 16kHz mono int16：sourceStep = 1，无插值开销
    this.pushNorm('mic', normalizePcm(buffer, 16000, 1));
  }

  /** renderer 系统音频帧（macOS getDisplayMedia 16kHz mono int16，经 IPC 送入） */
  pushSystemFrame(buffer: Buffer): void {
    if (this.state !== 'capturing') return;
    if (!this.tracks.has('system')) return;
    this.pushNorm('system', normalizePcm(buffer, 16000, 1));
  }

  /** 发送 JSON 控制消息（llm_query / config 等） */
  sendControl(msg: object): void {
    this.stream.sendControl(msg);
  }

  /** 停止采集 + 收尾会话（对齐移动端：flush isFinal → track_end → session_stopped → 断连） */
  async stop(reason = 'user_stop'): Promise<void> {
    // 1. 停采集源
    if (this.wasapi) {
      try { this.wasapi.stop(); } catch { /* ignore */ }
      this.wasapi = null;
    }

    // 2. flush 尾帧（isFinal=1，携带剩余不足一帧的数据）
    for (const s of ['mic', 'system'] as TrackName[]) {
      const t = this.tracks.get(s);
      if (t) {
        const rest = t.accum.flush();
        if (rest.length > 0) this.sendFrame(s, rest, true);
      }
    }

    // 3. 会话收尾
    if (this.sessionId) {
      for (const s of ['mic', 'system'] as TrackName[]) {
        const t = this.tracks.get(s);
        if (t) {
          this.stream.sendControl({ type: 'track_end', session_id: this.sessionId, source: s, last_sequence: t.seq - 1 });
        }
      }
      this.stream.sendControl({ type: 'session_stopped', session_id: this.sessionId, stop_reason: reason });
    }

    // 4. 断连 + 清理
    this.stream.disconnect();
    this.tracks.clear();
    if (this.levelsTimer) { clearInterval(this.levelsTimer); this.levelsTimer = null; }
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }
    this.lastLevels = { mic: 0, system: 0 };
    this.sessionId = null;
    this.state = 'completed';
    this.emit('captureState', { state: 'completed' });
  }

  getSnapshot() {
    return {
      captureState: this.state,
      streamState: this.getStreamState(),
      sessionId: this.sessionId,
      source: this.source,
      startedAtUtc: this.startedAtUtc,
      levels: this.lastLevels,
    };
  }

  // ── 内部：归一化 + 帧发送 ──

  /** 任意 WASAPI 格式 → int16 PCM */
  private toInt16(input: Buffer, isFloat: boolean, bitsPerSample: number): Buffer {
    if (isFloat) {
      const n = Math.floor(input.length / 4);
      return floatToPcm16(new Float32Array(input.buffer, input.byteOffset, n));
    }
    if (bitsPerSample === 16) return input;
    const bytesPerSample = Math.max(1, Math.floor(bitsPerSample / 8));
    const samples = Math.floor(input.length / bytesPerSample);
    const out = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
      const v = input.readIntLE(i * bytesPerSample, bytesPerSample) >> (bitsPerSample - 16);
      out.writeInt16LE(Math.max(-32768, Math.min(32767, v)), i * 2);
    }
    return out;
  }

  /** 归一化后数据入 accumulator + RMS 累积 */
  private pushNorm(source: TrackName, norm: Buffer): void {
    const t = this.tracks.get(source);
    if (!t || norm.length === 0) return;
    for (let i = 0; i < norm.length; i += 2) {
      const s = norm.readInt16LE(i);
      t.rmsSum += s * s;
      t.rmsCount += 1;
    }
    t.accum.push(norm);
  }

  private sendFrame(source: TrackName, frame: Buffer, isFinal: boolean): void {
    const t = this.tracks.get(source);
    if (!t || !this.sessionId) return;
    const seq = t.seq;
    t.seq += 1;
    const offsetUs = Math.round((t.offsetBytes * 1_000_000) / OUTPUT_BYTES_PER_SEC);
    t.offsetBytes += frame.length;

    const sourceKind = source === 'mic' ? SourceKind.MIC : SourceKind.SYSTEM;
    const buf = Buffer.from(encodeRealtimeFrame(this.sessionId, sourceKind, seq, offsetUs, frame, isFinal));
    this.stream.sendFrame(buf);
  }

  /** 每 500ms：计算两轨 RMS → levels 事件 */
  private reportLevels(): void {
    const out: AudioLevels = { mic: 0, system: 0 };
    for (const s of ['mic', 'system'] as TrackName[]) {
      const t = this.tracks.get(s);
      if (t && t.rmsCount > 0) {
        out[s] = Math.min(1, Math.sqrt(t.rmsSum / t.rmsCount) / 32768);
        t.rmsSum = 0;
        t.rmsCount = 0;
      }
    }
    this.lastLevels = out;
    this.emit('levels', out);
  }
}

export const audioCapture = new AudioCaptureManager();
