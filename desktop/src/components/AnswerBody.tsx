import './AnswerBody.css';
import {Fragment, useId, useState, type ReactNode} from 'react';

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

function CodeBlock({language, text}: {language: string; text: string}) {
  const [feedback, setFeedback] = useState('');
  return <div className="answer-code">
    <div className="answer-code-toolbar"><span>{language || '代码'}</span>
      <button type="button" onClick={() => {void navigator.clipboard.writeText(text)
        .then(() => setFeedback('已复制代码')).catch(() => setFeedback('复制失败，请选中代码复制'));}}>复制代码</button>
      <span role="status">{feedback}</span>
    </div>
    <pre><code>{text}</code></pre>
  </div>;
}
function tableCells(line: string) {
  const cells: string[] = [];
  let cell = '', quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '\\' && line[index + 1] === '|') {cell += '|'; index++;}
    else if (char === '`') {quoted = !quoted; cell += char;}
    else if (char === '|' && !quoted) {cells.push(cell.trim()); cell = '';}
    else cell += char;
  }
  cells.push(cell.trim());
  if (!cells[0]) cells.shift();
  if (!cells[cells.length - 1]) cells.pop();
  return cells;
}
export default function AnswerBody({text, className = ''}: {text: string; className?: string}) {
  const documentId = useId();
  const headings: {id: string; text: string}[] = [];
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
        <CodeBlock key={start} language={language} text={code.join('\n')} />,
      );
      continue;
    }
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*$/);
    if (heading) {
      const id = `${documentId}-${start}`;
      headings.push({id, text: heading[1]!});
      blocks.push(<h3 id={id} key={start}>{inline(heading[1]!)}</h3>);
      index++;
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push(<hr key={start} />);
      index++;
      continue;
    }
    const columns = tableCells(line);
    const separators = tableCells(lines[index + 1] || '');
    if (line.includes('|') && columns.length > 1 && separators.length === columns.length && separators.every(cell => /^:?-{3,}:?$/.test(cell))) {
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index]!.includes('|') && lines[index]!.trim()) rows.push(tableCells(lines[index++]!));
      const alignment = (column: number): 'left' | 'center' | 'right' => separators[column]?.endsWith(':') ? separators[column]?.startsWith(':') ? 'center' : 'right' : 'left';
      blocks.push(<div className="answer-table-scroll" role="region" aria-label="回答中的表格" tabIndex={0} key={start}>
        <table><thead><tr>{columns.map((cell, column) => <th scope="col" style={{textAlign: alignment(column)}} key={column}>{inline(cell)}</th>)}</tr></thead>
        <tbody>{rows.map((row, number) => <tr key={number}>{columns.map((_, column) => <td key={column} style={{textAlign: alignment(column)}}>{inline(row[column] || '')}</td>)}</tr>)}</tbody></table>
      </div>);
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
    while (index < lines.length && !startsBlock(lines[index]!) && !(lines[index]!.includes('|') && tableCells(lines[index + 1] || '').every(cell => /^:?-{3,}:?$/.test(cell)) && tableCells(lines[index + 1] || '').length > 1)) paragraph.push(lines[index++]!);
    blocks.push(<p key={start}>{inline(paragraph.join('\n'))}</p>);
  }
  return <div className={`answer-body ${className}`.trim()}>
    {headings.length >= 4 && <details className="answer-outline"><summary>快速定位 · {headings.length} 个要点</summary>
      <nav aria-label="回答目录">{headings.map(heading => <button key={heading.id} type="button" onClick={() => document.getElementById(heading.id)?.scrollIntoView({block: 'start', behavior: 'smooth'})}>{heading.text}</button>)}</nav>
    </details>}
    {blocks}
  </div>;
}
export {AnswerBody};
