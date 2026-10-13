import {ipcMain, type BrowserWindow, type IpcMainEvent} from 'electron';
import {randomUUID} from 'node:crypto';

/** Keep the renderer alive while its latest draft reaches atomic IPC storage. */
export function drainRenderer(window: BrowserWindow | null): Promise<boolean> {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return Promise.resolve(true);
  const request = randomUUID();
  return new Promise(resolve => {
    const finish = (saved: boolean) => {
      clearTimeout(timer);
      ipcMain.removeListener('window:quit-ready', ready);
      resolve(saved);
    };
    const ready = (event: IpcMainEvent, id: unknown, saved: unknown) => {
      if (event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && id === request) finish(saved === true);
    };
    const timer = setTimeout(() => {
      console.warn('[window] Renderer shutdown timed out; retaining last saved draft.');
      finish(false);
    }, 4000);
    ipcMain.on('window:quit-ready', ready);
    window.webContents.send('window:prepare-quit', request);
  });
}
