export type ConversationBubbleStatus = 'loading' | 'streaming' | 'done' | 'error' | 'interrupted';
export interface ConversationMessage {
  id: string;
  role: 'interviewer' | 'user' | 'ai';
  text: string;
  status: ConversationBubbleStatus;
  timestamp: number;
  revision?: number;
  edited?: boolean;
  source?: 'mic' | 'system';
  utteranceId?: string;
  startTime?: number;
  endTime?: number;
}
export interface ConversationAnswer {
  id: string;
  request_id: string;
  source_message_ids: string[];
  source_revisions: number[];
  question_text: string;
  text: string;
  status: 'loading' | 'streaming' | 'done' | 'error' | 'cancelled' | 'truncated';
  timestamp: number;
  context_version: number;
  context_snapshot?: Record<string, unknown>;
  error?: string;
  first_token_at?: number;
  last_chunk_index?: number;
  completed_at?: number;
  source_refs?: unknown[];
}
