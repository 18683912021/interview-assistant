import {Children, useRef, useState, type CSSProperties, type ReactNode} from 'react';

const KEY = 'interview:conversation-width';
const clamp = (value: number) => Math.max(30, Math.min(48, value));
const initialWidth = () => {
  try {
    const value = Number(localStorage.getItem(KEY) || 38);
    return Number.isFinite(value) ? clamp(value) : 38;
  } catch {return 38;}
};

/** Shared by live interviews and history; resizing never changes scroll positions. */
export function SessionSplit({pane, children}: {pane: string; children: ReactNode}) {
  const [width, setWidth] = useState(initialWidth);
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panels = Children.toArray(children);
  const update = (value: number) => {
    const next = clamp(value);
    setWidth(next);
    try {localStorage.setItem(KEY, String(next));} catch { /* Layout remains usable without storage. */ }
  };
  return (
    <div ref={root} className={`session-grid${dragging ? ' resizing' : ''}`} data-pane={pane}
      style={{'--conversation-width': `${width}%`} as CSSProperties}>
      {panels[0]}
      <div className="session-divider" role="separator" tabIndex={0} aria-label="调整对话与回答宽度"
        aria-orientation="vertical" aria-valuemin={30} aria-valuemax={48} aria-valuenow={Math.round(width)}
        aria-valuetext={`对话 ${Math.round(width)}%，回答 ${100 - Math.round(width)}%`}
        title="拖动调整宽度，双击恢复默认；方向键微调"
        onDoubleClick={() => update(38)}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
          event.preventDefault();
          update(event.key === 'Home' ? 30 : event.key === 'End' ? 48 : event.key === 'Enter' ? 38 : width + (event.key === 'ArrowLeft' ? -2 : 2));
        }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const bounds = root.current?.getBoundingClientRect();
          if (bounds?.width) update((event.clientX - bounds.left) / bounds.width * 100);
        }}
        onPointerUp={event => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          setDragging(false);
        }}
        onLostPointerCapture={() => setDragging(false)}>
        <span />
      </div>
      {panels[1]}
    </div>
  );
}
