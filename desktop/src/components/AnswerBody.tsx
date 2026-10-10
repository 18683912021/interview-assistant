import {Fragment, type ReactNode} from 'react';

/** A deliberately small Markdown renderer. Content is always React text, never HTML. */
function inline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokens = /(`+)(.+?)\1|\*\*(.+?)\*\*|__(.+?)__|!?\[([^\]]+)\]\(([^)]*)\)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const key = `${match.index}-${match[0].length}`;
    if (match[1]) nodes.push(<code key={key}>{match[2]}</code>);
    else if (match[3] || match[4]) nodes.push(<strong key={key}>{match[3] || match[4]}</strong>);
    // Links and image syntax become plain labels. No remote resources are requested.
    else
      nodes.push(
        <Fragment key={key}>{match[0].startsWith('!') ? `图片：${match[5]}` : match[5]}</Fragment>,
      );
    cursor = tokens.lastIndex;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export default function AnswerBody({text, className = ''}: {text: string; className?: string}) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  const fencePattern = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
  const listPattern = /^\s*(?:([-+*])|(\d+)[.)])\s+(.+)$/;
  const startsBlock = (line: string) =>
    !line.trim() ||
    fencePattern.test(line) ||
    listPattern.test(line) ||
    /^\s{0,3}#{1,6}\s/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line);
  while (index < lines.length) {
    const line = lines[index] || '';
    const start = index;
    if (!line.trim()) {
      index++;
      continue;
    }
    const fence = line.match(fencePattern);
    if (fence) {
      const delimiter = fence[1]!;
      const language = (fence[2] || '').trim().split(/\s+/)[0] || '';
      const code: string[] = [];
      index++;
      const closing = new RegExp(`^\\s{0,3}${delimiter[0]}{${delimiter.length},}\\s*$`);
      while (index < lines.length && !closing.test(lines[index]!)) code.push(lines[index++]!);
      if (index < lines.length) index++;
      blocks.push(
        <div className="answer-code" key={start}>
          {language && <span className="answer-code-language">{language}</span>}
          <pre>
            <code>{code.join('\n')}</code>
          </pre>
        </div>,
      );
      continue;
    }
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*$/);
    if (heading) {
      blocks.push(<h3 key={start}>{inline(heading[1]!)}</h3>);
      index++;
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push(<hr key={start} />);
      index++;
      continue;
    }
    const item = line.match(listPattern);
    if (item) {
      const ordered = !!item[2];
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const next = lines[index]!.match(listPattern);
        if (!next || !!next[2] !== ordered) break;
        items.push(<li key={index}>{inline(next[3]!)}</li>);
        index++;
      }
      blocks.push(
        ordered ? (
          <ol key={start} start={Number(item[2]) || 1}>
            {items}
          </ol>
        ) : (
          <ul key={start}>{items}</ul>
        ),
      );
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index]!))
        quoted.push(lines[index++]!.replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={start}>{inline(quoted.join('\n'))}</blockquote>);
      continue;
    }
    const paragraph = [line];
    index++;
    while (index < lines.length && !startsBlock(lines[index]!)) paragraph.push(lines[index++]!);
    blocks.push(<p key={start}>{inline(paragraph.join('\n'))}</p>);
  }
  return <div className={`answer-body ${className}`.trim()}>{blocks}</div>;
}
export {AnswerBody};
