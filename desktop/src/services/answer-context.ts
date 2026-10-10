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
