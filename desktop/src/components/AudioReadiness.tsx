import type {Ref} from 'react';
import {Check, Circle, LoaderCircle, Mic, Monitor, AlertCircle} from 'lucide-react';
import type {AudioPreparationStep} from '../services/capture-preparation';

type Props = {
  source: 'both' | 'mic';
  steps: Partial<Record<'mic' | 'system', AudioPreparationStep>>;
  busy: boolean;
  sectionRef?: Ref<HTMLElement>;
  onSource: (source: 'both' | 'mic') => void;
  onCheck: () => void;
  onCancel: () => void;
  onRestart?: () => void;
  onSettings: (source: 'mic' | 'system') => void;
  isMac: boolean;
};

export function AudioReadiness({source, steps, busy, sectionRef, onSource, onCheck, onCancel, onRestart, onSettings, isMac}: Props) {
  const checked = steps.mic?.status === 'ready' && (source === 'mic' || ['ready', 'quiet'].includes(steps.system?.status || ''));
  const checking = Object.values(steps).some(step => step.status === 'checking');
  return <section className="audio-readiness" ref={sectionRef} tabIndex={-1} aria-label="面试音频准备">
    <h2>02 / 音频准备</h2>
    <p className="audio-readiness-intro">首次使用需要系统授权。点击开始也会自动检查，不用提前去系统里找。</p>
    {(['mic', 'system'] as const).map(kind => {
      const enabled = kind === 'mic' || source === 'both';
      const step = enabled ? steps[kind] : undefined;
      const status = step?.status || 'idle';
      const label = {idle: '待检查', checking: '正在检查', ready: '已就绪', quiet: '设备已响应', error: '需要处理'}[status];
      const Icon = kind === 'mic' ? Mic : Monitor;
      return <div className={`audio-readiness-row is-${status}${enabled ? '' : ' is-off'}`} key={kind}>
        <div className="audio-readiness-heading">
          <Icon size={17} />
          <strong>{kind === 'mic' ? '麦克风' : '系统音频'}</strong>
          {kind === 'mic' ? <span className="audio-required">必需</span> : <button type="button" role="switch"
            aria-label="采集系统音频" aria-checked={enabled} disabled={busy} className="audio-source-switch"
            onClick={() => onSource(enabled ? 'mic' : 'both')}><span /></button>}
        </div>
        <div className="audio-readiness-status" role={status === 'error' ? 'alert' : 'status'}>
          {status === 'checking' ? <LoaderCircle size={14} className="spin" />
            : status === 'ready' ? <Check size={14} /> : status === 'error' ? <AlertCircle size={14} /> : <Circle size={12} />}
          <span>{enabled ? label : '未启用'}</span>
        </div>
        <p>{!enabled ? '仅记录麦克风声音；适合练习或手动输入问题。' : step?.message ||
          (kind === 'mic' ? '用于记录你的回答，首次检查时请在系统弹框中点“允许”。' : '用于记录电脑播放的面试官声音。Mac 自检会自动播放一声短测试音，无需手动播放；仅在本机检查。')}</p>
        {status === 'error' && <div className="audio-readiness-actions">
          <button type="button" className="link-button" disabled={busy} onClick={() => onSettings(kind)}>{isMac ? '打开系统权限设置' : '检查音频设备'}</button>
          {kind === 'system' && <button type="button" className="link-button" disabled={busy} onClick={() => onSource('mic')}>先用麦克风</button>}
        </div>}
      </div>;
    })}
    <button type="button" className="btn audio-check" onClick={onCheck} disabled={busy}>
      {busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
      {busy ? checking ? '请按上方提示完成检查…' : '正在准备面试…' : checked ? '重新检查音频' : '授权并检查音频'}
    </button>
    {busy && checking && <button type="button" className="link-button audio-check-cancel" onClick={onCancel}>取消检查</button>}
    {isMac && onRestart && Object.values(steps).some(step => ['error', 'quiet'].includes(step.status)) && <details className="permission-help">
      <summary>已授权，仍无法使用？</summary>
      <p>系统权限变更后可能需要重启应用。请确认允许的是「应用程序」中的当前版本，再重新检测。</p>
      <button type="button" className="btn" disabled={busy} onClick={onRestart}>已授权，重启应用</button>
    </details>}
    <small>检查只在本机进行，不保存、不上传录音；开始面试后才转写。</small>
  </section>;
}
