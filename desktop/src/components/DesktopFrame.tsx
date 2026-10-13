import {useEffect, useState, type ReactNode} from 'react';
import {EyeOff, Power, Shield, LoaderCircle} from 'lucide-react';
import {useLocation} from 'react-router-dom';
import {Modal} from './WorkspaceUI';
import {useToast} from './Toast';
import {messageOf} from '../api/client';
import {prepareAppShutdown} from '../services/app-shutdown';

export function DesktopFrame({children}: {children: ReactNode}) {
  const api = window.electronAPI?.window;
  const overlay = useLocation().pathname === '/overlay';
  const [privacy, setPrivacy] = useState<Awaited<ReturnType<NonNullable<typeof api>['getPrivacy']>> | null>(null);
  const [details, setDetails] = useState(false);
  const [quitting, setQuitting] = useState(false);
  const {toast} = useToast();
  useEffect(() => {
    if (!api || overlay) return;
    void api.getPrivacy().then(setPrivacy).catch(() => {});
    const off = api.onPrepareQuit(async () => {
      setQuitting(true);
      await prepareAppShutdown();
    });
    const cancel = api.onQuitCancelled(() => setQuitting(false));
    return () => {off(); cancel();};
  }, [api, overlay]);
  if (!api || overlay) return children;
  const hide = async () => {
    try { await api.hideAll(); } catch (error) { toast(messageOf(error), 'error'); }
  };
  const quit = async () => {
    setQuitting(true);
    try { await api.quitApp(); }
    catch (error) { setQuitting(false); toast(messageOf(error), 'error'); }
  };
  return (
    <div className="desktop-frame">
      <div className="desktop-window-bar" aria-label="窗口操作">
        <button className="desktop-privacy" onClick={() => setDetails(true)}>
          <Shield size={14} />共享保护<span className="muted"> · 查看说明</span>
        </button>
        <div className="desktop-window-actions">
          <button onClick={() => void hide()} disabled={quitting}
            title={`隐藏主窗口和回答浮窗；${privacy?.shortcut ? `${privacy.shortcut} 或` : ''}菜单栏 / 托盘可恢复`}>
            <EyeOff size={14} />隐藏窗口{privacy?.shortcut && <kbd>{privacy.shortcut}</kbd>}
          </button>
          <button onClick={() => void quit()} disabled={quitting} title="停止采集、保存本地面试草稿并退出">
            {quitting ? <LoaderCircle size={14} className="spin" /> : <Power size={14} />}
            {quitting ? '正在保存并退出…' : '退出程序'}
          </button>
        </div>
      </div>
      <div className="desktop-content" inert={quitting || undefined}>{children}</div>
      {details && <Modal title="屏幕共享与窗口保护" onClose={() => setDetails(false)}>
        <div className="privacy-explanation">
          <p>{privacy?.protectionRequested ? '已为主窗口和回答浮窗请求系统窗口保护。' : '暂时无法确认系统窗口保护状态，请先隐藏窗口。'}程序坞 / 任务栏不显示本应用。</p>
          <p>{privacy?.platform === 'darwin'
            ? 'macOS 上，使用 ScreenCaptureKit 的共享或录屏软件仍可能录到窗口。请优先只共享指定的其他应用窗口，并在共享预览中确认。'
            : 'Windows 10 2004 及更新版本支持排除窗口；较早版本可能显示黑块。实际效果取决于共享软件，请先检查共享预览。'}</p>
          <p>“隐藏窗口”会同时隐藏本机上的主窗口与回答浮窗，采集与转写继续。{privacy?.shortcut ? `按 ${privacy.shortcut} 可隐藏或恢复，` : '全局快捷键不可用，'}也可以从菜单栏 / 托盘图标选择“打开主窗口”。</p>
          <p>关闭主窗口或点击“退出程序”会停止采集并退出；未结束的面试保留为本地草稿，下次可恢复。关闭回答浮窗只关闭浮窗。</p>
        </div>
        <div className="modal-actions"><button className="btn primary" onClick={() => setDetails(false)}>知道了</button></div>
      </Modal>}
    </div>
  );
}
