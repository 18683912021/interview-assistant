/**
 * useAudioCapture —— PC 端音频采集 Hook
 *
 * 业务逻辑和移动端 useAudioCaptureController 对齐，但架构为：
 *   采集（WASAPI system + WS 推流）都在主进程；渲染进程只做——
 *   1. 麦克风采集（getUserMedia → AudioContext 16kHz mono → IPC 送主进程）
 *   2. 控制消息（start/stop/llm_query/config）
 *   3. 事件消费（transcription/llm 三态/levels/streamState → reducer）
 */
import { useReducer, useCallback, useEffect, useRef } from 'react';
import { interviewReducer, INITIAL_STATE, genId } from '../store/interview-reducer';
import { MAIN_STREAM_URL, getProgLang, getLanguage } from '../config';
import { enumerateAudioInputs, loadSavedSystemDevice } from '../utils/audioDevices';
import type { ConversationMessage } from '../store/types';

interface MicHandle {
  ctx: AudioContext;
  stream: MediaStream;
  node: AudioWorkletNode;
}

export function useAudioCapture() {
  const [state, dispatch] = useReducer(interviewReducer, INITIAL_STATE);
  const api = window.electronAPI?.audio;
  const micRef = useRef<MicHandle | null>(null);
  const sysRef = useRef<MicHandle | null>(null);
  // 对话引用：sendLLMQuery/retryLLM 依赖它读取点击的气泡，ref 形式保证回调引用稳定
  // （React.memo 列表组件在流式渲染时不会因回调变化失效）
  const conversationRef = useRef(state.conversation);
  conversationRef.current = state.conversation;
  // LLM chunk 合并缓冲：50ms 窗口内多个 chunk 一次 dispatch，降低高频 re-render
  const chunkBufRef = useRef<{ deltas: string[]; requestId: string | null; timer: ReturnType<typeof setTimeout> | null }>({ deltas: [], requestId: null, timer: null });

  const flushChunk = useCallback(() => {
    const buf = chunkBufRef.current;
    if (buf.timer) { clearTimeout(buf.timer); buf.timer = null; }
    if (buf.deltas.length === 0) return;
    const delta = buf.deltas.join('');
    buf.deltas = [];
    dispatch({ type: 'llm_chunk', chunk_index: 0, delta, requestId: buf.requestId, timestamp: Date.now() });
    buf.requestId = null;
  }, []);

  // ── 事件订阅（主进程 → IPC → reducer，对齐移动端事件流） ──
  useEffect(() => {
    if (!api) return;
    const offs = [
      api.onState((evt: any) => {
        if (evt?.state) dispatch({ type: 'captureState', value: evt.state });
      }),
      api.onTranscription((evt: any) => {
        dispatch({ type: 'transcription', text: evt.text, isFinal: evt.is_final, source: evt.source, timestamp: Date.now() });
      }),
      api.onLLMStart((evt: any) => {
        flushChunk();
        dispatch({ type: 'llm_start', question_text: evt.question_text, language: evt.language, requestId: evt.request_id ?? null, timestamp: Date.now() });
      }),
      api.onLLMChunk((evt: any) => {
        const buf = chunkBufRef.current;
        if (buf.deltas.length === 0) buf.requestId = evt.request_id ?? null;  // 记录本批所属请求
        buf.deltas.push(evt.delta ?? '');
        if (!buf.timer) {
          buf.timer = setTimeout(() => {
            buf.timer = null;
            if (buf.deltas.length === 0) return;
            const delta = buf.deltas.join('');
            buf.deltas = [];
            dispatch({ type: 'llm_chunk', chunk_index: evt.chunk_index ?? 0, delta, requestId: buf.requestId, timestamp: Date.now() });
            buf.requestId = null;
          }, 50);
        }
      }),
      api.onLLMDone((evt: any) => {
        flushChunk();
        dispatch({ type: 'llm_done', full_answer: evt.full_answer, requestId: evt.request_id ?? null, timestamp: Date.now(), error: evt.error });
      }),
      api.onStreamState((evt: any) => {
        if (evt?.state) dispatch({ type: 'streamState', value: evt.state });
      }),
      api.onLevels((evt: any) => {
        if (evt) dispatch({ type: 'levels', value: { mic: evt.mic ?? 0, system: evt.system ?? 0 } });
      }),
      // 主进程采集/推流错误必须上屏（addon 缺失、声卡异常等），对齐移动端 onError
      api.onError((evt: any) => {
        if (evt?.message) dispatch({ type: 'error', value: evt });
      }),
    ];
    return () => { offs.forEach(off => off()); };
  }, [api]);

  // ── 挂载时恢复主进程状态（dev reload 场景：UI 与主进程失同步时对齐） ──
  useEffect(() => {
    if (!api) return;
    api.getSnapshot().then((snap: any) => {
      if (!snap) return;
      if (snap.captureState === 'capturing') {
        dispatch({ type: 'captureState', value: 'capturing' });
      }
      if (snap.streamState && snap.streamState !== 'idle') {
        dispatch({ type: 'streamState', value: snap.streamState });
      }
    }).catch(() => {});
  }, [api]);

  // ── worklet float32 帧 → clamp int16 → 指定 IPC 通道（mic/system 共用） ──
  const makeFrameSender = useCallback(
    (send: (frame: Uint8Array) => void) => (e: MessageEvent) => {
      const samples = new Float32Array(e.data as ArrayBuffer);
      const out = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
        out[i] = Math.round(v * 32767);
      }
      send(new Uint8Array(out.buffer));
    },
    [],
  );

  // ── 麦克风采集：AudioWorklet 16kHz mono float32 → int16 → IPC 帧 ──
  const startMic = useCallback(async (): Promise<void> => {
    if (!api || micRef.current) return;
    try {
      // AudioContext 直接输出 16kHz（浏览器高质量重采样），与主进程归一化目标一致；
      // worklet 在 context 采样率下运行，无需在 worklet 内重采样
      const ctx = new AudioContext({ sampleRate: 16000 });
      // worklet 独立文件（public/ 原样复制）：dev 下 Vite 伺服，打包后 file:// 相对路径
      await ctx.audioWorklet.addModule('./mic-processor.js');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'mic-capture-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      // worklet 每 40ms 转移一个 640 样本的 ArrayBuffer；主线程仅做 int16 转换（微秒级）
      node.port.onmessage = makeFrameSender((frame) => api.sendMicFrame(frame));
      source.connect(node);
      micRef.current = { ctx, stream, node };
    } catch (e: any) {
      dispatch({ type: 'error', value: { code: 'E_MIC', stage: 'capture', message: e?.message || '麦克风不可用，请检查权限', recoverable: true } });
    }
  }, [api, makeFrameSender]);

  const stopMic = useCallback((): void => {
    const mic = micRef.current;
    if (!mic) return;
    mic.stream.getTracks().forEach(t => t.stop());
    mic.node.port.onmessage = null;
    mic.node.disconnect();
    mic.ctx.close().catch(() => {});
    micRef.current = null;
  }, []);

  // ── macOS 系统音频采集 ──
  // 系统输出监听在 macOS 上无公开 API（Chromium 的 getDisplayMedia 不提供系统音频），
  // Electron 官方推荐用虚拟声卡（BlackHole 等）路由后按普通输入设备采集：
  //   首选  BlackHole 类虚拟声卡（getUserMedia 采集，稳定可靠）；
  //   兜底  getDisplayMedia 窗口/应用音频（仅新版 Chromium 的窗口源可能带音频）；
  //   失败  明确引导安装 BlackHole，不再出现"已连接却无声"的静默失败。
  const startSystemCapture = useCallback(async (): Promise<void> => {
    if (!api || sysRef.current) return;
    if (!/Mac/i.test(navigator.userAgent)) return;

    const attachPipeline = async (stream: MediaStream): Promise<void> => {
      const ctx = new AudioContext({ sampleRate: 16000 });
      await ctx.audioWorklet.addModule('./mic-processor.js');
      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'mic-capture-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      node.port.onmessage = makeFrameSender((frame) => api.sendSystemFrame(frame));
      source.connect(node);
      sysRef.current = { ctx, stream, node };
    };

    // 1) 虚拟声卡优先：系统输出已路由到 BlackHole 等虚拟卡时，它就是普通音频输入设备
    try {
      const devices = await enumerateAudioInputs();
      const savedId = await loadSavedSystemDevice();
      const virtuals = devices.filter(d => d.isVirtual);
      const target = (savedId && virtuals.find(d => d.deviceId === savedId)) || virtuals[0];
      if (target) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: target.deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
          },
        });
        await attachPipeline(stream);
        return;
      }
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') {
        dispatch({ type: 'error', value: { code: 'E_SYSTEM', stage: 'capture', message: '麦克风权限被拒绝，请到 系统设置 → 隐私与安全性 → 麦克风 授权后重试', recoverable: true } });
      } else {
        dispatch({ type: 'error', value: { code: 'E_SYSTEM', stage: 'capture', message: `系统音频（虚拟声卡）打开失败：${e?.message || e}`, recoverable: true } });
      }
      return;
    }

    // 2) 无虚拟声卡 → getDisplayMedia 窗口音频兜底（仅"窗口"源可能带音频）
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach(t => t.stop());
        throw new Error('所选来源无音频（请选择面试通话窗口，而不是整个屏幕）');
      }
      await attachPipeline(stream);
      return;
    } catch (e: any) {
      // 3) 无既无虚拟卡、窗口音频又不可用 → 明确引导用户安装 BlackHole
      const message = e?.message === '所选来源无音频（请选择面试通话窗口，而不是整个屏幕）'
        ? '所选来源无音频。macOS 仅支持从"面试通话窗口"采集音频；如需采集整个系统输出，请安装 BlackHole 虚拟声卡（见「系统音频」面板的安装指引）'
        : e?.name === 'NotAllowedError'
          ? '系统音频权限被拒绝，请到 系统设置 → 隐私与安全性 → 屏幕录制 授权后重试；或在「系统音频」面板安装 BlackHole，无需屏幕录制权限'
          : e?.name === 'AbortError'
            ? '已取消系统音频选择，本次仅采集麦克风'
            : `系统音频采集失败：${e?.message || e}。建议安装 BlackHole 虚拟声卡（见「系统音频」面板安装指引）`;
      dispatch({ type: 'error', value: { code: 'E_SYSTEM_GUIDE', stage: 'capture', message, recoverable: true } });
    }
  }, [api, makeFrameSender]);

  const stopSystemCapture = useCallback((): void => {
    const sys = sysRef.current;
    if (!sys) return;
    sys.stream.getTracks().forEach(t => t.stop());
    sys.node.port.onmessage = null;
    sys.node.disconnect();
    sys.ctx.close().catch(() => {});
    sysRef.current = null;
  }, []);

  // ── Start（对齐移动端：连接 → 会话 → 采集；主进程统一执行） ──
  const start = useCallback(async () => {
    if (!api) return;
    try {
      // 清掉上一次的残留错误（对齐移动端 start 入口行为）
      dispatch({ type: 'error', value: null });
      dispatch({ type: 'captureState', value: 'preparing' });
      await api.startCapture({ source: 'both', streamUrl: MAIN_STREAM_URL });
      // 主进程 connect(等 ready) + session_start + track_start 已完成
      dispatch({ type: 'captureState', value: 'capturing' });
      dispatch({ type: 'streamState', value: 'ready' });
      // 初始赛道配置（对齐移动端 start 流程）
      await api.sendControl({ type: 'config', llm: {}, track: getProgLang().toLowerCase() });
      await startMic();
      // macOS 系统音频：等待用户完成系统选择器（失败不阻断，内部已 dispatch 错误）
      await startSystemCapture();
    } catch (e: any) {
      // 用户主动停止导致的中断：不是错误，不污染界面
      if (e?.message === '主动断开') return;
      dispatch({ type: 'captureState', value: 'idle' });
      dispatch({ type: 'error', value: { code: 'E_START', stage: 'connect', message: e?.message || '连接失败', recoverable: true } });
    }
  }, [api, startMic, startSystemCapture]);

  // ── Stop（收尾顺序在主进程：flush isFinal → track_end → session_stopped → 断连） ──
  const stop = useCallback(async () => {
    stopMic();
    stopSystemCapture();
    if (api) {
      try { await api.stopCapture(); } catch { /* ignore */ }
    }
    dispatch({ type: 'captureState', value: 'idle' });
    dispatch({ type: 'streamState', value: 'idle' });
    dispatch({ type: 'reset' });
  }, [api, stopMic, stopSystemCapture]);

  // 卸载兜底：只停本地采集，不主动结束会话（结束由用户操作触发）
  useEffect(() => {
    return () => { stopMic(); stopSystemCapture(); };
  }, [stopMic, stopSystemCapture]);

  // ── 发送 LLM 查询（点击气泡触发） ──
  const sendLLMQuery = useCallback((bubbleId: string) => {
    const conv = conversationRef.current;
    const clickedMsg = conv.find((m: ConversationMessage) => m.id === bubbleId);
    if (!clickedMsg || clickedMsg.role === 'ai') return;
    const idx = conv.findIndex((m: ConversationMessage) => m.id === bubbleId);
    const nextMsg = idx >= 0 ? conv[idx + 1] : undefined;
    if (nextMsg && nextMsg.role === 'ai' && nextMsg.status === 'done') return;

    const aiBubbleId = genId('llm');
    const requestId = genId('llmreq');
    dispatch({ type: 'llm_query_sent', aiBubbleId, insertedAfterId: clickedMsg.id, requestId, timestamp: Date.now() });
    api?.sendControl({
      type: 'llm_query', text: clickedMsg.text, language: getLanguage(),
      track: getProgLang().toLowerCase(), bubble_source: clickedMsg.role === 'interviewer' ? 'system' : 'mic',
      request_id: requestId,
    });
  }, [api]);

  // ── Retry LLM ──
  const retryLLM = useCallback((aiBubbleId: string) => {
    const conv = conversationRef.current;
    const aiMsg = conv.find((m: ConversationMessage) => m.id === aiBubbleId);
    if (!aiMsg || aiMsg.role !== 'ai' || aiMsg.status !== 'error') return;
    const aiIdx = conv.findIndex((m: ConversationMessage) => m.id === aiBubbleId);
    if (aiIdx <= 0) return;
    const clickedMsg = conv[aiIdx - 1]!;
    if (clickedMsg.role === 'ai') return;

    const newAiId = genId('llm');
    const requestId = genId('llmreq');
    dispatch({ type: 'llm_query_sent', aiBubbleId: newAiId, insertedAfterId: clickedMsg.id, requestId, timestamp: Date.now() });
    api?.sendControl({
      type: 'llm_query', text: clickedMsg.text, language: getLanguage(),
      track: getProgLang().toLowerCase(), bubble_source: clickedMsg.role === 'interviewer' ? 'system' : 'mic',
      request_id: requestId,
    });
  }, [api]);

  return { state, dispatch, start, stop, sendLLMQuery, retryLLM };
}
