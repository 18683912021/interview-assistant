import {useEffect, useRef, useState, type ReactNode} from 'react';
import {AlertCircle, LoaderCircle, X} from 'lucide-react';
export function Loading({text = '正在加载…'}: {text?: string}) {
  return (
    <div className="empty-state" role="status">
      <LoaderCircle className="spin" size={22} />
      <p>{text}</p>
    </div>
  );
}
export function ErrorState({message, retry}: {message: string; retry?: () => void}) {
  return (
    <div className="error-state" role="alert">
      <AlertCircle size={19} />
      <span>{message}</span>
      {retry && (
        <button className="btn" onClick={retry}>
          重试
        </button>
      )}
    </div>
  );
}
export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (
      dialog.current?.querySelector<HTMLElement>(
        'input:not(:disabled),textarea:not(:disabled),select:not(:disabled)',
      ) || dialog.current?.querySelector<HTMLElement>('button')
    )?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={e => {
        if (!busy && e.target === e.currentTarget) onClose();
      }}>
      <div
        className="modal"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={e => {
          if (e.key === 'Escape' && !busy) onClose();
          if (e.key === 'Tab') {
            const items = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
              ) || []),
            ].filter(el => el.getClientRects().length);
            const first = items[0],
              last = items.at(-1);
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function dateLabel(value: number | string) {
  return new Date(value).toLocaleDateString('zh-CN', {month: '2-digit', day: '2-digit'});
}
export function durationLabel(seconds: number) {
  const m = Math.floor(seconds / 60);
  return m ? `${m} 分钟` : `${Math.round(seconds)} 秒`;
}

export function ProfileAvatar({
  name,
  avatar,
  large = false,
}: {
  name: string;
  avatar?: string;
  large?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [avatar]);
  const image = !!avatar && /^(https?:\/\/|data:image\/)/.test(avatar);
  return (
    <span className={`avatar ${large ? 'large' : ''}`}>
      {image && !failed ? (
        <img src={avatar} alt="" onError={() => setFailed(true)} />
      ) : !image && avatar ? (
        avatar
      ) : (
        name.slice(0, 1)
      )}
    </span>
  );
}
