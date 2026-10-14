import {forwardRef, useCallback, useEffect, useImperativeHandle, useState} from 'react';
import {Check, Circle, ScanText} from 'lucide-react';
import {messageOf} from '../utils/error-message';

export type ScreenReadinessHandle = {ensure: (request: boolean) => Promise<boolean>};
type Props = {enabled: boolean; requiredForAudio: boolean; busy: boolean; onBusy?: (busy: boolean) => void; onEnabled: (enabled: boolean) => void; onReady: (ready: boolean) => void};

/** Mounted only before a session starts. Live screenshot controls never open OS authorization. */
export const ScreenReadiness = forwardRef<ScreenReadinessHandle, Props>(function ScreenReadiness({enabled, requiredForAudio, busy, onBusy, onEnabled, onReady}, ref) {
  const api = window.electronAPI?.audio;
  const required = enabled || requiredForAudio;
  const [ready, setReady] = useState(false), [working, setWorking] = useState(false), [error, setError] = useState('');
  const [isMac, setIsMac] = useState(false), [canRepair, setCanRepair] = useState(false);
  const refresh = useCallback(async () => {
    if (!api?.getPermissions) return false;
    const permissions = await api.getPermissions();
    const allowed = permissions.platform !== 'darwin' || permissions.screen === 'granted';
    setIsMac(permissions.platform === 'darwin'); setCanRepair(permissions.canRepairScreenPermission);
    if (allowed) setError('');
    setReady(allowed); onReady(!required || allowed);
    return allowed;
  }, [api, required, onReady]);
  useEffect(() => {
    const read = () => {void refresh().catch(() => {setReady(false); onReady(!required);});};
    read(); window.addEventListener('focus', read);
    return () => window.removeEventListener('focus', read);
  }, [refresh, required, onReady]);
  useImperativeHandle(ref, () => ({ensure: async request => {
    if (!required) return true;
    setError('');
    try {
      if (await refresh()) return true;
      if (request && api) {await api.requestPermission('screen'); if (await refresh()) return true;}
      setError('请先完成录屏授权，再开始面试。已开启仍不可用时，可在下方重新申请旧授权。');
    } catch (error) {setError(messageOf(error));}
    return false;
  }}), [api, required, refresh]);
  const action = async (task: () => Promise<unknown>) => {
    setWorking(true); onBusy?.(true); setError('');
    try {await task(); await refresh();} catch (error) {setError(messageOf(error));}
    finally {setWorking(false); onBusy?.(false);}
  };
  return <div className={`audio-readiness-row ${required && ready ? 'is-ready' : ''}`}>
    <div className="audio-readiness-heading"><ScanText size={17} /><strong>截图识题</strong>
      <button type="button" role="switch" aria-label="启用截图识题" aria-checked={enabled} disabled={busy || working}
        className="audio-source-switch" onClick={() => onEnabled(!enabled)}><span /></button>
    </div>
    <div className="audio-readiness-status" role="status">{ready ? <Check size={14} /> : <Circle size={12} />}
      <span>{required ? ready ? isMac ? '录屏权限已就绪' : '截图已就绪' : '录屏权限待检查' : '本场未启用'}</span>
    </div>
    <p>{requiredForAudio ? '系统音频与截图共用录屏授权，请在共享屏幕前完成。' : '按需截取题目，本机识别。需要截图时，请在共享屏幕前完成授权。'}</p>
    {error && <p className="field-error" role="alert">{error}</p>}
    {required && isMac && <details className="permission-help">
      <summary>已开启权限，仍显示未就绪？</summary>
      <p>更新前的授权可能仍绑定旧版本。重新申请只清除本应用的旧录屏授权，随后需你允许当前版本；不会清理其他应用权限或面试数据。</p>
      {canRepair && <button type="button" className="btn" disabled={busy || working} onClick={() => void action(() => api!.repairScreenPermission())}>重新申请录屏权限</button>}
      <button type="button" className="btn btn-quiet" disabled={busy || working} onClick={() => void action(() => window.electronAPI!.window.restartApp())}>已授权，重启应用</button>
    </details>}
  </div>;
});
