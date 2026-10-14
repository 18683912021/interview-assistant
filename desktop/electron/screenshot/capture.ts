import {app, BrowserWindow, desktopCapturer, ipcMain, nativeImage, screen, systemPreferences, type Display, type WebContents} from 'electron';
import path from 'node:path';
import {cropRegion, type Region} from './geometry.js';
import {LocalOCR} from './local-ocr.js';
import {protectWindow, showPrivateWindow, suspendPrivateWindows} from '../windows/window-privacy.js';

type Selection = {display: Display; region: Region};
const ocr = new LocalOCR();
let active: {id: string; owner: WebContents; controller: AbortController} | null = null;

function abortable<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs = 30_000): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('已取消截图'));
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, value?: T) => {
      clearTimeout(timer); signal.removeEventListener('abort', stop);
      if (error) reject(error); else resolve(value!);
    };
    const stop = () => finish(new Error('已取消截图'));
    const timer = setTimeout(() => finish(new Error('截取屏幕超时，请检查录屏权限后重试。')), timeoutMs);
    signal.addEventListener('abort', stop, {once: true});
    promise.then(value => finish(undefined, value), error => finish(error));
  });
}

/** Nothing is painted until protection is applied. Selection uses no native tooltip/menu. */
function selectRegion(signal: AbortSignal): Promise<Selection | null> {
  return new Promise((resolve, reject) => {
    const windows = new Map<WebContents, {window: BrowserWindow; display: Display}>();
    let settled = false;
    const finish = (result: Selection | null, error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); signal.removeEventListener('abort', cancel);
      screen.removeListener('display-removed', cancel);
      screen.removeListener('display-metrics-changed', cancel);
      ipcMain.removeListener('screenshot:select', selected);
      ipcMain.removeListener('screenshot:cancel-selection', cancelled);
      for (const {window} of windows.values()) if (!window.isDestroyed()) window.destroy();
      windows.clear();
      if (error) reject(error); else resolve(result);
    };
    const cancel = () => finish(null);
    const selected = (event: Electron.IpcMainEvent, region: unknown) => {
      const source = windows.get(event.sender);
      if (!source || event.senderFrame !== event.sender.mainFrame) return;
      try {
        // Revalidate untrusted IPC values even though the selector also enforces a minimum.
        cropRegion(region, source.display.bounds, source.display.bounds);
        finish({display: source.display, region: region as Region});
      } catch (error) {finish(null, error as Error);}
    };
    const cancelled = (event: Electron.IpcMainEvent) => {if (windows.has(event.sender)) cancel();};
    const timer = setTimeout(cancel, 120_000);
    signal.addEventListener('abort', cancel, {once: true});
    screen.on('display-removed', cancel);
    screen.on('display-metrics-changed', cancel);
    ipcMain.on('screenshot:select', selected);
    ipcMain.on('screenshot:cancel-selection', cancelled);
    if (signal.aborted) {cancel(); return;}
    try {
      const displays = screen.getAllDisplays();
      const pointed = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      for (const display of displays) {
        const window = new BrowserWindow({
          ...display.bounds, frame: false, transparent: true, backgroundColor: '#00000000',
          show: false, skipTaskbar: true, hasShadow: false, resizable: false, movable: false,
          minimizable: false, maximizable: false, fullscreenable: false, enableLargerThanScreen: true,
          webPreferences: {preload: path.join(__dirname, 'selector-preload.js'), contextIsolation: true,
            nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false,
            partition: 'screenshot-selection', zoomFactor: 1},
        });
        windows.set(window.webContents, {window, display});
        protectWindow(window);
        window.setAlwaysOnTop(true, 'screen-saver');
        if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, {visibleOnFullScreen: true, skipTransformProcessType: true});
        window.setMenu(null);
        window.on('hide', cancel);
        window.on('closed', cancel);
        window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
        window.webContents.on('will-navigate', event => event.preventDefault());
        window.webContents.on('render-process-gone', () => finish(null, new Error('框选窗口已关闭，请重试。')));
        void window.loadFile(path.join(__dirname, 'selector.html')).then(() => {
          if (settled || window.isDestroyed()) return;
          showPrivateWindow(window);
          if (display.id === pointed.id) window.focus();
        }).catch(() => finish(null, new Error('无法打开框选窗口，请重试。')));
      }
      if (!windows.size) finish(null, new Error('未找到可用屏幕。'));
    } catch {finish(null, new Error('无法打开框选窗口，请重试。'));}
  });
}

async function captureSelection(selection: Selection, signal: AbortSignal): Promise<Buffer> {
  // Wait for the compositor to remove the selector before taking a single frame.
  await abortable(new Promise(resolve => setTimeout(resolve, 100)), signal);
  const displays = screen.getAllDisplays();
  if (!displays.some(display => display.id === selection.display.id)) throw new Error('所选屏幕已断开，请重新截图。');
  const sources = await abortable(desktopCapturer.getSources({types: ['screen'], fetchWindowIcons: false,
    thumbnailSize: {
      width: Math.min(8192, Math.max(...displays.map(d => Math.ceil(d.size.width * d.scaleFactor)))),
      height: Math.min(8192, Math.max(...displays.map(d => Math.ceil(d.size.height * d.scaleFactor)))),
    }}), signal);
  const source = sources.find(item => item.display_id === String(selection.display.id)) ||
    (displays.length === 1 && sources.length === 1 ? sources[0] : undefined);
  if (!source || source.thumbnail.isEmpty()) throw new Error('未能截取屏幕，请检查录屏权限后重试。');
  // Normalize PNG to a 1x image so crop coordinates use actual pixels on Retina/mixed-DPI displays.
  const image = nativeImage.createFromBuffer(source.thumbnail.toPNG());
  const region = cropRegion(selection.region, selection.display.bounds, image.getSize());
  if (region.width * region.height > 16_000_000) throw new Error('选区较大，请只框选题目文字后重试。');
  return image.crop(region).toPNG();
}

export function registerScreenshotIPC(getMainWindow: () => BrowserWindow | null): void {
  const isOwner = (event: Electron.IpcMainInvokeEvent) => {
    const main = getMainWindow();
    return !!main && !main.isDestroyed() && event.sender === main.webContents && event.senderFrame === main.webContents.mainFrame;
  };
  ipcMain.handle('screenshot:recognize', async (event, id: unknown) => {
    if (!isOwner(event) || typeof id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(id))
      return {status: 'error', message: '截图请求无效。'};
    if (active) return {status: 'error', message: '已有截图任务，请先完成或取消。'};
    const controller = new AbortController();
    const current = {id, owner: event.sender, controller}; active = current;
    const signal = controller.signal;
    const cancel = () => controller.abort();
    const progress = (stage: string, percent?: number) => {
      if (!event.sender.isDestroyed() && !signal.aborted) event.sender.send('screenshot:progress', {id, stage, percent});
    };
    event.sender.once('destroyed', cancel);
    let restore: (() => void) | undefined;
    const started = Date.now();
    try {
      if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
        return {status: 'error', permission: true, message: '截图权限未就绪，本场请先输入问题。请在下次面试准备时完成授权；当前不会打开系统授权窗口。'};
      }
      if (signal.aborted) return {status: 'cancelled'};
      ocr.warm();
      restore = suspendPrivateWindows();
      progress('selecting');
      const selection = await selectRegion(signal);
      if (!selection || signal.aborted) return {status: 'cancelled'};
      progress('capturing');
      const image = await captureSelection(selection, signal);
      restore(); restore = undefined;
      if (signal.aborted) return {status: 'cancelled'};
      progress('recognizing');
      const result = await ocr.recognize(image, signal, percent => progress('recognizing', percent));
      if (signal.aborted) return {status: 'cancelled'};
      if (!result.text.trim()) return {status: 'error', message: '没有识别到文字，请放大题目或缩小选区后重试。'};
      if (result.text.length > 16000) return {status: 'error', message: '识别内容超过 16000 字，请分段框选。原问题已保留。'};
      return {status: 'success', ...result, durationMs: Date.now() - started};
    } catch (error) {
      return signal.aborted ? {status: 'cancelled'} : {status: 'error', message: error instanceof Error ? error.message : '截图识别失败，请重试。'};
    } finally {
      restore?.();
      event.sender.removeListener('destroyed', cancel);
      if (signal.aborted) ocr.dispose();
      if (active === current) active = null;
    }
  });
  ipcMain.handle('screenshot:cancel', (event, id: string) => {
    if (isOwner(event) && active?.id === id && active.owner === event.sender) active.controller.abort();
  });
  app.on('before-quit', () => {active?.controller.abort(); ocr.dispose();});
}
