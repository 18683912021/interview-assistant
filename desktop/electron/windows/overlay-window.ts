/**
 * AI 浮窗（独立窗口）
 *
 * 透明无边框、始终置顶，支持滚动回答、拖动标题栏和关闭。
 */
import {BrowserWindow, app} from 'electron';
import path from 'path';
import {protectWindow, showPrivateWindow} from './window-privacy.js';

const isDev = !app.isPackaged;

let overlayWindow: BrowserWindow | null = null;

export function createOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  overlayWindow = new BrowserWindow({
    width: 360,
    height: 520,
    // Transparent frameless windows do not reliably resize on Windows (Electron
    // custom-window-styles limitations). Keep the existing macOS appearance.
    transparent: process.platform !== 'win32',
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    resizable: true,
    backgroundColor: process.platform === 'win32' ? '#F7F8FA' : '#00000000',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      // OS spelling suggestion popups are outside the protected window.
      spellcheck: false,
      nodeIntegration: false,
      sandbox: false,
      // Live transcript/answer updates must continue while another meeting window is focused.
      backgroundThrottling: false,
    },
  });

  protectWindow(overlayWindow);
  const window = overlayWindow;
  window.once('ready-to-show', () => showPrivateWindow(window));
  overlayWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true,
  });
  // The answer scroll area and close button must receive normal pointer input.
  overlayWindow.setIgnoreMouseEvents(false);

  if (isDev) {
    overlayWindow.loadURL(
      `${process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5173'}/#/overlay`,
    );
  } else {
    overlayWindow.loadFile(path.join(__dirname, '..', '..', 'dist-renderer', 'index.html'), {
      hash: '/overlay',
    });
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
