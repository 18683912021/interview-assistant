/**
 * 主窗口
 *
 * 双栏面试工作台的 React 渲染进程宿主，管理窗口尺寸与本机媒体权限。
 */
import {BrowserWindow, app} from 'electron';
import path from 'path';
import {protectWindow, showPrivateWindow} from './window-privacy.js';
export {allowMediaPermissions} from '../audio/media-permissions.js';

const isDev = !app.isPackaged;

function getPreloadPath(): string {
  return path.join(__dirname, '..', 'preload.js');
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
    skipTaskbar: true,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Live transcript/answer updates must continue while another meeting window is focused.
      backgroundThrottling: false,
    },
  });

  protectWindow(win);
  win.once('ready-to-show', () => {
    showPrivateWindow(win);
  });

  if (isDev) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5173');
  } else {
    // Electron escapes drive letters, spaces, # and non-ASCII installation paths.
    win.loadFile(path.join(__dirname, '..', '..', 'dist-renderer', 'index.html'));
  }

  if (isDev) {
    win.webContents.openDevTools({mode: 'detach'});
  }

  return win;
}
