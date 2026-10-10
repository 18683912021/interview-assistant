import {useEffect, useState} from 'react';

type Permissions = Awaited<ReturnType<NonNullable<Window['electronAPI']>['audio']['getPermissions']>>;
const labels: Record<Permissions['microphone'], string> = {
  granted: '已允许', denied: '未允许', restricted: '受系统限制',
  'not-determined': '尚未授权', unknown: '状态未知', unsupported: '不适用',
};

/** Read-only status; opening a panel never grants an OS permission. */
export function AudioPermissions({onlyBlocked = false, systemRequired = true}: {
  onlyBlocked?: boolean; systemRequired?: boolean;
}) {
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [error, setError] = useState('');
  const [requesting, setRequesting] = useState<'microphone' | 'screen' | null>(null);
  const api = window.electronAPI?.audio;
  useEffect(() => {
    if (!api?.getPermissions || !/Mac/i.test(navigator.userAgent)) return;
    let active = true;
    const refresh = () => void api.getPermissions().then(value => {
      if (active) setPermissions(value);
    }).catch(() => { if (active) setError('无法读取系统权限，请重启客户端后重试。'); });
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [api]);
  if (!permissions || permissions.platform !== 'darwin')
    return error && !onlyBlocked ? <p className="notice" role="status">{error}</p> : null;
  const rows = [
    {kind: 'microphone' as const, name: '麦克风', status: permissions.microphone},
    ...(systemRequired ? [{kind: 'screen' as const, name: '屏幕与系统音频录制', status: permissions.screen}] : []),
  ].filter(row => !onlyBlocked || row.status !== 'granted');
  if (!rows.length) return null;
  return (
    <div className="audio-permissions" aria-label="macOS 音频权限">
      {rows.map(row => (
        <div className="setting-row" key={row.kind}>
          <span>{row.name}<small>{labels[row.status]}</small></span>
          <button className="btn" type="button" disabled={requesting !== null} onClick={async () => {
            setError('');
            setRequesting(row.kind);
            try {
              if (row.status === 'granted') await api?.openPrivacySettings(row.kind);
              else if (api) setPermissions(await api.requestPermission(row.kind));
            } catch {
              setError('权限申请未完成，请重试；也可以在系统设置的「隐私与安全性」中允许本应用。');
            } finally { setRequesting(null); }
          }}>{requesting === row.kind ? '正在申请…' : row.status === 'granted' ? '查看权限' : '申请权限'}</button>
        </div>
      ))}
      {rows.some(row => row.status !== 'granted') && (
        <p className="notice">允许「AI面试助手」后，请完全退出并重新打开应用。若更新后原来的开关已开启但仍显示未允许，请在系统设置中重新确认授权。</p>
      )}
      {error && <p className="notice" role="status">{error}</p>}
    </div>
  );
}
