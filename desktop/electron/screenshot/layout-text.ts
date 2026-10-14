type Word = {text: string; bbox: {x0: number; x1: number}};
type Line = {text: string; bbox: {x0: number}; words: Word[]};
/** OCR plain text drops leading code whitespace. Recover modest indentation from line positions. */
export function layoutText(blocks: {paragraphs: {lines: Line[]}[]}[] | null, fallback: string): string {
  const lines = (blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines));
  if (!lines.length) return fallback.trim();
  const left = Math.min(...lines.map(line => line.bbox.x0));
  const widths = lines.flatMap(line => line.words.filter(word => /^[\x21-\x7e]{2,}$/.test(word.text))
    .map(word => (word.bbox.x1 - word.bbox.x0) / word.text.length)).filter(value => value > 0).sort((a, b) => a - b);
  const charWidth = widths[Math.floor(widths.length / 2)];
  return lines.map(line => {
    const indent = charWidth ? Math.max(0, Math.min(24, Math.round((line.bbox.x0 - left) / charWidth))) : 0;
    return ' '.repeat(indent) + line.text.trimEnd();
  }).join('\n').trimEnd();
}
