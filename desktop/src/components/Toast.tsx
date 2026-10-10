/**
 * Toast 通知 + 确认弹窗（PC 桌面风格）
 */
import {createContext, useContext, useState, useCallback, type ReactNode} from 'react';
import {CheckCircle, XCircle, AlertTriangle, Info} from 'lucide-react';
import {Modal} from './WorkspaceUI';

type ToastType = 'success' | 'error' | 'warning' | 'info';
let _nextId = 0;

interface ToastCtx {
  toast: (msg: string, type?: ToastType) => void;
  confirm: (title: string, msg: string, onOk: () => void) => void;
}

const Ctx = createContext<ToastCtx>({toast: () => {}, confirm: () => {}});
export const useToast = () => useContext(Ctx);

export function ToastProvider({children}: {children: ReactNode}) {
  const [items, setItems] = useState<{id: number; msg: string; type: ToastType}[]>([]);
  const [cfm, setCfm] = useState<{title: string; msg: string; onOk: () => void} | null>(null);

  const toast = useCallback((msg: string, type: ToastType = 'info') => {
    const id = _nextId++;
    setItems(p => [...p, {id, msg, type}]);
    setTimeout(() => setItems(p => p.filter(t => t.id !== id)), 3000);
  }, []);

  const confirm = useCallback(
    (title: string, msg: string, onOk: () => void) => setCfm({title, msg, onOk}),
    [],
  );

  const icons = {success: CheckCircle, error: XCircle, warning: AlertTriangle, info: Info};
  const colors = {
    success: 'border-emerald-500',
    error: 'border-red-500',
    warning: 'border-amber-500',
    info: 'border-zinc-400',
  };

  return (
    <Ctx.Provider value={{toast, confirm}}>
      {children}
      {/* Toast */}
      <div
        className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none"
        role="status"
        aria-live="polite">
        {items.map(t => {
          const I = icons[t.type];
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium animate-[fadeIn_200ms_ease-out] max-w-sm border-l-4 ${colors[t.type]}
                bg-white dark:bg-[#1a1a1e] text-zinc-800 dark:text-zinc-200`}>
              <I className="w-4 h-4 shrink-0" strokeWidth={2} />
              {t.msg}
            </div>
          );
        })}
      </div>
      {cfm && (
        <Modal title={cfm.title} onClose={() => setCfm(null)}>
          <p className="muted small" style={{lineHeight: 1.8}}>
            {cfm.msg}
          </p>
          <div className="form-actions">
            <button className="btn" onClick={() => setCfm(null)}>
              取消
            </button>
            <button
              className={`btn ${/删除|清除/.test(cfm.title) ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => {
                cfm.onOk();
                setCfm(null);
              }}>
              确定
            </button>
          </div>
        </Modal>
      )}
    </Ctx.Provider>
  );
}
