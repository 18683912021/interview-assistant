import {EventEmitter} from 'node:events';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  windows: [] as any[], display: {id: 7, bounds: {x: -1440, y: 0, width: 1440, height: 900}, size: {width: 1440, height: 900}, scaleFactor: 2},
  permission: vi.fn(), sources: vi.fn(), crop: vi.fn(), warm: vi.fn(), recognize: vi.fn(), dispose: vi.fn(),
  protect: vi.fn(), restore: vi.fn(), suspend: vi.fn(), events: {} as Record<string, EventEmitter>,
}));
vi.mock('electron', async () => {
  const {EventEmitter: Emitter} = await import('node:events');
  mocks.events = {ipc: new Emitter(), screen: new Emitter(), app: new Emitter()};
  return {
    app: mocks.events.app,
    ipcMain: Object.assign(mocks.events.ipc!, {handle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler)}),
    systemPreferences: {getMediaAccessStatus: mocks.permission},
    desktopCapturer: {getSources: mocks.sources},
    screen: Object.assign(mocks.events.screen!, {getAllDisplays: () => [mocks.display], getDisplayNearestPoint: () => mocks.display, getCursorScreenPoint: () => ({x: -100, y: 100})}),
    nativeImage: {createFromBuffer: () => ({getSize: () => ({width: 2880, height: 1800}), crop: mocks.crop})},
    BrowserWindow: class extends Emitter {
      webContents = Object.assign(new Emitter(), {mainFrame: {}, setWindowOpenHandler: vi.fn()});
      destroyed = false;
      show = vi.fn(() => expect(mocks.protect).toHaveBeenCalledWith(this));
      focus = vi.fn(); setAlwaysOnTop = vi.fn(); setVisibleOnAllWorkspaces = vi.fn(); setMenu = vi.fn();
      loadFile = vi.fn().mockResolvedValue(undefined);
      constructor(public options: unknown) {super(); mocks.windows.push(this);}
      isDestroyed() {return this.destroyed;}
      destroy() {this.destroyed = true; this.emit('closed');}
    },
  };
});
vi.mock('../windows/window-privacy.js', () => ({protectWindow: mocks.protect, suspendPrivateWindows: mocks.suspend,
  showPrivateWindow: (window: any) => window.show()}));
vi.mock('../screenshot/local-ocr.js', () => ({LocalOCR: class {warm = mocks.warm; recognize = mocks.recognize; dispose = mocks.dispose;}}));
const owner = () => Object.assign(new EventEmitter(), {mainFrame: {}, isDestroyed: () => false, send: vi.fn()});
let contents: ReturnType<typeof owner>;
let event: {sender: ReturnType<typeof owner>; senderFrame: object};
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); mocks.handlers.clear(); mocks.windows.length = 0;
  vi.stubGlobal('process', {...process, platform: 'darwin'});
  mocks.permission.mockReturnValue('granted');
  mocks.sources.mockResolvedValue([{display_id: '7', thumbnail: {isEmpty: () => false, toPNG: () => Buffer.from('screen')}}]);
  mocks.crop.mockReturnValue({toPNG: () => Buffer.from('cropped-only')});
  mocks.recognize.mockResolvedValue({text: '识别到的问题', confidence: 90});
  mocks.suspend.mockReturnValue(mocks.restore);
  contents = owner(); event = {sender: contents, senderFrame: contents.mainFrame};
  const {registerScreenshotIPC} = await import('../screenshot/capture');
  registerScreenshotIPC(() => ({webContents: contents, isDestroyed: () => false}) as any);
});
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});
const flush = async () => {for (let i = 0; i < 8; i++) await Promise.resolve();};
const select = () => {
  const sender = mocks.windows[0].webContents;
  mocks.events.ipc!.emit('screenshot:select', {sender, senderFrame: sender.mainFrame}, {x: 10, y: 20, width: 300, height: 200});
};
it('protects the selector before showing and recognizes only a DPI-correct cropped image', async () => {
  const result = mocks.handlers.get('screenshot:recognize')!(event, 'request-1');
  await flush();
  expect(mocks.windows[0].options).toMatchObject({x: -1440, transparent: true, skipTaskbar: true, show: false});
  expect(mocks.windows[0].show).toHaveBeenCalledOnce();
  expect(mocks.sources).not.toHaveBeenCalled();
  select(); await vi.advanceTimersByTimeAsync(100);
  expect(mocks.windows.every(win => win.destroyed)).toBe(true);
  expect(mocks.crop).toHaveBeenCalledWith({x: 20, y: 40, width: 600, height: 400});
  expect(mocks.recognize.mock.calls[0]![0]).toEqual(Buffer.from('cropped-only'));
  expect(mocks.restore).toHaveBeenCalledOnce();
  await expect(result).resolves.toMatchObject({status: 'success', text: '识别到的问题'});
});
it('rejects foreign frames and simultaneous requests, and cancelling leaves no selector or OCR request', async () => {
  await expect(mocks.handlers.get('screenshot:recognize')!({...event, senderFrame: {}}, 'request-1')).resolves.toMatchObject({status: 'error'});
  const pending = mocks.handlers.get('screenshot:recognize')!(event, 'request-1'); await flush();
  await expect(mocks.handlers.get('screenshot:recognize')!(event, 'request-2')).resolves.toMatchObject({status: 'error'});
  mocks.handlers.get('screenshot:cancel')!(event, 'stale-id');
  expect(mocks.windows[0].destroyed).toBe(false);
  mocks.handlers.get('screenshot:cancel')!(event, 'request-1');
  await expect(pending).resolves.toEqual({status: 'cancelled'});
  expect(mocks.windows[0].destroyed).toBe(true); expect(mocks.restore).toHaveBeenCalledOnce();
  expect(mocks.sources).not.toHaveBeenCalled(); expect(mocks.recognize).not.toHaveBeenCalled();
  expect(mocks.events.ipc!.listenerCount('screenshot:select')).toBe(0);
});
it.each(['denied', 'not-determined', 'restricted'])('never requests missing %s permissions from a live screenshot', async status => {
  mocks.permission.mockReturnValue(status);
  await expect(mocks.handlers.get('screenshot:recognize')!(event, 'request-1')).resolves.toMatchObject({status: 'error', permission: true});
  expect(mocks.windows).toHaveLength(0); expect(mocks.sources).not.toHaveBeenCalled();
  expect(mocks.warm).not.toHaveBeenCalled();
});
it('restores the app on capture failure, display change, Escape and global hide', async () => {
  for (const reason of ['display', 'escape', 'hide']) {
    const pending = mocks.handlers.get('screenshot:recognize')!(event, `request-${reason}`); await flush();
    const win = mocks.windows.at(-1);
    if (reason === 'display') mocks.events.screen!.emit('display-metrics-changed');
    else if (reason === 'hide') win.emit('hide');
    else mocks.events.ipc!.emit('screenshot:cancel-selection', {sender: win.webContents});
    await expect(pending).resolves.toEqual({status: 'cancelled'});
    expect(win.destroyed).toBe(true);
  }
  mocks.windows.length = 0;
  const failed = mocks.handlers.get('screenshot:recognize')!(event, 'request-error'); await flush();
  mocks.sources.mockRejectedValueOnce(new Error('录屏失败')); select(); await vi.advanceTimersByTimeAsync(100);
  await expect(failed).resolves.toMatchObject({status: 'error', message: '录屏失败'});
  expect(mocks.restore).toHaveBeenCalledTimes(4);
});
