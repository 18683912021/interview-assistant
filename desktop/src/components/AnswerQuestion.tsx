import {useEffect, useRef, useState} from 'react';
import {Pencil, RotateCcw} from 'lucide-react';

export function AnswerQuestion({question, edited = false, editable, generating, onGenerate, onEditingChange}: {
  question: string;
  edited?: boolean;
  editable: boolean;
  generating: boolean;
  onGenerate: (question: string) => boolean;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(question);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {if (editing && editable) input.current?.focus();}, [editing, editable]);
  useEffect(() => {
    onEditingChange?.(editing && editable);
    return () => onEditingChange?.(false);
  }, [editing, editable, onEditingChange]);
  const open = () => {setDraft(question); setError(''); setEditing(true);};
  const generate = () => {
    if (submitting.current || !editable) return;
    const value = draft.trim();
    if (!value || value.length > 16000) {
      setError(!value ? '请填写问题后再生成。' : '问题最多 16000 字，请精简后再生成。');
      input.current?.focus();
      return;
    }
    submitting.current = true;
    try {
      if (onGenerate(value)) {setEditing(false); setError('');}
      else setError('暂时无法生成，请确认面试尚未结束、关联对话仍存在后重试。');
    } finally {submitting.current = false;}
  };
  return <section className="answer-question-block" aria-label="本次回答的问题">
    <div className="answer-question-heading">
      <span>本次问题{edited ? ' · 已编辑' : ''}</span>
      {editable && !editing && <button type="button" className="btn btn-quiet" onClick={open}>
        <Pencil size={13} />编辑问题
      </button>}
    </div>
    {editing && editable ? <form className="answer-question-editor" onSubmit={event => {event.preventDefault(); generate();}}>
      <label htmlFor="answer-question-input" className="sr-only">编辑本次问题</label>
      <textarea id="answer-question-input" ref={input}
        rows={4} value={draft} aria-invalid={!!error}
        aria-describedby={error ? 'answer-question-error' : 'answer-question-hint'}
        onChange={event => {setDraft(event.target.value); setError('');}}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') {event.preventDefault(); setEditing(false);}
          else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {event.preventDefault(); generate();}
        }} />
      {error && <p id="answer-question-error" className="field-error" role="alert">{error}</p>}
      <p id="answer-question-hint" className="muted small">{generating ? '提交后停止当前生成，按新问题重新回答。' : ''}原始对话和旧答案会保留。</p>
      <div className="answer-question-actions">
        <button type="button" className="btn" onClick={() => {setEditing(false); setError('');}}>取消</button>
        <button type="submit" className="btn btn-primary"><RotateCcw size={14} />重新生成</button>
      </div>
    </form> : <div className="answer-question">{question}</div>}
  </section>;
}
