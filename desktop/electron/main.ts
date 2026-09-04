/**
 * Electron 主进程入口
 *
 * 职责：BrowserWindow 生命周期、ContentProtection、IPC 路由注册
 */
import { app, BrowserWindow } from 'electron';
import { createMainWindow, allowMediaPermissions } from './windows/main-window.js';
import { destroyOverlayWindow } from './windows/overlay-window.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { createTray, destroyTray } from './tray.js';
import { cleanupStaleFiles } from './file-convert/downloader.js';

let mainWindow: BrowserWindow | null = null;

function bootstrap(): void {
  // 清理上次残留的临时文件
  cleanupStaleFiles();

  // 麦克风权限（renderer getUserMedia 必需）
  allowMediaPermissions();

  registerIpcHandlers();

  // 系统托盘
  createTray();

  // 创建主窗口
  mainWindow = createMainWindow();

  // overlay 浮窗按需创建，不自动弹出。用户通过 Ctrl+B 或 IPC 手动切换。
}

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  destroyOverlayWindow();
  destroyTray();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    bootstrap();
  }
});

export { mainWindow };
