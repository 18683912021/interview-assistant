import { Tray, Menu, nativeImage, app } from 'electron';
import {hideWindows} from './windows/window-privacy.js';

let tray: Tray | null = null;

/** Small waveform with actual pixels; macOS templates adapt to light/dark menus. */
export function createTrayIcon(): Electron.NativeImage {
  const size = 40;
  const bitmap = Buffer.alloc(size * size * 4);
  const bars: [number, number][] = [[7, 7], [15, 21], [23, 29], [31, 13]];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!bars.some(([center, height]) => {
        const dy = Math.max(0, Math.abs(y - 19.5) - height / 2 + 2);
        return (x - center) ** 2 + dy ** 2 <= 4;
      })) continue;
      const offset = (y * size + x) * 4;
      if (process.platform !== 'darwin') {
        bitmap[offset] = 200; bitmap[offset + 1] = 135; bitmap[offset + 2] = 90;
      }
      bitmap[offset + 3] = 255;
    }
  }
  const icon = nativeImage.createFromBitmap(bitmap, { width: size, height: size, scaleFactor: 2 });
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  return icon;
}

export function createTray(showMainWindow: () => void): Tray {
  if (tray && !tray.isDestroyed()) return tray;
  tray = new Tray(createTrayIcon());
  tray.setToolTip('AI 面试助手');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主窗口', click: showMainWindow },
    { label: '隐藏所有窗口', click: hideWindows },
    { type: 'separator' },
    { label: '退出面试助手', click: () => app.quit() },
  ]));
  // macOS single click opens the menu; Windows also supports double-click.
  tray.on('double-click', showMainWindow);
  return tray;
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
