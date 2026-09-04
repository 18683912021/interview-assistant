/**
 * 系统托盘
 */
import { Tray, Menu, nativeImage, app } from 'electron';

let tray: Tray | null = null;

export function createTray(): Tray {
  // 用 16x16 透明图标作为托盘图标（Electron 会在 Windows 渲染为纯色）
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('AI 面试助手');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: async () => {
        const { BrowserWindow } = await import('electron');
        const wins = BrowserWindow.getAllWindows();
        if (wins.length > 0) wins[0]?.show();
      },
    },
    {
      label: '切换浮窗',
      click: async () => {
        const mod = await import('./windows/overlay-window.js');
        const overlay = mod.getOverlayWindow();
        if (overlay) mod.destroyOverlayWindow();
        else mod.createOverlayWindow();
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', async () => {
    const { BrowserWindow } = await import('electron');
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) wins[0]?.show();
  });

  return tray;
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
