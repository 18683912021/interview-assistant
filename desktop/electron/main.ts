/** Electron 主进程入口：初始化应用服务，并管理窗口与采集的生命周期。 */
import { app, BrowserWindow, dialog } from 'electron';
import { createMainWindow, allowMediaPermissions } from './windows/main-window.js';
import { destroyOverlayWindow } from './windows/overlay-window.js';
import { flushStorage, registerIpcHandlers } from './ipc-handlers.js';
import { createTray, destroyTray } from './tray.js';
import { audioCapture } from './audio/audio-capture.js';
import { configureSystemAudioCapture } from './audio/media-permissions.js';
import { createApplicationMenu } from './menu.js';
import {registerPrivacyShortcut, restorePrivateWindows, unregisterPrivacyShortcut} from './windows/window-privacy.js';
import {drainRenderer} from './renderer-shutdown.js';

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
  restorePrivateWindows();
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  const window = createMainWindow();
  mainWindow = window;
  window.on('close', event => {
    if (readyToQuit) return;
    // Closing the main window follows the same draining path as the Quit button.
    event.preventDefault();
    app.quit();
  });
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
    if (process.platform === 'darwin') app.setActivationPolicy('accessory');
    createApplicationMenu(showMainWindow);
    createTray(showMainWindow);
    registerPrivacyShortcut(showMainWindow);
    initialized = true;
  }
  showMainWindow();
}

app.whenReady().then(initialize);

app.on('window-all-closed', () => {
  destroyOverlayWindow();
  void stopCapture('all_windows_closed');
  if (!quitting) app.quit();
});

app.on('activate', () => {
  if (app.isReady()) initialize();
});

app.on('before-quit', (event) => {
  if (readyToQuit) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  void (async () => {
    await stopCapture('app_quit');
    const saved = await drainRenderer(mainWindow);
    if (!saved) {
      const result = await dialog.showMessageBox({
        type: 'warning', title: '尚未确认草稿保存',
        message: '最后的面试内容尚未确认保存。',
        detail: '采集已停止。可以返回应用检查记录，或仍然退出并保留上次保存的版本。',
        buttons: ['返回应用', '仍然退出'], defaultId: 0, cancelId: 0,
      });
      if (result.response === 0) {
        quitting = false;
        restartRequested = false;
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('window:quit-cancelled');
        showMainWindow();
        return;
      }
    }
    await flushStorage();
    destroyOverlayWindow();
    destroyTray();
    unregisterPrivacyShortcut();
    readyToQuit = true;
    // Native macOS menu quit can flush Promise callbacks before its original
    // before-quit handler returns. A nested quit is then cancelled by that
    // outer preventDefault, leaving a windowless process. Resume on a new turn.
    setImmediate(() => {
      if (restartRequested) app.relaunch();
      app.quit();
    });
  })();
});

export { mainWindow };
