import type {WorkspaceSession, WorkspaceMessage} from '../api/workspace';
export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const n = Math.floor(Math.random() * 16);
    return (c === 'x' ? n : (n & 3) | 8).toString(16);
  });
}
export interface Transcript {
  text: string;
  is_final: boolean;
  utterance_id?: string;
  revision?: number;
  start_time?: number;
  end_time?: number;
}
export function transcribe(
  messages: WorkspaceMessage[],
  e: Transcript,
  segment: string,
  role: 'interviewer' | 'user',
): WorkspaceMessage[] {
  if (!e.text.trim()) {
    return messages;
  }
  const utteranceId = e.utterance_id
    ? `${segment}:${e.utterance_id}`
    : undefined;
  const index = messages.findIndex(m =>
    utteranceId ? m.utteranceId === utteranceId : m.status === 'streaming',
  );
  const old = messages[index];
  if (
    old?.edited ||
    (old && e.revision !== undefined && e.revision <= (old.revision ?? 0))
  ) {
    return messages;
  }
  const next: WorkspaceMessage = {
    ...old,
    id: old?.id || uuid(),
    role: old?.role || role,
    text: e.text.trim(),
    timestamp: old?.timestamp || Date.now(),
    source: 'mic',
    status: e.is_final ? 'done' : 'streaming',
    utteranceId,
    revision: e.revision ?? (old?.revision ?? 0) + 1,
    startTime: e.start_time,
    endTime: e.end_time,
  };
  return old
    ? messages.map((m, i) => (i === index ? next : m))
    : [...messages, next];
}
export function settle(session: WorkspaceSession): WorkspaceSession {
  return {
    ...session,
    conversation: session.conversation.map(m =>
      m.status === 'streaming' ? {...m, status: 'interrupted'} : m,
    ),
    answers: session.answers.map(a =>
      ['loading', 'streaming'].includes(a.status)
        ? {...a, status: 'cancelled'}
        : a,
    ),
  };
}
export function canAnswer(session: WorkspaceSession | null) {
  return !!session && session.status !== 'completed';
}
export function duration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
