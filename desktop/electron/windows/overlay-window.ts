/**
 * AI 浮窗（独立窗口）
 *
 * 透明无边框、始终置顶、鼠标穿透、ContentProtection 隐身。
 * 面试官在共享屏幕中看不到此窗口。
 */
import { BrowserWindow, app } from 'electron';
import path from 'path';

const isDev = !app.isPackaged;

let overlayWindow: BrowserWindow | null = null;

export function createOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  overlayWindow = new BrowserWindow({
    width: 360,
    height: 520,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // ContentProtection 默认关闭，用户手动开关
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  // ContentProtection 状态由 IPC handler 管理

  if (isDev) {
    overlayWindow.loadURL('http://localhost:5173/#/overlay');
  } else {
    overlayWindow.loadFile(
      path.join(__dirname, '..', 'dist-renderer', 'index.html'),
      { hash: '/overlay' },
    );
  }

  return overlayWindow;
}

export function destroyOverlayWindow(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
    overlayWindow = null;
  }
}

export function getOverlayWindow(): BrowserWindow | null {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }
  return null;
}
