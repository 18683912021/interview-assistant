/**
 * 面试对话类型定义
 *
 * 从 useAudioCaptureController 提取，api/ 和 store/ 共用。
 */

export type ConversationBubbleStatus = 'loading' | 'streaming' | 'done' | 'error';

export interface ConversationMessage {
  id: string;
  role: 'interviewer' | 'user' | 'ai';
  text: string;
  status: ConversationBubbleStatus;
  timestamp: number;
}
