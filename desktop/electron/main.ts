/** Electron 主进程入口：初始化应用服务，并管理窗口与采集的生命周期。 */
import { app, BrowserWindow } from 'electron';
import { createMainWindow, allowMediaPermissions } from './windows/main-window.js';
import { destroyOverlayWindow } from './windows/overlay-window.js';
import { flushStorage, registerIpcHandlers } from './ipc-handlers.js';
import { createTray, destroyTray } from './tray.js';
import { audioCapture } from './audio/audio-capture.js';
import { configureSystemAudioCapture } from './audio/media-permissions.js';
import { createApplicationMenu } from './menu.js';

configureSystemAudioCapture();

let mainWindow: BrowserWindow | null = null;
let initialized = false;
let quitting = false;
let readyToQuit = false;
let captureStop: Promise<void> | null = null;
let restartRequested = false;

export function restartApplication(): void {
  if (quitting || restartRequested) return;
  if (audioCapture.getSnapshot().captureState === 'capturing')
    throw new Error('请先暂停面试或停止音频测试，再重启应用。');
  restartRequested = true;
  app.quit();
}

function stopCapture(reason: string): Promise<void> {
  if (!captureStop) {
    // stop() immediately stops native capture; only provider finalization is async.
    captureStop = audioCapture.stop(reason).catch(() => {
      console.warn('[audio] Capture finalization was not confirmed while closing.');
    }).finally(() => { captureStop = null; });
  }
  return captureStop;
}

function showMainWindow(): void {
  if (quitting) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  const window = createMainWindow();
  mainWindow = window;
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = null;
    destroyOverlayWindow();
    void stopCapture('main_window_closed');
  });
}

function initialize(): void {
  if (!initialized) {
    allowMediaPermissions();
    registerIpcHandlers();
    // Keep the app discoverable after its last window is closed on macOS.
    if (process.platform === 'darwin') app.setActivationPolicy('regular');
    createApplicationMenu(showMainWindow);
    createTray(showMainWindow);
    initialized = true;
  }
  showMainWindow();
}

app.whenReady().then(initialize);

app.on('window-all-closed', () => {
  destroyOverlayWindow();
  void stopCapture('all_windows_closed');
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (app.isReady()) initialize();
});

app.on('before-quit', (event) => {
  if (readyToQuit) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  void stopCapture('app_quit').then(flushStorage).finally(() => {
    destroyOverlayWindow();
    destroyTray();
    readyToQuit = true;
    // Native macOS menu quit can flush Promise callbacks before its original
    // before-quit handler returns. A nested quit is then cancelled by that
    // outer preventDefault, leaving a windowless process. Resume on a new turn.
    setImmediate(() => {
      if (restartRequested) app.relaunch();
      app.quit();
    });
  });
});

export { mainWindow };
