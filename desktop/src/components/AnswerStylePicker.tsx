import {useId, useRef} from 'react';
import {Check} from 'lucide-react';
import {ANSWER_STYLES, type Settings} from '../api/workspace';

export function AnswerStylePicker({value, onChange, disabled = false, compact = false}: {
  value: Settings['answer_style']; onChange: (value: Settings['answer_style']) => void;
  disabled?: boolean; compact?: boolean;
}) {
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className={`answer-style-picker${compact ? ' compact' : ''}`} role="radiogroup" aria-label="回答方式" aria-disabled={disabled}>
      {ANSWER_STYLES.map((option, index) => (
        <button key={option.value} ref={el => {buttons.current[index] = el;}} type="button" role="radio"
          aria-label={option.label} aria-checked={value === option.value} aria-describedby={compact ? undefined : `${id}-${index}`}
          tabIndex={value === option.value ? 0 : -1} disabled={disabled}
          onClick={() => onChange(option.value)}
          onKeyDown={event => {
            let next = index;
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % ANSWER_STYLES.length;
            else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + ANSWER_STYLES.length - 1) % ANSWER_STYLES.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = ANSWER_STYLES.length - 1;
            else return;
            event.preventDefault();
            buttons.current[next]?.focus();
            onChange(ANSWER_STYLES[next]!.value);
          }}>
          <span className="answer-style-title">{option.label}{value === option.value && !compact && <Check size={14} />}</span>
          {!compact && <small id={`${id}-${index}`}>{option.description}</small>}
        </button>
      ))}
    </div>
  );
}
