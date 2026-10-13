import {EventEmitter} from 'node:events';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {BrowserWindow} from 'electron';
const ipc = vi.hoisted(() => ({emitter: null as EventEmitter | null}));
vi.mock('electron', () => ({ipcMain: {
  on: (event: string, handler: (...args: unknown[]) => void) => ipc.emitter!.on(event, handler),
  removeListener: (event: string, handler: (...args: unknown[]) => void) => ipc.emitter!.removeListener(event, handler),
}}));
beforeEach(() => {ipc.emitter = new EventEmitter(); vi.useFakeTimers();});
afterEach(() => vi.useRealTimers());
const fixture = () => {
  const contents = {isDestroyed: () => false, mainFrame: {}, send: vi.fn()};
  const window = {isDestroyed: () => false, webContents: contents} as unknown as BrowserWindow;
  return {contents, window};
};
describe('renderer shutdown acknowledgement', () => {
  it('only accepts the main frame acknowledgement for this shutdown request', async () => {
    const {drainRenderer} = await import('../renderer-shutdown');
    const {window, contents} = fixture();
    const done = vi.fn();
    const saving = drainRenderer(window).then(done);
    const request = contents.send.mock.calls[0]![1];
    ipc.emitter!.emit('window:quit-ready', {sender: {}, senderFrame: contents.mainFrame}, request, true);
    ipc.emitter!.emit('window:quit-ready', {sender: contents, senderFrame: {}}, request, true);
    ipc.emitter!.emit('window:quit-ready', {sender: contents, senderFrame: contents.mainFrame}, 'wrong-request', true);
    await Promise.resolve(); expect(done).not.toHaveBeenCalled();
    ipc.emitter!.emit('window:quit-ready', {sender: contents, senderFrame: contents.mainFrame}, request, true);
    await saving; expect(done).toHaveBeenCalledWith(true);
    expect(ipc.emitter!.listenerCount('window:quit-ready')).toBe(0);
  });

  it('returns unconfirmed instead of hanging when the renderer is unresponsive', async () => {
    const {drainRenderer} = await import('../renderer-shutdown');
    const saving = drainRenderer(fixture().window);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await saving).toBe(false);
    expect(ipc.emitter!.listenerCount('window:quit-ready')).toBe(0);
  });
});
