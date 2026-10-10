import {useEffect, useRef, useState, type ReactNode} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {AlertCircle, LoaderCircle, X} from 'lucide-react';
export function Loading({text = '正在加载…'}: {text?: string}) {
  return (
    <div className="loading-state" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={22} aria-hidden="true" />
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
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  return (
    <Dialog.Root open onOpenChange={open => {if (!open && !busy) onClose();}}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop">
          <Dialog.Content className="modal" ref={dialog} aria-describedby={undefined}
            onEscapeKeyDown={event => {if (busy) event.preventDefault();}}
            onPointerDownOutside={event => {if (busy) event.preventDefault();}}
            onCloseAutoFocus={event => {
              if (opener?.isConnected) {event.preventDefault(); opener.focus();}
            }}
            onOpenAutoFocus={event => {
              const field = dialog.current?.querySelector<HTMLElement>(
                'input:not(:disabled),textarea:not(:disabled),[role="combobox"]:not(:disabled),[data-autofocus]',
              );
              if (field) {event.preventDefault(); field.focus();}
            }}>
            <header>
              <Dialog.Title asChild><h2>{title}</h2></Dialog.Title>
              <Dialog.Close className="icon-btn" disabled={busy} aria-label="关闭弹窗"><X size={18} /></Dialog.Close>
            </header>
            {children}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
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
