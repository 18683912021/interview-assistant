import { Tray, nativeImage } from 'electron';

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
  // OS tray tooltips are not covered by BrowserWindow content protection.
  tray.setToolTip('');
  // A native context menu is a separate unprotected OS surface. Restore the
  // protected window directly; hide/quit actions live in its DOM toolbar.
  tray.on('click', showMainWindow);
  tray.on('right-click', showMainWindow);
  tray.on('double-click', showMainWindow);
  return tray;
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
