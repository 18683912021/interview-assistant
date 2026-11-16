import {memo, useMemo} from 'react';
import {Check, FileText, Pencil} from 'lucide-react';
import type {ConversationMessage} from '../store/types';

const timeFormat = new Intl.DateTimeFormat('zh-CN', {hour: '2-digit', minute: '2-digit'});
const Bubble = memo(function Bubble({message, multi, selected, answered, onSelect, onEdit}: {
  message: ConversationMessage; multi: boolean; selected: boolean; answered: boolean;
  onSelect: (id: string) => void; onEdit: (message: ConversationMessage) => void;
}) {
  const time = useMemo(() => timeFormat.format(message.timestamp), [message.timestamp]);
  return <article className={`chat-message ${message.role}`} data-message={message.id}>
    <div className="chat-speaker">
      <span className="speaker-avatar">{message.role === 'interviewer' ? '面' : '我'}</span>
      <span>{message.role === 'interviewer' ? '面试官' : '我'} · {time}
        {message.status === 'streaming' ? ' · 转写中…' : message.status === 'interrupted' ? ' · 待确认' : message.edited ? ' · 已修正' : ''}
      </span>
    </div>
    <button className={`chat-bubble${multi ? ' multi-select' : ''} ${selected ? 'selected' : ''}`}
      aria-pressed={selected} onClick={() => onSelect(message.id)}>
      {multi && <span className="bubble-selection" aria-hidden="true">{selected && <Check size={13} strokeWidth={3} />}</span>}
      <span>{message.text}</span>
    </button>
    <div className="bubble-actions">
      {answered && <span className="bubble-answer-count"><FileText size={11} /> 有回答</span>}
      <button className="bubble-edit" aria-label="修正或拆分这句话" onClick={() => onEdit(message)}><Pencil size={12} /> 修正 / 拆句</button>
    </div>
  </article>;
});

/** Completed rows retain their object identity; audio levels, timers and answer
 * tokens cannot re-render them. Keep all text mounted for find/edit/selection. */
export const TranscriptList = memo(function TranscriptList({messages, selected, multi, answeredIds, onSelect, onEdit}: {
  messages: ConversationMessage[]; selected: string[]; multi: boolean; answeredIds: string;
  onSelect: (id: string) => void; onEdit: (message: ConversationMessage) => void;
}) {
  const answered = useMemo(() => new Set<string>(JSON.parse(answeredIds)), [answeredIds]);
  const selection = useMemo(() => new Set(selected), [selected]);
  return messages.map(message => <Bubble key={message.id} message={message} multi={multi}
    selected={selection.has(message.id)} answered={answered.has(message.id)} onSelect={onSelect} onEdit={onEdit} />);
});
