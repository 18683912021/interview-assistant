/** Keep the live request bounded, preferring resume passages related to the selected question. */
export function resumeExcerpt(text: string, question: string, limit = 12000): string {
  if (text.length <= limit) return text;
  const tokens = new Set(question.toLowerCase().match(/[a-z][a-z0-9.+#-]{1,}/g) || []);
  const stop = new Set([
    '什么',
    '如何',
    '介绍',
    '一下',
    '项目',
    '负责',
    '这个',
    '我们',
    '你的',
    '你在',
    '中的',
  ]);
  for (const phrase of question.match(/[\u4e00-\u9fff]+/g) || []) {
    for (let i = 0; i < phrase.length - 1; i++) {
      const token = phrase.slice(i, i + 2);
      if (!stop.has(token)) tokens.add(token);
    }
  }
  const parts = text.match(/[\s\S]{1,1800}(?:\n|$)|[\s\S]{1,1800}/g) || [text];
  const ranked = parts.map((part, index) => ({
    part,
    index,
    score: [...tokens].reduce(
      (score, token) => score + (part.toLowerCase().includes(token) ? 1 : 0),
      0,
    ),
  }));
  const selected = new Set<number>([0]);
  let budget = limit - (parts[0]?.length || 0);
  for (const item of ranked.slice(1).sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (item.part.length + 2 <= budget) {
      selected.add(item.index);
      budget -= item.part.length + 2;
    }
  }
  return parts
    .filter((_, index) => selected.has(index))
    .join('\n\n')
    .slice(0, limit);
}

/** A retrospective click must never borrow dialogue that happened afterwards. */
export function questionContext<T extends {id: string; role: string; text: string}>(
  conversation: T[], selectedIds: string[],
): {role: string; text: string}[] {
  const indices = conversation.flatMap((message, index) => selectedIds.includes(message.id) ? [index] : []);
  if (!indices.length) return [];
  const first = Math.min(...indices);
  return conversation.slice(Math.max(0, first - 8), first)
    .map(({role, text}) => ({role, text: text.slice(0, 1500)}));
}

/** Prior AI text is reference material, never evidence of what the candidate said. */
export function previousReference(
  conversation: {id: string; timestamp: number; revision?: number}[],
  answers: {text: string; timestamp: number; source_message_ids: string[]; source_revisions: number[]; status: string}[],
  selectedIds: string[],
): string {
  const index = conversation.findIndex(message => selectedIds.includes(message.id));
  if (index < 1) return '';
  const neighbours = conversation.slice(Math.max(0, index - 8), index);
  return [...answers].reverse().find(answer => answer.status === 'done' && answer.timestamp <= conversation[index]!.timestamp &&
    answer.source_message_ids.some((id, offset) => neighbours.some(message => message.id === id && (message.revision ?? 0) === answer.source_revisions[offset])))?.text.slice(0, 6000) || '';
}
