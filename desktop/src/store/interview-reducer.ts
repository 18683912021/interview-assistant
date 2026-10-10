import type {ConversationAnswer, ConversationMessage} from './types';

export interface ControllerState {
  captureState: 'idle' | 'preparing' | 'capturing' | 'paused' | 'completed';
  streamState: 'idle' | 'connecting' | 'ready' | 'degraded' | 'reconnecting' | 'dead' | 'closed';
  source: 'mic' | 'system' | 'both';
  levels: {mic: number; system: number};
  error: {code: string; stage: string; message: string; recoverable: boolean} | null;
  streamMessage: string | null;
  asrError: string | null;
  conversation: ConversationMessage[];
  answers: ConversationAnswer[];
}
export type Action =
  | {type: 'captureState'; value: ControllerState['captureState']}
  | {type: 'streamState'; value: ControllerState['streamState']; message?: string}
  | {type: 'asr_error'; message: string | null}
  | {type: 'source'; value: ControllerState['source']}
  | {type: 'levels'; value: ControllerState['levels']}
  | {type: 'error'; value: ControllerState['error']}
  | {
      type: 'transcription';
      text: string;
      isFinal: boolean;
      source: 'mic' | 'system';
      timestamp: number;
      utteranceId?: string;
      revision?: number;
      startTime?: number;
      endTime?: number;
    }
  | {type: 'edit_message'; id: string; text: string}
  | {type: 'split_message'; id: string; parts: {id: string; text: string}[]}
  | {type: 'add_message'; message: ConversationMessage}
  | {type: 'answer_requested'; answer: ConversationAnswer}
  | {type: 'llm_start'; requestId: string; timestamp: number}
  | {type: 'llm_chunk'; delta: string; requestId: string; timestamp: number; chunkIndex?: number}
  | {
      type: 'llm_done';
      full_answer: string;
      requestId: string;
      timestamp: number;
      status?: string;
      error?: string;
      sourceRefs?: unknown[];
    }
  | {type: 'cancel_answer'; requestId: string}
  | {type: 'hydrate'; conversation: ConversationMessage[]; answers: ConversationAnswer[]}
  | {type: 'settle'}
  | {type: 'reset'};

export const INITIAL_STATE: ControllerState = {
  captureState: 'idle',
  streamState: 'idle',
  source: 'both',
  levels: {mic: 0, system: 0},
  error: null,
  streamMessage: null,
  asrError: null,
  conversation: [],
  answers: [],
};
export function genId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
export function capConversation(messages: ConversationMessage[]): ConversationMessage[] {
  return messages;
}
const generating = (answer: ConversationAnswer) =>
  answer.status === 'loading' || answer.status === 'streaming';
function updateAnswer(
  state: ControllerState,
  requestId: string,
  transform: (answer: ConversationAnswer) => ConversationAnswer,
): ControllerState {
  if (
    !requestId ||
    !state.answers.some(answer => answer.request_id === requestId && generating(answer))
  )
    return state;
  return {
    ...state,
    answers: state.answers.map(answer =>
      answer.request_id === requestId && generating(answer) ? transform(answer) : answer,
    ),
  };
}
export function interviewReducer(state: ControllerState, action: Action): ControllerState {
  switch (action.type) {
    case 'captureState':
      return {...state, captureState: action.value};
    case 'streamState':
      return {...state, streamState: action.value, streamMessage: action.message ?? null};
    case 'asr_error':
      return {...state, asrError: action.message};
    case 'source':
      return {...state, source: action.value};
    case 'levels':
      return {...state, levels: action.value};
    case 'error':
      return {...state, error: action.value};
    case 'reset':
      return {...INITIAL_STATE, conversation: [], answers: []};
    case 'hydrate':
      return {
        ...INITIAL_STATE,
        conversation: action.conversation.map(message =>
          message.status === 'streaming' ? {...message, status: 'interrupted'} : message,
        ),
        answers: action.answers.map(answer =>
          generating(answer) ? {...answer, status: 'cancelled'} : answer,
        ),
      };
    case 'settle':
      return {
        ...state,
        levels: {mic: 0, system: 0},
        conversation: state.conversation.map(message =>
          message.status === 'streaming' ? {...message, status: 'interrupted'} : message,
        ),
        answers: state.answers.map(answer =>
          generating(answer) ? {...answer, status: 'cancelled'} : answer,
        ),
      };
    case 'add_message':
      return {...state, conversation: [...state.conversation, action.message]};
    case 'split_message': {
      const parts = action.parts.filter(part => part.text.trim());
      const original = state.conversation.find(message => message.id === action.id);
      if (!original || parts.length < 2 || parts.length > 30) return state;
      const addedIds = parts.slice(1).map(part => part.id);
      if (
        new Set(addedIds).size !== addedIds.length ||
        addedIds.some(id => state.conversation.some(message => message.id === id))
      )
        return state;
      return {
        ...state,
        conversation: state.conversation.flatMap(message =>
          message.id !== action.id
            ? [message]
            : parts.map((part, index) => ({
                ...message,
                id: index === 0 ? message.id : part.id,
                text: part.text.trim(),
                edited: true,
                status: 'done' as const,
                revision: index === 0 ? (message.revision ?? 0) + 1 : 1,
                // Only the first part keeps the ASR identity and absorbs later provider revisions.
                utteranceId: index === 0 ? message.utteranceId : undefined,
              })),
        ),
      };
    }
    case 'edit_message':
      return {
        ...state,
        conversation: state.conversation.map(message =>
          message.id === action.id
            ? {
                ...message,
                edited: true,
                text: action.text,
                revision: (message.revision ?? 0) + 1,
                status: 'done',
              }
            : message,
        ),
      };
    case 'transcription': {
      const text = action.text.trim();
      if (!text) return state;
      const role = action.source === 'system' ? 'interviewer' : 'user';
      const index = action.utteranceId
        ? state.conversation.findIndex(
            message =>
              message.utteranceId === action.utteranceId && message.source === action.source,
          )
        : state.conversation.findIndex(
            message => message.role === role && message.status === 'streaming',
          );
      const previous = state.conversation[index];
      if (previous?.edited) return state;
      if (previous && action.revision !== undefined && action.revision <= (previous.revision ?? 0))
        return state;
      const message: ConversationMessage = {
        id:
          previous?.id ??
          (action.utteranceId ? `${action.source}:${action.utteranceId}` : genId(role)),
        role,
        text,
        status: action.isFinal ? 'done' : 'streaming',
        timestamp: previous?.timestamp ?? action.timestamp,
        source: action.source,
        utteranceId: action.utteranceId,
        revision: action.revision ?? (previous?.revision ?? 0) + 1,
        startTime: action.startTime ?? previous?.startTime,
        endTime: action.endTime ?? previous?.endTime,
      };
      return {
        ...state,
        conversation: previous
          ? state.conversation.map((item, i) => (i === index ? message : item))
          : [...state.conversation, message],
      };
    }
    case 'answer_requested':
      return {...state, answers: [...state.answers, action.answer]};
    case 'llm_start':
      return updateAnswer(state, action.requestId, answer => ({...answer, status: 'streaming'}));
    case 'llm_chunk':
      if (
        action.chunkIndex !== undefined &&
        (!Number.isInteger(action.chunkIndex) || action.chunkIndex < 0)
      )
        return state;
      return updateAnswer(state, action.requestId, answer =>
        action.chunkIndex !== undefined && action.chunkIndex <= (answer.last_chunk_index ?? -1)
          ? answer
          : {
              ...answer,
              text: answer.text + action.delta,
              status: 'streaming',
              last_chunk_index: action.chunkIndex ?? answer.last_chunk_index,
              first_token_at: answer.first_token_at ?? action.timestamp,
            },
      );
    case 'cancel_answer':
      return updateAnswer(state, action.requestId, answer => ({...answer, status: 'cancelled'}));
    case 'llm_done':
      return updateAnswer(state, action.requestId, answer => ({
        ...answer,
        text: action.full_answer || answer.text,
        completed_at: action.timestamp,
        status:
          action.status === 'cancelled'
            ? 'cancelled'
            : action.status === 'truncated'
              ? 'truncated'
              : action.error || action.status === 'failed'
                ? 'error'
                : 'done',
        error: action.error,
        source_refs: action.sourceRefs,
      }));
  }
}
