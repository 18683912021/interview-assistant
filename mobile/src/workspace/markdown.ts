export type Block =
  | {kind: 'text' | 'heading' | 'code'; text: string}
  | {kind: 'table'; rows: string[][]};
/** Small, non-HTML renderer: no webviews, script execution or remote embedded images. */
export function markdownBlocks(text: string): Block[] {
  const lines = text.split('\n'),
    blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('```')) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i]!.startsWith('```')) {
        code.push(lines[i]!);
      }
      blocks.push({kind: 'code', text: code.join('\n')});
    } else if (
      line.includes('|') &&
      /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || '')
    ) {
      const cells = (s: string) =>
        s
          .replace(/^\s*\|/, '')
          .replace(/\|\s*$/, '')
          .split('|')
          .map(c => c.trim());
      const rows = [cells(line)];
      i++;
      while (
        i + 1 < lines.length &&
        lines[i + 1]!.includes('|') &&
        lines[i + 1]!.trim()
      ) {
        rows.push(cells(lines[++i]!));
      }
      blocks.push({kind: 'table', rows});
    } else if (line.trim()) {
      blocks.push({
        kind: /^#{1,6} /.test(line) ? 'heading' : 'text',
        text: line
          .replace(/^#{1,6} /, '')
          .replace(/\*\*(.*?)\*\*/g, '$1')
          .replace(/`([^`]+)`/g, '$1')
          .replace(/^[-*] /, '• '),
      });
    }
  }
  return blocks;
}
