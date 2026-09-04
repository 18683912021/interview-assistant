/**
 * 面试 API —— 保存/列表/详情/清除
 *
 * 从 RN 项目迁移，ConversationMessage 类型提取到 store/types.ts
 */
import { api } from './client';
import type { ConversationMessage } from '../store/types';

export interface InterviewListItem {
  id: string;
  started_at: number;
  duration_seconds: number;
  programming_language: string;
  message_count: number;
}

export interface InterviewDetail {
  id: string;
  started_at: number;
  ended_at: number;
  duration_seconds: number;
  programming_language: string;
  conversation: ConversationMessage[];
}

export function saveInterview(data: {
  started_at: number;
  ended_at: number;
  duration_seconds: number;
  programming_language: string;
  conversation: ConversationMessage[];
}): Promise<{ ok: boolean; id: string }> {
  return api.post('/api/interview/save', data as any, true);
}

export function getInterviewList(): Promise<InterviewListItem[]> {
  return api.get<InterviewListItem[]>('/api/interview/list', true);
}

export function getInterviewDetail(id: string): Promise<InterviewDetail> {
  return api.get<InterviewDetail>(`/api/interview/${id}`, true);
}

export function clearInterviewHistory(): Promise<{ ok: boolean; deleted: number }> {
  return api.del<{ ok: boolean; deleted: number }>('/api/interview/clear', true);
}
