import {streamJSON} from './stream';
import {api} from './client';

export interface ResumeVersion {
  kind?: 'resume' | 'experience' | 'draft';
  id: string;
  version: number;
  filename: string;
  text: string;
  created_at: string;
}
export interface Job {
  id: string;
  title: string;
  company: string;
  description: string;
  programming_language?: string;
  created_at: string;
}
export interface Settings {
  audio_retention_days?: 0 | 7 | 30;
  theme: 'system' | 'light' | 'dark';
  font_size: 14 | 16 | 18;
  language: 'zh' | 'en' | 'auto';
  /** Legacy field retained for saved-session compatibility; depth now follows answer_style. */
  answer_length: 'brief' | 'standard' | 'detailed';
  answer_style: 'conversational' | 'structured' | 'written';
  microphone_id: string;
  system_device_id: string;
}
export const ANSWER_STYLES = [
  {value: 'conversational', label: '自然口述', description: '自然表达，讲清关键原因与做法，补充实用细节'},
  {value: 'structured', label: '结构化要点', description: '分点解释机制、条件与例子，重点清晰，便于补充'},
  {value: 'written', label: '标准书面', description: '深入解释机制、边界与方案取舍，备好进阶追问'},
] as const;
export const answerStyleLabel = (style: unknown) =>
  ANSWER_STYLES.find(option => option.value === style)?.label || '自然口述';
export const DEFAULT_SETTINGS: Settings = {
  audio_retention_days: 0,
  theme: 'system',
  font_size: 16,
  language: 'auto',
  answer_length: 'brief',
  answer_style: 'conversational',
  microphone_id: '',
  system_device_id: '',
};
export interface WorkspaceMessage {
  id: string;
  role: 'interviewer' | 'user' | 'ai';
  text: string;
  status: string;
  timestamp: number;
  revision?: number;
  source?: string | null;
  edited?: boolean;
  utteranceId?: string;
  startTime?: number;
  endTime?: number;
}
export interface WorkspaceAnswer {
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
}
export interface WorkspaceSession {
  id: string;
  title: string;
  company: string;
  role: string;
  job_description: string;
  resume_id: string | null;
  resume_snapshot: Pick<ResumeVersion, 'id' | 'version' | 'filename' | 'text'> | null;
  status: 'active' | 'completed' | 'interrupted';
  started_at: number;
  ended_at: number | null;
  duration_seconds: number;
  conversation: WorkspaceMessage[];
  answers: WorkspaceAnswer[];
  review?: {text: string; created_at: string; revision: number} | null;
  preferences: Pick<Settings, 'language' | 'answer_length' | 'answer_style'>;
  revision: number;
  sync_base_revision?: number;
  capture_source?: 'mic' | 'both';
}
export type SessionSummary = Omit<WorkspaceSession, 'conversation' | 'answers'> & {
  message_count: number;
  answer_count: number;
};
export const getWorkspaceInterviews = () =>
  api.get<SessionSummary[]>('/api/workspace/interviews', true);
export const getWorkspaceInterview = (id: string) =>
  api.get<WorkspaceSession>(`/api/workspace/interviews/${encodeURIComponent(id)}`, true);
export const saveWorkspaceInterview = (
  session: WorkspaceSession,
  expectedRevision = session.revision - 1,
) => {
  const snapshot = {...session};
  delete snapshot.sync_base_revision;
  return api.put<WorkspaceSession>(
    `/api/workspace/interviews/${encodeURIComponent(session.id)}`,
    {...snapshot, expected_revision: expectedRevision},
    true,
  );
};
export const deleteWorkspaceInterview = (id: string) =>
  api.del<{ok: boolean}>(`/api/workspace/interviews/${encodeURIComponent(id)}`, true);
export const generateReview = (id: string, onText: (text: string) => void, signal: AbortSignal) => {
  let text = '';
  return streamJSON(`/api/workspace/interviews/${encodeURIComponent(id)}/review/stream`, {}, event => {
    if (event.type === 'delta') {text += event.text; onText(text);}
  }, signal);
};
export const getResumes = (includeDrafts = false) => api.get<ResumeVersion[]>(`/api/workspace/resumes?include_drafts=${includeDrafts}`, true);
export const createResume = (text: string, filename?: string, kind: NonNullable<ResumeVersion['kind']> = 'resume') =>
  api.post<ResumeVersion>('/api/workspace/resumes', {text, filename, kind}, true);
export const uploadResumeVersion = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return api.upload<ResumeVersion>('/api/workspace/resumes/upload', form);
};
export const getJobs = () => api.get<Job[]>('/api/workspace/jobs', true);
export type JobInput = Pick<Job, 'title' | 'company' | 'description' | 'programming_language'>;
export const createJob = (job: JobInput) => api.post<Job>('/api/workspace/jobs', {...job}, true);
export const updateJob = (id: string, job: JobInput) =>
  api.put<Job>(`/api/workspace/jobs/${encodeURIComponent(id)}`, {...job}, true);
export const deleteJob = (id: string) =>
  api.del<{ok: boolean}>(`/api/workspace/jobs/${encodeURIComponent(id)}`, true);
export const getSettings = () => api.get<Settings>('/api/workspace/settings', true);
export const saveSettings = (settings: Partial<Settings>) =>
  api.put<Settings>('/api/workspace/settings', {...settings}, true);
export type ToolKind = 'intro' | 'project' | 'jd' | 'answer';
export const runTool = (
  kind: ToolKind,
  input: {input: string; role: string; job_description: string; resume_text: string},
  onText: (text: string) => void,
  signal: AbortSignal,
) => {
  let text = '';
  return streamJSON(`/api/workspace/tools/${kind}?stream=true`, input, event => {
    if (event.type === 'delta') {text += event.text; onText(text);}
  }, signal).then(() => ({text}));
};
export const getInterviewPage = (page: number, query: string, status: string) =>
  api.get<{items: SessionSummary[]; total: number; page: number; size: number}>(`/api/workspace/interviews/page?${new URLSearchParams({page: String(page), q: query, status})}`, true);
export const getInterviewRevisions = () => api.get<Record<string, number>>('/api/workspace/interviews/revisions', true);
export const clearInterviewAudio = (id: string) => api.del<{ok: boolean}>(`/api/workspace/interviews/${encodeURIComponent(id)}/audio`, true);

export const deleteResumeVersion = (id: string) => api.del<{ok: boolean}>(`/api/workspace/resumes/${encodeURIComponent(id)}`, true);
