import {useEffect, useId, useRef, useState} from 'react';
import {LoaderCircle, ScanText} from 'lucide-react';
import {messageOf} from '../api/client';

/** Recognition only fills the draft; sending it to the answer service remains explicit. */
export function ScreenshotQuestion({disabled = false, onText, onBusyChange}: {
  disabled?: boolean;
  onText: (text: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const api = window.electronAPI?.screenshot;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const request = useRef<string | null>(null);
  const callbacks = useRef({onText, onBusyChange}); callbacks.current = {onText, onBusyChange};
  const description = useId();
  const stop = () => {
    const id = request.current; request.current = null;
    if (id) void api?.cancel(id).catch(() => {});
    setBusy(false); callbacks.current.onBusyChange?.(false); setStatus('已取消，原问题已保留。');
  };
  useEffect(() => {
    if (!api) return;
    const off = api.onProgress(value => {
      if (value.id !== request.current) return;
      setStatus(value.stage === 'permission' ? '请在系统提示中允许录屏权限…'
        : value.stage === 'selecting' ? '拖动框选题目，Esc 可取消…'
        : value.stage === 'capturing' ? '正在截取选区…'
        : `正在识别题目${value.percent !== undefined ? ` · ${value.percent}%` : '…'}`);
    });
    return () => {
      off();
      const id = request.current; request.current = null;
      if (id) {void api.cancel(id).catch(() => {}); callbacks.current.onBusyChange?.(false);}
    };
  }, [api]);
  useEffect(() => {if (disabled && request.current) stop();}, [disabled]);
  if (!api) return null;
  const capture = async () => {
    if (disabled || request.current) return;
    const id = crypto.randomUUID(); request.current = id;
    setBusy(true); callbacks.current.onBusyChange?.(true);
    setError(''); setStatus('准备框选…');
    try {
      const result = await api.recognize(id);
      if (request.current !== id) return;
      if (result.status === 'success') {
        callbacks.current.onText(result.text);
        setStatus('已填入识别结果，请核对文字、代码缩进与符号后生成。');
      } else if (result.status === 'cancelled') setStatus('已取消，原问题已保留。');
      else {setError(result.message); setStatus('');}
    } catch (err) {if (request.current === id) {setError(messageOf(err)); setStatus('');}}
    finally {
      if (request.current === id) {
        request.current = null; setBusy(false); callbacks.current.onBusyChange?.(false);
      }
    }
  };
  return <div className="screenshot-question">
    <div className="screenshot-question-controls">
      <button type="button" className="btn btn-quiet" disabled={disabled || busy} onClick={() => void capture()} aria-describedby={description}>
        {busy ? <LoaderCircle size={14} className="spin" /> : <ScanText size={14} />}截图识别
      </button>
      {busy && <button type="button" className="btn btn-quiet" onClick={stop}>取消识别</button>}
      <span id={description} className="muted small">框选题目 · 本机识别</span>
    </div>
    {status && <p className="muted small" role="status">{status}</p>}
    {error && <p className="field-error" role="alert">{error}</p>}

  </div>;
}
