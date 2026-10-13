import type {WorkspaceSession} from '../api/workspace';

type Message = {id: string; revision?: number};
type Answer = {
  id: string;
  source_message_ids: string[];
  source_revisions: number[];
  status: string;
  text: string;
  context_snapshot?: Record<string, unknown>;
};

export function hasRevisedSources(answer: Answer, messages: Message[]) {
  return answer.source_message_ids.some((id, index) => {
    const message = messages.find(value => value.id === id);
    return !message || (message.revision ?? 0) !== answer.source_revisions[index];
  });
}

/** Reopening the same question should not cancel another answer or make a paid request. */
export function findReusableAnswer<T extends Answer>(
  answers: T[],
  messages: Message[],
  messageId: string,
  preferences?: WorkspaceSession['preferences'],
): T | undefined {
  return [...answers]
    .reverse()
    .find(
      answer =>
        answer.source_message_ids.includes(messageId) &&
        !answer.context_snapshot?.supplement_instruction &&
        (!preferences || Object.entries(preferences).every(([key, value]) =>
          key === 'answer_length' || answer.context_snapshot?.[key] === value)) &&
        !hasRevisedSources(answer, messages) &&
        (answer.status === 'loading' || answer.status === 'streaming' || !!answer.text),
    );
}

export function sentenceLabel(status: string, edited = false) {
  if (status === 'streaming') return '正在转写';
  if (status === 'interrupted') return '待确认';
  if (status === 'error') return '识别异常';
  return edited ? '已修正' : '';
}
