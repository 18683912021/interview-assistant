import {useCallback, useEffect, useMemo, useReducer, useRef} from 'react';
import {
  AppState,
  PermissionsAndroid,
  Platform,
  type Permission,
} from 'react-native';

import {
  AudioCapture,
  type AudioCapabilities,
  type AudioLevels,
  type CaptureResult,
  type CaptureSource,
  type CaptureState,
  type LLMStartEvent,
  type LLMChunkEvent,
  type LLMDoneEvent,
  type NativeCaptureError,
  type StreamState,
  type StreamStats,
  type TrackSource,
} from '../native';
import {STREAM_URL, getLanguage, getProgLang, onLanguageChange} from '../config';
import {useAppAlert} from '../components/AppAlert';

// ── Constants ──────────────────────────────────────────────
const EMPTY_LEVELS: AudioLevels = {mic: 0, system: 0};
const EMPTY_STREAM_STATS: StreamStats = {
  queuedBytes: 0, transportBytes: 0, acknowledgedBytes: 0,
  realtimeFrames: 0, droppedFrames: 0, backfillBytes: 0,
};

// ── Types ──────────────────────────────────────────────────
export type ConversationBubbleStatus = 'loading' | 'streaming' | 'done' | 'error';

export interface ConversationMessage {
  id: string;
  role: 'interviewer' | 'user' | 'ai';
  text: string;
  status: ConversationBubbleStatus;
  timestamp: number;
}

interface ControllerState {
  capabilities: AudioCapabilities | null;
  captureState: CaptureState;
  streamState: StreamState;
  source: CaptureSource;
  projectionGranted: boolean;
  levels: AudioLevels;
  streamStats: StreamStats;
  startedAtUtc: string | null;
  result: CaptureResult | null;
  pendingBackfill: boolean;
  error: NativeCaptureError | null;
  streamMessage: string | null;
  conversation: ConversationMessage[];
  pendingLLMQueue: string[];
  currentStreamingAIId: string | null;
}

type Action =
  | {type: 'capabilities'; value: AudioCapabilities}
  | {type: 'source'; value: CaptureSource}
  | {type: 'projection'; value: boolean}
  | {type: 'captureState'; value: CaptureState; payload?: Partial<ControllerState>}
  | {type: 'streamState'; value: StreamState; message?: string}
  | {type: 'levels'; value: AudioLevels}
  | {type: 'streamStats'; value: StreamStats}
  | {type: 'result'; value: CaptureResult}
  | {type: 'error'; value: NativeCaptureError | null}
  | {type: 'transcription'; text: string; isFinal: boolean; source: 'mic' | 'system'; timestamp: number}
  | {type: 'llm_start'; question_text: string; language: string; timestamp: number}
  | {type: 'llm_chunk'; chunk_index: number; delta: string; timestamp: number}
  | {type: 'llm_done'; full_answer: string; timestamp: number; error?: string}
  | {type: 'snapshot'; value: Partial<ControllerState>}
  | {type: 'llm_query_sent'; aiBubbleId: string; insertedAfterId: string; timestamp: number}
  | {type: 'llm_answer_error'; aiBubbleId: string};

// ── Initial State ─────────────────────────────────────────
const INITIAL_STATE: ControllerState = {
  capabilities: null,
  captureState: 'idle',
  streamState: 'idle',
  source: 'both',
  projectionGranted: false,
  levels: EMPTY_LEVELS,
  streamStats: EMPTY_STREAM_STATS,
  startedAtUtc: null,
  result: null,
  pendingBackfill: false,
  error: null,
  streamMessage: null,
  conversation: [],
  pendingLLMQueue: [],
  currentStreamingAIId: null,
};

// ── Helpers ───────────────────────────────────────────────
function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function insertAfter<T extends {id: string}>(arr: T[], afterId: string, item: T): T[] {
  const idx = arr.findIndex(x => x.id === afterId);
  if (idx === -1) { return [...arr, item]; }
  return [...arr.slice(0, idx + 1), item, ...arr.slice(idx + 1)];
}

// ── 纯标点检测 ──
const _PUNCT_ONLY_RE = /^[，。！？、；：""''.!?,;:'"\s]+$/;
function _isOnlyPunct(s: string): boolean {
  return _PUNCT_ONLY_RE.test(s);
}

// ── 裁剪对话 ──
function _cap(conv: ConversationMessage[]): ConversationMessage[] {
  return conv.length > 60 ? conv.slice(-60) : conv;
}

// ── Reducer ───────────────────────────────────────────────
function reducer(state: ControllerState, action: Action): ControllerState {
  switch (action.type) {
    case 'capabilities':
      return {...state, capabilities: action.value};
    case 'source':
      return {...state, source: action.value, projectionGranted: false, result: null, error: null};
    case 'projection':
      return {...state, projectionGranted: action.value, error: null};
    case 'captureState':
      return {...state, captureState: action.value, ...(action.payload ?? {})};
    case 'streamState':
      return {...state, streamState: action.value, streamMessage: action.message ?? state.streamMessage};
    case 'levels':
      return {...state, levels: action.value};
    case 'streamStats':
      return {...state, streamStats: action.value};
    case 'result':
      return {...state, result: action.value, captureState: 'completed', levels: EMPTY_LEVELS,
        conversation: [], pendingLLMQueue: [], currentStreamingAIId: null};
    case 'error':
      return {...state, error: action.value};
    case 'snapshot':
      // 不覆盖 source（用户手动选择的优先）
      return {...state, ...action.value, source: state.source};

    // ── 0.5: Transcription → bubble（1.5 秒断句）──
    // 后端每个句子完结后会重建 ASR 连接，火山引擎不再返回跨句累积文本。
    // 前端只需句内取增量——对比 streaming 泡即可，不需要跨句去重。
    case 'transcription': {
      const role = action.source === 'system' ? 'interviewer' : 'user';
      const now = action.timestamp;
      const incoming = action.text;
      if (!incoming) { return state; }

      const streamingIdx = state.conversation.findIndex(
        m => m.role === role && m.status === 'streaming',
      );

      // 句内增量：incoming 切掉 streaming 泡已有的前缀
      let delta = incoming;
      if (streamingIdx !== -1) {
        const cur = state.conversation[streamingIdx]!.text;
        if (incoming.startsWith(cur)) { delta = incoming.slice(cur.length); }
      }

      // 纯标点增量：追加到当前泡（不跳过——否则句号永远丢失）
      if (_isOnlyPunct(delta.trim())) {
        if (streamingIdx !== -1) {
          return {...state, conversation: _cap(state.conversation.map((m, i) =>
            i === streamingIdx
              ? {...m, text: m.text + delta.trim(),
                 status: (action.isFinal ? 'done' : m.status) as ConversationBubbleStatus,
                 timestamp: now}
              : m))};
        }
        return state;
      }

      if (streamingIdx !== -1) {
        const streamingBubble = state.conversation[streamingIdx]!;
        // 断句完全交给 ASR VAD——is_final 就是句子结束信号
        const shouldSplit = action.isFinal;

        if (shouldSplit) {
          // 断句：关旧泡。delta 非空才起新泡（静音断句的 is_final 纯标记不会带新文本）
          const newText = (delta || incoming).trim();
          const needNewBubble = newText && newText !== streamingBubble.text;
          return {
            ...state,
            conversation: _cap(
              (needNewBubble
                ? state.conversation.map((m, i) =>
                    i === streamingIdx ? {...m, status: 'done' as const, timestamp: now} : m,
                  ).concat({
                    id: genId(role === 'interviewer' ? 'int' : 'usr'),
                    role,
                    text: newText,
                    status: 'streaming' as const,
                    timestamp: now,
                  })
                : state.conversation.map((m, i) =>
                    i === streamingIdx ? {...m, status: 'done' as const, timestamp: now} : m,
                  )
              ),
            ),
          };
        }

        // 流式更新。incoming 以 streaming 泡开头 → 追加增量；
        // 否则 ASR 修正了前面的词（如 "长款"→"强缓存"）→ 用全文替换。
        const append = incoming.startsWith(streamingBubble.text);
        return {
          ...state,
          conversation: _cap(state.conversation.map((m, i) =>
            i === streamingIdx
              ? {...m, text: append ? m.text + delta : incoming, timestamp: now}
              : m,
          )),
        };
      }

      // 无 streaming 泡 → 直接用全文起新泡
      return {
        ...state,
        conversation: _cap([...state.conversation, {
          id: genId(role === 'interviewer' ? 'int' : 'usr'),
          role,
          text: incoming.trim(),
          status: 'streaming' as const,
          timestamp: now,
        }]),
      };
    }

    // ── 0.5: Insert loading AI bubble after clicked ──
    case 'llm_query_sent': {
      const aiMsg: ConversationMessage = {
        id: action.aiBubbleId,
        role: 'ai',
        text: '',
        status: 'loading',
        timestamp: action.timestamp,
      };
      return {
        ...state,
        conversation: _cap(insertAfter(state.conversation, action.insertedAfterId, aiMsg)),
        pendingLLMQueue: [...state.pendingLLMQueue, action.aiBubbleId],
      };
    }

    // ── 0.6: LLM 三态协议 ──
    case 'llm_start': {
      if (state.pendingLLMQueue.length === 0) {
        console.warn('[LLM] 收到非预期 llm_start（无 pending query），静默丢弃');
        return state;
      }
      const aiBubbleId = state.pendingLLMQueue[0]!;
      const restQueue = state.pendingLLMQueue.slice(1);
      // 0.5 手动触发：被点击的气泡本身就是问题，不需要重复插入面试官气泡
      const conversation = state.conversation.map(m =>
        m.id === aiBubbleId
          ? {
              ...m,
              text: '',
              status: 'streaming' as ConversationBubbleStatus,
            }
          : m,
      );
      return {
        ...state,
        pendingLLMQueue: restQueue,
        currentStreamingAIId: aiBubbleId,
        conversation: _cap(conversation),
      };
    }

    case 'llm_chunk': {
      if (!state.currentStreamingAIId) {
        console.warn('[LLM] 收到非预期 llm_chunk（无 currentStreamingAIId），静默丢弃');
        return state;
      }
      return {
        ...state,
        conversation: _cap(state.conversation.map(m =>
          m.id === state.currentStreamingAIId
            ? {...m, text: m.text + action.delta}
            : m,
        )),
      };
    }

    case 'llm_done': {
      const targetId = state.currentStreamingAIId;
      if (!targetId) {
        console.warn('[LLM] 收到非预期 llm_done（无 currentStreamingAIId），静默丢弃');
        return state;
      }
      const isError = !!action.error;
      return {
        ...state,
        currentStreamingAIId: null,
        conversation: _cap(state.conversation.map(m =>
          m.id === targetId
            ? {
                ...m,
                text: isError ? m.text || action.full_answer : action.full_answer,
                status: isError ? 'error' as const : 'done' as const,
              }
            : m,
        )),
      };
    }

    case 'llm_answer_error': {
      return {
        ...state,
        conversation: _cap(state.conversation.map(m =>
          m.id === action.aiBubbleId ? {...m, status: 'error'} : m,
        )),
        pendingLLMQueue: state.pendingLLMQueue.filter(id => id !== action.aiBubbleId),
      };
    }

    default:
      return state;
  }
}

// ── Error Helpers ─────────────────────────────────────────
function createError(code: string, stage: string, message: string): NativeCaptureError {
  return {code, stage, message, recoverable: true};
}

function normalizeError(error: unknown, defaultCode: string): NativeCaptureError {
  if (error instanceof Error) {
    return {code: defaultCode, stage: 'unknown', message: error.message, recoverable: false};
  }
  return {code: defaultCode, stage: 'unknown', message: String(error), recoverable: false};
}

// ── Permissions ───────────────────────────────────────────
interface PermissionSpec { permission: Permission; label: string; }

const REQUIRED_PERMISSIONS: PermissionSpec[] =
  Platform.OS === 'android'
    ? [{permission: PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, label: '麦克风'}]
    : [];

async function requestRuntimePermissions(
  showAlert: (cfg: {title: string; message: string}) => void,
): Promise<boolean> {
  if (REQUIRED_PERMISSIONS.length === 0) { return true; }
  const results = await PermissionsAndroid.requestMultiple(
    REQUIRED_PERMISSIONS.map(p => p.permission),
  );
  const denied = REQUIRED_PERMISSIONS.filter(
    p => results[p.permission] !== PermissionsAndroid.RESULTS.GRANTED,
  );
  if (denied.length > 0) {
    const names = denied.map(p => p.label).join('、');
    showAlert({title: '需要授权', message: `需要${names}权限才能使用语音转文字功能。请在系统设置中开启。`});
    throw new Error(`${names}权限被拒绝`);
  }
  return true;
}

// ── Hook ──────────────────────────────────────────────────
export function useAudioCaptureController() {
  const {showAlert} = useAppAlert();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const operationCounter = useRef(0);
  // 0.6: LLM chunk + 转录 帧缓冲合并，减少双轨同时输出时的无效渲染
  const llmChunkBuf = useRef('');
  const llmChunkRaf = useRef<number | null>(null);
  const transBuf = useRef<{text: string; isFinal: boolean; source: 'mic' | 'system'} | null>(null);
  const transRaf = useRef<number | null>(null);
  // 防卡死：限制对话历史长度 + 节流高频事件
  const MAX_CONVERSATION = 60;
  const levelsThrottle = useRef(0);
  const statsThrottle = useRef(0);

  const canUseSystem = Platform.OS === 'android' && (state.capabilities?.systemAudio ?? false);

  const syncSnapshot = useCallback(async () => {
    try {
      const snap = await AudioCapture.getSnapshot();
      dispatch({
        type: 'snapshot',
        value: {
          captureState: snap.captureState,
          streamState: snap.streamState,
          levels: snap.levels,
          streamStats: snap.streamStats,
          pendingBackfill: snap.pendingBackfill,
          startedAtUtc: snap.startedAtUtc ?? null,
        },
      });
    } catch (e) {
      console.warn('[Controller] getSnapshot 失败:', e);
    }
  }, []);

  // ── Subscriptions ──
  useEffect(() => {
    syncSnapshot();

    const subscriptions = [
      AudioCapture.onCaptureState(event => {
        dispatch({type: 'captureState', value: event.state, payload: event});
      }),
      AudioCapture.onStreamState(event => {
        dispatch({type: 'streamState', value: event.state, message: event.message});
      }),
      AudioCapture.onLevels(value => {
        // 节流 ~100ms，音频帧 ~60fps → 降到 ~10fps
        const now = Date.now();
        if (now - levelsThrottle.current < 100) { return; }
        levelsThrottle.current = now;
        dispatch({type: 'levels', value});
      }),
      AudioCapture.onStreamStats(value => {
        const now = Date.now();
        if (now - statsThrottle.current < 200) { return; }
        statsThrottle.current = now;
        dispatch({type: 'streamStats', value});
      }),
      AudioCapture.onError(value => {
        console.error(
          `[AudioCapture] ${value.code} (${value.stage})`,
          `\n  消息: ${value.message}`,
          value.source ? `\n  来源: ${value.source}` : '',
        );
        dispatch({type: 'error', value});
      }),
      AudioCapture.onTranscription(event => {
        if (__DEV__) { console.log('[转录]', event.source, event.text.slice(0, 40), 'final:', event.isFinal); }
        // isFinal 立即处理，不停 RAF 缓冲——断句需要即时响应
        if (event.isFinal) {
          if (transRaf.current !== null) {
            cancelAnimationFrame(transRaf.current);
            transRaf.current = null;
          }
          const pending = transBuf.current;
          transBuf.current = null;
          if (pending) {
            dispatch({type: 'transcription', text: pending.text, isFinal: pending.isFinal, source: pending.source, timestamp: Date.now()});
          }
          dispatch({type: 'transcription', text: event.text, isFinal: true, source: event.source, timestamp: Date.now()});
          return;
        }
        // 非 isFinal：RAF 合并，同一帧内只保留最新的一条
        transBuf.current = {text: event.text, isFinal: false, source: event.source};
        if (transRaf.current === null) {
          transRaf.current = requestAnimationFrame(() => {
            const evt = transBuf.current;
            transBuf.current = null;
            transRaf.current = null;
            if (evt) {
              dispatch({type: 'transcription', text: evt.text, isFinal: false, source: evt.source, timestamp: Date.now()});
            }
          });
        }
      }),
      AudioCapture.onLLMStart((event: LLMStartEvent) => {
        if (__DEV__) { console.log('[LLM] start lang=%s qText=%s',
          event.language, event.question_text.slice(0, 40)); }
        dispatch({
          type: 'llm_start',
          question_text: event.question_text,
          language: event.language,
          timestamp: event.timestamp,
        });
      }),
      AudioCapture.onLLMChunk((event: LLMChunkEvent) => {
        // RAF 帧缓冲：同一帧内的 chunk 合并为一次 dispatch，首帧即出
        llmChunkBuf.current += event.delta;
        if (llmChunkRaf.current === null) {
          llmChunkRaf.current = requestAnimationFrame(() => {
            const delta = llmChunkBuf.current;
            llmChunkBuf.current = '';
            llmChunkRaf.current = null;
            if (delta) {
              dispatch({
                type: 'llm_chunk',
                chunk_index: 0,
                delta,
                timestamp: Date.now(),
              });
            }
          });
        }
      }),
      AudioCapture.onLLMDone((event: LLMDoneEvent) => {
        // 先 flush 残留缓冲，确保最后几个字不丢
        if (llmChunkRaf.current !== null) {
          cancelAnimationFrame(llmChunkRaf.current!);
          llmChunkRaf.current = null;
        }
        if (llmChunkBuf.current) {
          dispatch({
            type: 'llm_chunk',
            chunk_index: 0,
            delta: llmChunkBuf.current,
            timestamp: Date.now(),
          });
          llmChunkBuf.current = '';
        }
        if (event.error) { console.error('[LLM] 生成失败:', event.error); }
        if (__DEV__) { console.log('[LLM] done len=%d', event.full_answer.length); }
        dispatch({
          type: 'llm_done',
          full_answer: event.full_answer,
          timestamp: event.timestamp,
          error: event.error,
        });
      }),
    ];

    const appStateSub = AppState.addEventListener('change', next => {
      if (next === 'active') { syncSnapshot(); }
      if (next === 'background') {
        // 退到后台：停止采集 + 断开连接，避免原生服务残留在后台
        AudioCapture.stopCapture().catch(() => {});
        AudioCapture.disconnectStream().catch(() => {});
      }
    });

    return () => {
      if (llmChunkRaf.current !== null) {
        cancelAnimationFrame(llmChunkRaf.current!);
        llmChunkRaf.current = null;
      }
      if (transRaf.current !== null) {
        cancelAnimationFrame(transRaf.current!);
        transRaf.current = null;
      }
      subscriptions.forEach(s => s.remove());
      appStateSub.remove();
      // 组件卸载时清理：停止采集 + 断开连接
      AudioCapture.stopCapture().catch(() => {});
      AudioCapture.disconnectStream().catch(() => {});
    };
  }, [syncSnapshot]);

  // ── Source ──
  const setSource = useCallback((source: CaptureSource) => {
    dispatch({type: 'source', value: source});
  }, []);

  // ── System Audio Auth ──
  const authorizeSystemAudio = useCallback(async () => {
    dispatch({type: 'captureState', value: 'preparing'});
    dispatch({type: 'error', value: null});
    try {
      const granted = await AudioCapture.requestProjectionConsent();
      dispatch({type: 'projection', value: granted});
      dispatch({type: 'captureState', value: 'idle'});
      if (!granted) {
        const err: NativeCaptureError = {
          code: 'E_PROJECTION_DENIED', stage: 'consent',
          recoverable: true, message: '系统音频权限未获得授权。',
        };
        console.error(`[AudioCapture] ${err.code} (${err.stage})`, err.message);
        dispatch({type: 'error', value: err});
      }
      return granted;
    } catch (error) {
      dispatch({type: 'error', value: normalizeError(error, 'E_PROJECTION')});
      return false;
    }
  }, []);

  // ── Start ──
  const start = useCallback(async () => {
    dispatch({type: 'error', value: null});
    try {
      await requestRuntimePermissions(showAlert);
      if (!state.projectionGranted) {
        const granted = await authorizeSystemAudio();
        if (!granted) {
          showAlert({title: '需要授权', message: '系统音频权限未授予，无法采集面试官的声音。仅采集麦克风也可以正常使用。'});
          // 不抛异常，继续用 mic-only 模式
        }
      }
      // 重连前先断开残留连接，避免卡死
      if (state.streamState !== 'idle') {
        try { await AudioCapture.disconnectStream(); } catch (e) { /* ignore */ }
        dispatch({type: 'streamState', value: 'idle'});
      }
      try { await AudioCapture.connectStream(STREAM_URL); } catch (e) { /* 可选 */ }
      // 发送初始赛道配置
      AudioCapture.sendControl({type: 'config', llm: {}, track: getProgLang().toLowerCase()});
      operationCounter.current += 1;
      const operationId = `${Date.now()}-${operationCounter.current}`;
      dispatch({type: 'captureState', value: 'preparing', payload: {result: null, startedAtUtc: null}});
      const info = await AudioCapture.startCapture(operationId, 'both');
      dispatch({type: 'projection', value: false});
      dispatch({type: 'captureState', value: 'capturing', payload: {startedAtUtc: info.startedAtUtc}});
    } catch (error) {
      dispatch({type: 'projection', value: false});
      dispatch({type: 'error', value: normalizeError(error, 'E_START')});
    }
  }, [state.projectionGranted, state.streamState, authorizeSystemAudio]);

  // ── Stop ──
  const stop = useCallback(async () => {
    dispatch({type: 'error', value: null});
    try {
      const result = await AudioCapture.stopCapture();
      dispatch({type: 'result', value: result});
    } catch (error) {
      dispatch({type: 'error', value: normalizeError(error, 'E_STOP')});
    }
    // 断开 WebSocket
    try { await AudioCapture.disconnectStream(); } catch (e) { /* ignore */ }
    dispatch({type: 'streamState', value: 'idle'});
  }, []);

  // ── 0.5: Tap bubble → show mode sheet ──
  // ── 0.5: 点击气泡直接触发 LLM ──
  const sendLLMQuery = useCallback((bubbleId: string) => {
    const clickedMsg = state.conversation.find(m => m.id === bubbleId);
    if (!clickedMsg || clickedMsg.role === 'ai') { return; }

    // 已经回答完毕的不再重复发送
    const clickedIdx = state.conversation.findIndex(m => m.id === bubbleId);
    const nextMsg = clickedIdx >= 0 ? state.conversation[clickedIdx + 1] : undefined;
    if (nextMsg && nextMsg.role === 'ai' && nextMsg.status === 'done') {
      return;
    }

    const aiBubbleId = genId('llm');
    const bubbleSource = clickedMsg.role === 'interviewer' ? 'system' : 'mic';
    const now = Date.now();

    dispatch({
      type: 'llm_query_sent',
      aiBubbleId,
      insertedAfterId: clickedMsg.id,
      timestamp: now,
    });

    AudioCapture.sendControl({
      type: 'llm_query',
      text: clickedMsg.text,
      language: getLanguage(),
      track: getProgLang().toLowerCase(),
      bubble_source: bubbleSource,
    });

    if (__DEV__) { console.log('[LLM] 发送 llm_query', {text: clickedMsg.text.slice(0, 40)}); }
  }, [state.conversation]);

  // ── 0.5: Retry failed AI answer ──
  const retryLLM = useCallback((aiBubbleId: string) => {
    const aiMsg = state.conversation.find(m => m.id === aiBubbleId);
    if (!aiMsg || aiMsg.role !== 'ai' || aiMsg.status !== 'error') { return; }

    const aiIdx = state.conversation.findIndex(m => m.id === aiBubbleId);
    if (aiIdx <= 0) { return; }
    const clickedMsg = state.conversation[aiIdx - 1]!;
    if (clickedMsg.role === 'ai') { return; }

    const newAiBubbleId = genId('llm');
    const bubbleSource = clickedMsg.role === 'interviewer' ? 'system' : 'mic';
    const now = Date.now();

    dispatch({
      type: 'llm_query_sent',
      aiBubbleId: newAiBubbleId,
      insertedAfterId: clickedMsg.id,
      timestamp: now,
    });

    AudioCapture.sendControl({
      type: 'llm_query',
      text: clickedMsg.text,
      language: getLanguage(),
      track: getProgLang().toLowerCase(),
      bubble_source: bubbleSource,
    });
  }, [state.conversation]);

  // ── Share ──
  const share = useCallback(async (sessionId: string, source: TrackSource, kind: 'pcm' | 'wav') => {
    try {
      await AudioCapture.shareOutput(sessionId, source, kind);
    } catch (error) {
      dispatch({type: 'error', value: normalizeError(error, 'E_SHARE')});
    }
  }, []);

  // ── 0.6: 发送 LLM 配置帧 ──
  const sendConfig = useCallback((llmConfig: {enabled?: boolean; max_tokens?: number; model?: string}) => {
    AudioCapture.sendControl({
      type: 'config',
      llm: llmConfig,
      track: getProgLang().toLowerCase(),
    });
    if (__DEV__) { console.log('[LLM] 发送 config:', JSON.stringify(llmConfig)); }
  }, []);

  return {
    state,
    canUseSystem,
    setSource,
    authorizeSystemAudio,
    start,
    stop,
    syncSnapshot,
    share,
    sendLLMQuery,
    retryLLM,
    sendConfig,
  };
}
