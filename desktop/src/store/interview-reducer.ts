/**
 * 面试对话 reducer —— 从 RN useAudioCaptureController 提取的纯逻辑
 *
 * 去除所有 React Native 依赖（AudioCapture native module、AppState 等），
 * 仅保留状态机纯函数，供 Electron 和 Web 端各自的 useAudioCapture hook 调用。
 */
import type { ConversationMessage, ConversationBubbleStatus } from './types';

// ── Types ──
export interface ControllerState {
  captureState: 'idle' | 'preparing' | 'capturing' | 'completed';
  streamState: 'idle' | 'connecting' | 'ready' | 'degraded' | 'reconnecting' | 'dead' | 'closed';
  source: 'mic' | 'system' | 'both';
  levels: { mic: number; system: number };
  startedAtUtc: string | null;
  error: { code: string; stage: string; message: string; recoverable: boolean } | null;
  streamMessage: string | null;
  conversation: ConversationMessage[];
  pendingLLMQueue: LLMPendingItem[];
  currentStreamingAIId: string | null;
  currentRequestId: string | null;
}

/** llm_query 队列元素：requestId 用于过滤被取消的旧请求的回包（防竞态污染新气泡） */
export interface LLMPendingItem {
  bubbleId: string;
  requestId: string | null;
}

export type Action =
  | { type: 'captureState'; value: ControllerState['captureState'] }
  | { type: 'streamState'; value: ControllerState['streamState']; message?: string }
  | { type: 'source'; value: ControllerState['source'] }
  | { type: 'levels'; value: ControllerState['levels'] }
  | { type: 'error'; value: ControllerState['error'] }
  | { type: 'transcription'; text: string; isFinal: boolean; source: 'mic' | 'system'; timestamp: number }
  | { type: 'llm_start'; question_text: string; language: string; timestamp: number; requestId?: string | null }
  | { type: 'llm_chunk'; chunk_index: number; delta: string; timestamp: number; requestId?: string | null }
  | { type: 'llm_done'; full_answer: string; timestamp: number; error?: string; requestId?: string | null }
  | { type: 'llm_query_sent'; aiBubbleId: string; insertedAfterId: string; timestamp: number; requestId?: string | null }
  | { type: 'llm_answer_error'; aiBubbleId: string }
  | { type: 'reset' };

// ── Initial State ──
export const INITIAL_STATE: ControllerState = {
  captureState: 'idle',
  streamState: 'idle',
  source: 'both',
  levels: { mic: 0, system: 0 },
  startedAtUtc: null,
  error: null,
  streamMessage: null,
  conversation: [],
  pendingLLMQueue: [],
  currentStreamingAIId: null,
  currentRequestId: null,
};

// ── Helpers ──
export function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function insertAfter<T extends { id: string }>(arr: T[], afterId: string, item: T): T[] {
  const idx = arr.findIndex(x => x.id === afterId);
  if (idx === -1) { return [...arr, item]; }
  return [...arr.slice(0, idx + 1), item, ...arr.slice(idx + 1)];
}

const _PUNCT_ONLY_RE = /^[，。！？、；：""''.!?,;:'"\s]+$/;
function _isOnlyPunct(s: string): boolean {
  return _PUNCT_ONLY_RE.test(s);
}

export function capConversation(conv: ConversationMessage[]): ConversationMessage[] {
  return conv.length > 60 ? conv.slice(-60) : conv;
}

// ── Reducer ──
export function interviewReducer(state: ControllerState, action: Action): ControllerState {
  switch (action.type) {
    case 'captureState':
      return { ...state, captureState: action.value };
    case 'streamState':
      return { ...state, streamState: action.value, streamMessage: action.message ?? state.streamMessage };
    case 'source':
      return { ...state, source: action.value };
    case 'levels':
      return { ...state, levels: action.value };
    case 'error':
      return { ...state, error: action.value };
    case 'reset':
      return { ...INITIAL_STATE, conversation: [], pendingLLMQueue: [], currentStreamingAIId: null, currentRequestId: null };

    // ── Transcription → bubble ──
    case 'transcription': {
      const role = action.source === 'system' ? 'interviewer' : 'user';
      const now = action.timestamp;
      const incoming = action.text;
      if (!incoming) { return state; }

      const streamingIdx = state.conversation.findIndex(
        m => m.role === role && m.status === 'streaming',
      );

      let delta = incoming;
      if (streamingIdx !== -1) {
        const cur = state.conversation[streamingIdx]!.text;
        if (incoming.startsWith(cur)) { delta = incoming.slice(cur.length); }
      }

      if (_isOnlyPunct(delta.trim())) {
        if (streamingIdx !== -1) {
          return {
            ...state,
            conversation: capConversation(state.conversation.map((m, i) =>
              i === streamingIdx
                ? { ...m, text: m.text + delta.trim(), status: (action.isFinal ? 'done' : m.status) as ConversationBubbleStatus, timestamp: now }
                : m)),
          };
        }
        return state;
      }

      if (streamingIdx !== -1) {
        const streamingBubble = state.conversation[streamingIdx]!;
        const shouldSplit = action.isFinal;

        if (shouldSplit) {
          const newText = (delta || incoming).trim();
          const needNewBubble = newText && newText !== streamingBubble.text;
          return {
            ...state,
            conversation: capConversation(
              (needNewBubble
                ? state.conversation.map((m, i) =>
                    i === streamingIdx ? { ...m, status: 'done' as const, timestamp: now } : m,
                  ).concat({
                    id: genId(role === 'interviewer' ? 'int' : 'usr'),
                    role,
                    text: newText,
                    status: 'streaming' as const,
                    timestamp: now,
                  })
                : state.conversation.map((m, i) =>
                    i === streamingIdx ? { ...m, status: 'done' as const, timestamp: now } : m,
                  )
              ),
            ),
          };
        }

        const append = incoming.startsWith(streamingBubble.text);
        return {
          ...state,
          conversation: capConversation(state.conversation.map((m, i) =>
            i === streamingIdx ? { ...m, text: append ? m.text + delta : incoming, timestamp: now } : m,
          )),
        };
      }

      return {
        ...state,
        conversation: capConversation([...state.conversation, {
          id: genId(role === 'interviewer' ? 'int' : 'usr'),
          role,
          text: incoming.trim(),
          status: 'streaming' as const,
          timestamp: now,
        }]),
      };
    }

    // ── LLM 三态协议 ──
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
        conversation: capConversation(insertAfter(state.conversation, action.insertedAfterId, aiMsg)),
        pendingLLMQueue: [...state.pendingLLMQueue, { bubbleId: action.aiBubbleId, requestId: action.requestId ?? null }],
      };
    }

    case 'llm_start': {
      if (state.pendingLLMQueue.length === 0) return state;
      let head = state.pendingLLMQueue[0]!;
      // 带 request_id 的消息优先精确匹配（快速连点时队列顺序可能与服务端返回顺序交错）
      if (action.requestId) {
        const found = state.pendingLLMQueue.find(q => q.requestId === action.requestId);
        if (found) head = found;
      }
      const restQueue = state.pendingLLMQueue.filter(q => q !== head);
      return {
        ...state,
        pendingLLMQueue: restQueue,
        currentStreamingAIId: head.bubbleId,
        currentRequestId: head.requestId,
        conversation: capConversation(state.conversation.map(m =>
          m.id === head.bubbleId ? { ...m, text: '', status: 'streaming' as ConversationBubbleStatus } : m,
        )),
      };
    }

    case 'llm_chunk': {
      if (!state.currentStreamingAIId) return state;
      // 已取消的旧请求回包直接丢弃，防止污染新气泡
      if (action.requestId && action.requestId !== state.currentRequestId) return state;
      return {
        ...state,
        conversation: capConversation(state.conversation.map(m =>
          m.id === state.currentStreamingAIId ? { ...m, text: m.text + action.delta } : m,
        )),
      };
    }

    case 'llm_done': {
      const targetId = state.currentStreamingAIId;
      if (!targetId) return state;
      if (action.requestId && action.requestId !== state.currentRequestId) return state;
      const isError = !!action.error;
      return {
        ...state,
        currentStreamingAIId: null,
        currentRequestId: null,
        conversation: capConversation(state.conversation.map(m =>
          m.id === targetId
            ? { ...m, text: isError ? m.text || action.full_answer : action.full_answer, status: isError ? 'error' as const : 'done' as const }
            : m,
        )),
      };
    }

    case 'llm_answer_error': {
      return {
        ...state,
        conversation: capConversation(state.conversation.map(m =>
          m.id === action.aiBubbleId ? { ...m, status: 'error' as const } : m,
        )),
        pendingLLMQueue: state.pendingLLMQueue.filter(q => q.bubbleId !== action.aiBubbleId),
      };
    }

    default:
      return state;
  }
}
