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
import { createWindowsLoopback, type WasapiCapture } from './windows-loopback.js';
import { StreamingPcmNormalizer } from './windows-pcm.js';

export type CaptureState = 'idle' | 'preparing' | 'capturing' | 'completed';
export type CaptureSource = 'mic' | 'system' | 'both';
export type TrackName = 'mic' | 'system';

export interface AudioLevels {
  mic: number;
  system: number;
}

export interface CurrentAnswer {
  request_id: string;
  question_text: string;
  text: string;
  chunk_index: number;
  status: 'loading' | 'streaming' | 'done' | 'error' | 'cancelled' | 'truncated';
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
  private captureGeneration = 0;
  private stopTask: Promise<void> | null = null;
  private startedAtUtc: string | null = null;
  private sessionId: string | null = null;
  private source: CaptureSource = 'both';
  private stream = new StreamClient();
  private wasapi: WasapiCapture | null = null;
  private windowsPcm: StreamingPcmNormalizer | null = null;
  private tracks = new Map<TrackName, TrackState>();
  private levelsTimer: NodeJS.Timeout | null = null;
  private silenceTimer: NodeJS.Timeout | null = null;
  private lastLevels: AudioLevels = { mic: 0, system: 0 };
  private currentAnswer: CurrentAnswer | null = null;

  constructor() {
    super();
    // StreamClient 事件 → 自身事件（ipc-handlers 只监听 manager 事件）
    this.stream.on('streamState', (s: StreamState, message?: string) => {
      if (s === 'ready' && this.state === 'capturing' && this.tracks.size) this.announceSession();
      this.emit('streamState', { state: s, message });
    });
    this.stream.on('transcription', (m: any) => {
      this.emit('transcription', m);
    });
    this.stream.on('llmStart', (m: { request_id?: string; question_text?: string }) => {
      if (typeof m.request_id === 'string' && this.currentAnswer?.request_id !== m.request_id) {
        this.currentAnswer = { request_id: m.request_id,
          question_text: typeof m.question_text === 'string' ? m.question_text : '', text: '', chunk_index: -1, status: 'loading' };
      }
      this.emit('llmStart', m);
    });
    this.stream.on('llmChunk', (m: { request_id?: string; delta?: string; chunk_index?: number }) => {
      const answer = this.currentAnswer;
      if (answer && answer.request_id === m.request_id && typeof m.delta === 'string' &&
          (answer.status === 'loading' || answer.status === 'streaming')) {
        const index = Number.isInteger(m.chunk_index) ? m.chunk_index! : answer.chunk_index + 1;
        if (index > answer.chunk_index) {
          answer.text += m.delta;
          answer.chunk_index = index;
          if (m.delta) answer.status = 'streaming';
        }
      }
      this.emit('llmChunk', m);
    });
    this.stream.on('llmDone', (m: { request_id?: string; full_answer?: string; status?: string; error?: string }) => {
      const answer = this.currentAnswer;
      if (answer && answer.request_id === m.request_id) {
        if (typeof m.full_answer === 'string') answer.text = m.full_answer;
        answer.status = m.status === 'cancelled' ? 'cancelled'
          : m.status === 'truncated' ? 'truncated'
          : m.status === 'failed' || m.error ? 'error' : 'done';
      }
      this.emit('llmDone', m);
    });
    this.stream.on('error', (m: any) => this.emit('error', m));
  }

  getState(): CaptureState { return this.state; }
  clearAnswer(): void { this.currentAnswer = null; }
  getStreamState(): StreamState { return this.stream.isReady() ? 'ready' : this.state === 'capturing' ? 'reconnecting' : 'idle'; }

  /**
   * 开始采集 + 推流
   * 顺序（对齐移动端）：connectStream(等 ready) → session_start → 每轨 track_start → 启动采集
   */
  async start(source: CaptureSource, sessionId: string, streamUrl: string, token: string, systemDeviceId?: string, directAddress?: string): Promise<{ startedAtUtc: string }> {
    // 状态守卫：stop 未完成/重入 start 时拒绝，避免重复建连接与重复启动 WASAPI
    if (this.stopTask || this.state === 'capturing' || this.state === 'preparing') {
      throw new Error('采集已在进行中（E_STATE）');
    }
    if (!['mic', 'system', 'both'].includes(source)) throw new Error('无效的音频来源');
    if (systemDeviceId !== undefined && typeof systemDeviceId !== 'string') throw new Error('无效的系统音频输出设备');
    if (source !== 'mic' && !['darwin', 'win32'].includes(process.platform)) {
      throw new Error('当前系统暂只支持麦克风采集，请选择仅麦克风');
    }
    // Fail before opening a paid transcription connection when the native
    // component or selected Windows playback endpoint is unavailable.
    const windowsCapture = source !== 'mic' && process.platform === 'win32'
      ? createWindowsLoopback(systemDeviceId) : null;
    const generation = ++this.captureGeneration;
    this.wasapi = windowsCapture;
    this.currentAnswer = null;
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
      await this.stream.connect(streamUrl, token, directAddress);
      if (generation !== this.captureGeneration) throw new Error('启动已取消');
    } catch (e: any) {
      // 用户主动停止（stop() → disconnect() 结掉 pending 连接）：不是错误，
      // 状态已由 stop() 管理，原样上抛让渲染进程静默处理
      if (e?.message === '主动断开' || generation !== this.captureGeneration) throw e;
      // A rejected start is owned by the caller; do not leave token-bearing
      // retry timers or a later background connection alive behind an idle UI.
      this.stream.disconnect();
      this.releaseNativeCapture();
      this.sessionId = null;
      this.state = 'idle';
      const err = { code: 'E_STREAM_CONNECT', stage: 'connect', message: e?.message || '音频流连接失败', recoverable: true };
      this.emit('error', err);
      this.emit('captureState', { state: 'idle' });
      throw new Error(err.message);
    }

    // ── 2. 发起会话（会话就绪后补发，避免握手竞态） ──
    const sessionReady = this.stream.waitForControl('session_ready');
    this.stream.sendControl({ type: 'session_start', session_id: sessionId, source_mode: source });
    try {
      await sessionReady;
      if (generation !== this.captureGeneration) throw new Error('启动已取消');
    } catch (error) {
      if (generation !== this.captureGeneration) throw error;
      this.stream.disconnect(); this.releaseNativeCapture(); this.sessionId = null;
      this.state = 'idle'; this.emit('captureState', { state: 'idle' }); throw error;
    }
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
    if (windowsCapture) {
      let synchronousFailure: Error | null = null;
      try {
        const {sampleRate: rate, channels, isFloat, bitsPerSample: bits} = windowsCapture;
        if (!Number.isFinite(rate) || rate < 8000 || rate > 384000 ||
            !Number.isInteger(channels) || channels < 1 || channels > 32 ||
            (isFloat ? bits !== 32 : ![16, 24, 32].includes(bits))) {
          throw new Error('系统音频输出格式不受支持，请在 Windows 声音设置中选择标准 PCM 输出格式');
        }
        const normalizer = new StreamingPcmNormalizer(rate, channels);
        this.windowsPcm = normalizer;
        windowsCapture.start((err, buf) => {
          // Native callbacks already queued when stop() runs may arrive after
          // the next interview starts. They must never enter the new tracks.
          if (generation !== this.captureGeneration || this.state !== 'capturing') return;
          if (err) {
            synchronousFailure = err;
            void this.stop('system_capture_failed');
            this.emit('error', { code: err.code || 'E_WASAPI', stage: 'capture', source: 'system', message: err.message, recoverable: false });
            return;
          }
          try {
            if (!buf) throw new Error('系统音频组件返回了空音频数据');
            const pcm16 = this.toInt16(Buffer.from(buf), isFloat, bits);
            const norm = normalizer.push(pcm16);
            this.pushNorm('system', norm);
          } catch (e: any) {
            synchronousFailure = e;
            void this.stop('invalid_system_audio');
            this.emit('error', { code: 'E_PCM', stage: 'capture', source: 'system', message: e.message, recoverable: false });
          }
        });
        if (generation !== this.captureGeneration) {
          await this.stopTask;
          throw synchronousFailure || new Error('启动已取消');
        }
      } catch (error) {
        // 不再静默降级：system 轨失败必须让用户看到
        const message = error instanceof Error ? error.message : '系统音频采集不可用，请检查输出设备或选择仅麦克风';
        if (!synchronousFailure) this.emit('error', { code: 'E_WASAPI_START', stage: 'capture', source: 'system', message, recoverable: false });
        await this.stop('system_capture_failed');
        throw new Error(message);
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
    // Windows owns this source in WASAPI; accepting renderer loopback frames
    // there could double or cross-route system audio.
    if (process.platform !== 'darwin') return;
    if (this.state !== 'capturing') return;
    if (!this.tracks.has('system')) return;
    this.pushNorm('system', normalizePcm(buffer, 16000, 1));
  }

  /** 发送 JSON 控制消息（llm_query / config 等） */
  sendControl(msg: object): void {
    if (!this.stream.isReady()) throw new Error('音频连接尚未就绪，请稍后重试');
    this.stream.sendControl(msg);
  }

  /** 停止采集 + 收尾会话（对齐移动端：flush isFinal → track_end → session_stopped → 断连） */
  stop(reason = 'user_stop'): Promise<void> {
    if (this.stopTask) return this.stopTask;
    if (this.state === 'idle' || this.state === 'completed') return Promise.resolve();
    this.stopTask = this.finishCapture(reason).finally(() => { this.stopTask = null; });
    return this.stopTask;
  }

  private async finishCapture(reason: string): Promise<void> {
    this.captureGeneration += 1;
    this.state = 'preparing'; // prevent new renderer frames during finalization
    // 1. 停采集源
    this.releaseNativeCapture();
    if (this.levelsTimer) { clearInterval(this.levelsTimer); this.levelsTimer = null; }
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }
    try {
      const systemTail = this.windowsPcm?.flush();
      if (systemTail?.length) this.pushNorm('system', systemTail);

      // 2. flush 尾帧（isFinal=1，携带剩余不足一帧的数据）
      for (const s of ['mic', 'system'] as TrackName[]) {
        const t = this.tracks.get(s);
        if (t) {
          const rest = t.accum.flush();
          if (rest.length > 0) this.sendFrame(s, rest, true);
        }
      }

      // 3. 会话收尾
      const stopped = this.stream.isReady() && this.sessionId
        ? this.stream.waitForControl('session_stopped', 18000).catch(() => {
            this.emit('error', { code: 'E_STOP_CONFIRM', message: '转写收尾未确认，最后一段可能仍是草稿', recoverable: true });
          }) : Promise.resolve();
      if (this.sessionId && this.stream.isReady()) {
        for (const s of ['mic', 'system'] as TrackName[]) {
          const t = this.tracks.get(s);
          if (t) {
            this.stream.sendControl({ type: 'track_end', session_id: this.sessionId, source: s, last_sequence: t.seq - 1 });
          }
        }
        this.stream.sendControl({ type: 'session_stopped', session_id: this.sessionId, stop_reason: reason });
      }

      // Keep receiving until the ASR tail and its final revisions are drained.
      await stopped;
    } catch {
      this.emit('error', { code: 'E_STOP_CONFIRM', message: '音频设备已停止，转写收尾未确认，最后一段可能仍是草稿', recoverable: true });
    } finally {
      // A transport send can race a disconnect. Never leave native resources or
      // reconnection timers alive because flushing the last packet failed.
      this.windowsPcm = null;
      this.stream.disconnect();
      this.tracks.clear();
      this.lastLevels = { mic: 0, system: 0 };
      this.sessionId = null;
      this.state = 'completed';
      this.emit('captureState', { state: 'completed' });
    }
  }

  private announceSession(): void {
    if (!this.sessionId) return;
    this.stream.sendControl({ type: 'session_start', session_id: this.sessionId, source_mode: this.source });
    for (const source of this.tracks.keys()) {
      this.stream.sendControl({ type: 'track_start', session_id: this.sessionId, source,
        format: { sample_rate: 16000, bits_per_sample: 16, channels: 1, encoding: 'pcm_s16le', chunk_duration_ms: 40 } });
    }
    this.emit('error', { code: 'E_AUDIO_GAP', message: '音频连接已恢复，中断期间的实时内容可能缺失', recoverable: true });
  }

  private releaseNativeCapture(): void {
    const capture = this.wasapi;
    this.wasapi = null;
    if (capture) {
      try { capture.stop(); } catch { /* Native cleanup must not block websocket teardown. */ }
    }
  }

  getSnapshot() {
    return {
      captureState: this.state,
      streamState: this.getStreamState(),
      sessionId: this.sessionId,
      source: this.source,
      startedAtUtc: this.startedAtUtc,
      levels: this.lastLevels,
      currentAnswer: this.currentAnswer ? { ...this.currentAnswer } : null,
    };
  }

  // ── 内部：归一化 + 帧发送 ──

  /** 任意 WASAPI 格式 → int16 PCM */
  private toInt16(input: Buffer, isFloat: boolean, bitsPerSample: number): Buffer {
    if (isFloat) {
      const n = Math.floor(input.length / 4);
      // Native buffers need not have a 4-byte-aligned offset in Node's pool.
      const samples = new Float32Array(n);
      for (let index = 0; index < n; index++) samples[index] = input.readFloatLE(index * 4);
      return floatToPcm16(samples);
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
