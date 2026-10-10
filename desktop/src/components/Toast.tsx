import {IconButton} from './IconButton';
import {createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode} from 'react';
import {CheckCircle, XCircle, AlertTriangle, Info, X, LoaderCircle} from 'lucide-react';
import {ErrorState, Modal} from './WorkspaceUI';
import {messageOf} from '../api/client';

type ToastType = 'success' | 'error' | 'warning' | 'info';
type ToastItem = {id: number; msg: string; type: ToastType};
type Confirmation = {title: string; msg: string; onOk: () => void | Promise<void>};
interface ToastCtx {
  toast: (msg: string, type?: ToastType) => void;
  confirm: (title: string, msg: string, onOk: Confirmation['onOk']) => void;
}
const Ctx = createContext<ToastCtx>({toast: () => {}, confirm: () => {}});
export const useToast = () => useContext(Ctx);
const icons = {success: CheckCircle, error: XCircle, warning: AlertTriangle, info: Info};

function ToastMessage({item, dismiss}: {item: ToastItem; dismiss: (id: number) => void}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (hovered || focused) return;
    const timer = setTimeout(() => dismiss(item.id), item.type === 'error' || item.type === 'warning' ? 8000 : 4000);
    return () => clearTimeout(timer);
  }, [item, hovered, focused, dismiss]);
  const Icon = icons[item.type];
  return (
    <div className={`toast-message toast-${item.type}`} role={item.type === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={event => {if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);}}>
      <Icon size={17} aria-hidden="true" /><span>{item.msg}</span>
      <IconButton className="icon-btn" aria-label="关闭提示" onClick={() => dismiss(item.id)}><X size={14} /></IconButton>
    </div>
  );
}

export function ToastProvider({children}: {children: ReactNode}) {
  const nextId = useRef(0);
  const [items, setItems] = useState<ToastItem[]>([]);
  const [cfm, setCfm] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const toast = useCallback((msg: string, type: ToastType = 'info') => {
    const id = nextId.current++;
    setItems(previous => [...previous.filter(item => item.msg !== msg), {id, msg, type}].slice(-3));
  }, []);
  const dismiss = useCallback((id: number) => setItems(items => items.filter(item => item.id !== id)), []);
  const confirm = useCallback((title: string, msg: string, onOk: Confirmation['onOk']) => {
    if (submitting.current) return;
    setError('');
    setCfm({title, msg, onOk});
  }, []);
  const accept = async () => {
    if (!cfm || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {await cfm.onOk(); setCfm(null);}
    catch (error) {setError(messageOf(error));}
    finally {submitting.current = false; setBusy(false);}
  };
  const destructive = !!cfm && /删除|清空|清除|放弃/.test(cfm.title);
  const action = cfm?.title.includes('删除') ? '删除' : /清空|清除/.test(cfm?.title || '') ? '清空' : cfm?.title.includes('放弃') ? '放弃修改' : cfm?.title.includes('结束') ? '结束面试' : '确认';
  return (
    <Ctx.Provider value={{toast, confirm}}>
      {children}
      <div className="toast-stack">{items.map(item => <ToastMessage key={item.id} item={item} dismiss={dismiss} />)}</div>
      {cfm && (
        <Modal title={cfm.title} onClose={() => setCfm(null)} busy={busy}>
          <p className="confirmation-copy">{cfm.msg}</p>
          {error && <ErrorState message={error} />}
          <div className="form-actions">
            <button className="btn" data-autofocus disabled={busy} onClick={() => setCfm(null)}>取消</button>
            <button className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={() => void accept()}>
              {busy && <LoaderCircle className="spin" size={15} />}{busy ? '正在处理…' : action}
            </button>
          </div>
        </Modal>
      )}
    </Ctx.Provider>
  );
}
