/**
 * 主窗口
 *
 * 三栏布局的 React 渲染进程宿主。整个窗口应用 ContentProtection 防止面试官截屏看到 AI 答案。
 */
import { BrowserWindow, app, session } from 'electron';
import path from 'path';

const isDev = !app.isPackaged;

function getPreloadPath(): string {
  return path.join(__dirname, '..', 'preload.js');
}

function getRendererUrl(): string {
  if (isDev) return 'http://localhost:5173';
  return `file://${path.join(__dirname, '..', '..', 'dist-renderer', 'index.html')}`;
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 400,
    title: 'AI 面试助手',
    backgroundColor: '#F7F8FA',
    show: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // ContentProtection 默认关闭，用户手动开关
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.once('ready-to-show', () => { win.show(); });

  // show 后按当前状态重新应用
  // ContentProtection 状态由 IPC handler 管理，show 时不需要重设

  win.loadURL(getRendererUrl());

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  return win;
}

/**
 * 允许渲染进程使用麦克风（面试录音必需）。
 * Electron 默认拒绝 media 权限，不设置则 getUserMedia 永远失败。
 *
 * 大厂主流做法：两个 handler 都实现——
 *  - setPermissionCheckHandler：同步检查阶段（getUserMedia 的规范路径），
 *    只设 request handler 时此处会以默认拒绝收场，导致麦克风静默不可用；
 *  - setPermissionRequestHandler：异步请求阶段。
 * 本地单窗口应用无多 origin 威胁面，'media' 一律放行即可。
 */
export function allowMediaPermissions(): void {
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  // display-capture：macOS 系统音频 getDisplayMedia 请求（SCK 选择器）放行
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture');
  });

  // macOS 系统音频：渲染进程 getDisplayMedia 走 ScreenCaptureKit 系统选择器（macOS 15+）。
  // useSystemPicker=true 时 handler 不会被调用，空回调兜底 macOS 15 以下（授予空流，渲染进程侧报错提示）
  session.defaultSession.setDisplayMediaRequestHandler(
    (_req, callback) => callback({}),
    { useSystemPicker: true },
  );
}
