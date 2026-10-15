import {IconButton} from './IconButton';
import {useEffect, useState, type ReactNode} from 'react';
import {EyeOff, Power, Shield, LoaderCircle, Pin, PinOff, Smartphone, Maximize2} from 'lucide-react';
import {useLocation} from 'react-router-dom';
import {Modal} from './WorkspaceUI';
import {useToast} from './Toast';
import {messageOf} from '../api/client';
import {isInterviewActive, onInterviewActiveChange} from '../utils/interviewState';
import {prepareAppShutdown} from '../services/app-shutdown';
import {WindowModeContext} from '../utils/WindowModeContext';

export function DesktopFrame({children}: {children: ReactNode}) {
  const api = window.electronAPI?.window;
  const pathname = useLocation().pathname;
  const overlay = pathname === '/overlay';
  const [active, setActive] = useState(isInterviewActive);
  const [mode, setMode] = useState({compact: false, pinned: false, alwaysOnTop: false});
  const [switching, setSwitching] = useState(false);
  useEffect(() => onInterviewActiveChange(setActive), []);
  const [privacy, setPrivacy] = useState<Awaited<ReturnType<NonNullable<typeof api>['getPrivacy']>> | null>(null);
  const [details, setDetails] = useState(false);
  const [quitting, setQuitting] = useState(false);
  const {toast} = useToast();
  useEffect(() => {
    if (!api || overlay) return;
    void api.getMode().then(setMode).catch(() => {});
    const offMode = api.onModeChanged(setMode);
    void api.getPrivacy().then(setPrivacy).catch(() => {});
    const off = api.onPrepareQuit(async () => {
      setQuitting(true);
      await prepareAppShutdown();
    });
    const cancel = api.onQuitCancelled(() => setQuitting(false));
    return () => {off(); cancel(); offMode();};
  }, [api, overlay]);
  useEffect(() => {
    if (!api || !mode.compact || pathname === '/interview') return;
    void api.setCompact(false).then(setMode).catch(error => toast(messageOf(error), 'error'));
  }, [api, mode.compact, pathname, toast]);
  if (!api || overlay) return children;
  const changeMode = async (compact: boolean) => {
    if (switching) return;
    setSwitching(true);
    try {setMode(await api.setCompact(compact));}
    catch (error) {toast(messageOf(error), 'error');}
    finally {setSwitching(false);}
  };
  const pin = async () => {
    if (switching) return;
    setSwitching(true);
    try {setMode(await api.setAlwaysOnTop(!mode.pinned));}
    catch (error) {toast(messageOf(error), 'error');}
    finally {setSwitching(false);}
  };
  const hide = async () => {
    try { await api.hideAll(); } catch (error) { toast(messageOf(error), 'error'); }
  };
  const quit = async () => {
    setQuitting(true);
    try { await api.quitApp(); }
    catch (error) { setQuitting(false); toast(messageOf(error), 'error'); }
  };
  return (
    <WindowModeContext.Provider value={mode}><div className={`desktop-frame${mode.compact ? ' is-compact' : ''}`}>
      <div className="desktop-window-bar" aria-label="窗口操作">
        <button className="desktop-privacy" onClick={() => setDetails(true)}>
          <Shield size={14} />共享保护<span className="muted"> · 查看说明</span>
        </button>
        <div className="desktop-window-actions">
          {(mode.compact || (active && pathname === '/interview')) && <IconButton
            onClick={() => void changeMode(!mode.compact)} disabled={switching || quitting}
            aria-label={mode.compact ? '恢复大窗口' : '小窗口模式'} aria-pressed={mode.compact}
            title={mode.compact ? '恢复之前的窗口尺寸和置顶状态' : '竖屏小窗口，自动置顶；继续当前采集与回答'}>
            {switching ? <LoaderCircle size={14} className="spin" /> : mode.compact ? <Maximize2 size={14} /> : <Smartphone size={14} />}
            <span>{mode.compact ? '恢复大窗' : '小窗口'}</span>
          </IconButton>}
          <IconButton onClick={() => void pin()} disabled={mode.compact || switching || quitting}
            aria-pressed={mode.alwaysOnTop} aria-label={mode.compact ? '小窗口自动置顶' : mode.pinned ? '取消置顶' : '窗口置顶'}
            title={mode.compact ? '小窗口始终置顶，恢复大窗后还原原来的置顶选择' : mode.pinned ? '取消窗口置顶' : '置顶显示，Mac 支持在其他应用的全屏空间显示'}>
            {mode.alwaysOnTop ? <Pin size={14} /> : <PinOff size={14} />}<span>{mode.alwaysOnTop ? '已置顶' : '置顶'}</span>
          </IconButton>
          <IconButton onClick={() => void hide()} disabled={quitting} aria-label="隐藏窗口"
            title={`隐藏主窗口和回答浮窗；${privacy?.shortcut ? `${privacy.shortcut} 或` : ''}菜单栏 / 托盘可恢复`}>
            <EyeOff size={14} /><span className="window-action-label">隐藏窗口</span>{privacy?.shortcut && <kbd>{privacy.shortcut}</kbd>}
          </IconButton>
          <IconButton onClick={() => void quit()} disabled={quitting} aria-label={quitting ? '正在保存并退出…' : '退出程序'} title="停止采集、保存本地面试草稿并退出">
            {quitting ? <LoaderCircle size={14} className="spin" /> : <Power size={14} />}
            <span className="window-action-label">{quitting ? '正在保存并退出…' : '退出程序'}</span>
          </IconButton>
        </div>
      </div>
      <div className="desktop-content" inert={quitting || undefined}>{children}</div>
      {details && <Modal title="屏幕共享与窗口保护" onClose={() => setDetails(false)}>
        <div className="privacy-explanation">
          <p>{privacy?.protectionRequested ? '已为主窗口和回答浮窗请求系统窗口保护。' : '暂时无法确认系统窗口保护状态，请先隐藏窗口。'}程序坞 / 任务栏不显示本应用。</p>
          <p>{privacy?.platform === 'darwin'
            ? 'macOS 上，使用 ScreenCaptureKit 的共享或录屏软件仍可能录到窗口。请优先只共享指定的其他应用窗口，并在共享预览中确认。'
            : 'Windows 10 2004 及更新版本支持排除窗口；较早版本可能显示黑块。实际效果取决于共享软件，请先检查共享预览。'}</p>
          <p>按钮提示、下拉菜单和应用内弹窗都在当前窗口内绘制。系统权限弹框、文件选择器和系统菜单属于系统界面，不能保证被窗口保护排除；共享时请使用快捷键隐藏，避免打开这些系统界面。</p>
          <p>截图框选框与操作提示也已请求窗口保护，光标保持普通箭头；同样受上述共享软件限制。截图仅在本机识别为文字，不保存图片、不上传整张屏幕。首次截图的系统录屏授权提示不在保护范围内，建议共享前完成授权并检查预览。</p>
          <p>“隐藏窗口”会同时隐藏本机上的主窗口与回答浮窗，采集与转写继续。{privacy?.shortcut ? `按 ${privacy.shortcut} 可隐藏或恢复，` : '全局快捷键不可用，'}也可以直接点击菜单栏 / 托盘图标恢复主窗口。</p>
          <p>小窗口保留当前面试，自动置顶；恢复大窗口时还原之前的尺寸和置顶选择。Windows 可覆盖普通和最大化窗口，独占全屏及系统安全界面可能无法覆盖。</p>
          <p>关闭主窗口或点击“退出程序”会停止采集并退出；未结束的面试保留为本地草稿，下次可恢复。关闭回答浮窗只关闭浮窗。</p>
        </div>
        <div className="modal-actions"><button className="btn primary" onClick={() => setDetails(false)}>知道了</button></div>
      </Modal>}
    </div></WindowModeContext.Provider>
  );
}
