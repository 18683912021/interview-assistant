import {BrowserWindow, globalShortcut} from 'electron';

// Apply before first paint, including windows created after the main window.
// This requests OS protection; it cannot prove exclusion by a third-party capturer.
let hidden = false;
let shortcutAvailable = false;
const windows = new Set<BrowserWindow>();
const restoreWindows = new Set<BrowserWindow>();
const accelerator = 'CommandOrControl+Shift+H';

export function protectWindow(window: BrowserWindow): void {
  window.setContentProtection(true);
  windows.add(window);
  window.once('closed', () => {
    windows.delete(window);
    restoreWindows.delete(window);
  });
}

export function showPrivateWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  if (hidden) restoreWindows.add(window);
  else window.show();
}

export function hideWindows(): void {
  hidden = true;
  for (const window of windows) {
    if (window.isVisible() || window.isMinimized()) {
      restoreWindows.add(window);
      window.hide();
    }
  }
}

export function restorePrivateWindows(): void {
  hidden = false;
  for (const window of restoreWindows) {
    if (window.isDestroyed()) continue;
    if (window.isMinimized()) window.restore();
    window.show();
  }
  restoreWindows.clear();
}

export function registerPrivacyShortcut(showMainWindow: () => void): void {
  shortcutAvailable = globalShortcut.register(accelerator, () => {
    if (hidden) showMainWindow();
    else hideWindows();
  });
}

export function unregisterPrivacyShortcut(): void {
  if (shortcutAvailable) globalShortcut.unregister(accelerator);
  shortcutAvailable = false;
}

export function getWindowPrivacy() {
  return {
    platform: process.platform,
    protectionRequested: [...windows].every(window => window.isContentProtected()),
    shortcut: shortcutAvailable ? (process.platform === 'darwin' ? '⌘⇧H' : 'Ctrl+Shift+H') : null,
  };
}
