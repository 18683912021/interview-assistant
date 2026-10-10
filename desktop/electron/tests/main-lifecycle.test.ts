import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => void>(),
  windows: [] as any[],
  register: vi.fn(), permissions: vi.fn(), createTray: vi.fn(), destroyTray: vi.fn(),
  destroyOverlay: vi.fn(), stop: vi.fn(), flushStorage: vi.fn(), quit: vi.fn(),
  relaunch: vi.fn(), activation: vi.fn(), menu: vi.fn(), snapshot: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    whenReady: () => Promise.resolve(), isReady: () => true, quit: mocks.quit,
    relaunch: mocks.relaunch, setActivationPolicy: mocks.activation,
    on: (name: string, fn: (...args: any[]) => void) => mocks.handlers.set(name, fn),
  },
  BrowserWindow: {},
}));
vi.mock('../ipc-handlers.js', () => ({ registerIpcHandlers: mocks.register, flushStorage: mocks.flushStorage }));
vi.mock('../audio/audio-capture.js', () => ({ audioCapture: { stop: mocks.stop, getSnapshot: mocks.snapshot } }));
vi.mock('../menu.js', () => ({ createApplicationMenu: mocks.menu }));
vi.mock('../audio/media-permissions.js', () => ({ configureSystemAudioCapture: vi.fn() }));
vi.mock('../tray.js', () => ({ createTray: mocks.createTray, destroyTray: mocks.destroyTray }));
vi.mock('../windows/overlay-window.js', () => ({ destroyOverlayWindow: mocks.destroyOverlay }));
vi.mock('../windows/main-window.js', () => ({
  allowMediaPermissions: mocks.permissions,
  createMainWindow: () => {
    const handlers = new Map<string, () => void>();
    const win = {
      destroyed: false,
      isDestroyed: () => win.destroyed,
      isMinimized: () => false,
      show: vi.fn(), focus: vi.fn(), restore: vi.fn(),
      once: (name: string, fn: () => void) => handlers.set(name, fn),
      close: () => { win.destroyed = true; handlers.get('closed')?.(); },
    };
    mocks.windows.push(win);
    return win;
  },
}));

const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.windows.length = 0;
  mocks.stop.mockResolvedValue(undefined);
  mocks.flushStorage.mockResolvedValue(undefined);
  mocks.snapshot.mockReturnValue({ captureState: 'idle' });
});

describe('native app lifecycle', () => {
  it('stops capture on close and recreates only the window on activation', async () => {
    await import('../main.js');
    await flush();
    expect(mocks.windows).toHaveLength(1);
    mocks.windows[0].close();
    expect(mocks.stop).toHaveBeenCalledWith('main_window_closed');
    expect(mocks.destroyOverlay).toHaveBeenCalledOnce();
    expect(mocks.destroyTray).not.toHaveBeenCalled();
    mocks.handlers.get('activate')?.();
    expect(mocks.windows).toHaveLength(2);
    expect(mocks.register).toHaveBeenCalledOnce();
    expect(mocks.permissions).toHaveBeenCalledOnce();
    expect(mocks.createTray).toHaveBeenCalledOnce();
    mocks.handlers.get('activate')?.();
    expect(mocks.windows).toHaveLength(2);
    expect(mocks.windows[1].focus).toHaveBeenCalledOnce();
  });

  it('reopens the real main window from the persistent tray after close', async () => {
    await import('../main.js');
    await flush();
    mocks.windows[0].close();
    const reopen = mocks.createTray.mock.calls[0]![0];
    reopen();
    expect(mocks.windows).toHaveLength(2);
    expect(mocks.createTray).toHaveBeenCalledOnce();
    expect(mocks.menu).toHaveBeenCalledOnce();
    expect(mocks.menu.mock.calls[0]![0]).toBe(reopen);
  });

  it('schedules one relaunch only after capture and storage have drained', async () => {
    const { restartApplication } = await import('../main.js');
    await flush();
    restartApplication();
    restartApplication();
    expect(mocks.quit).toHaveBeenCalledOnce();
    expect(mocks.relaunch).not.toHaveBeenCalled();
    mocks.handlers.get('before-quit')?.({ preventDefault: vi.fn() });
    await flush();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(mocks.flushStorage).toHaveBeenCalledOnce();
    expect(mocks.relaunch).toHaveBeenCalledOnce();
    expect(mocks.destroyTray).toHaveBeenCalledOnce();
  });

  it('does not restart during an active interview', async () => {
    const { restartApplication } = await import('../main.js');
    await flush();
    mocks.snapshot.mockReturnValue({ captureState: 'capturing' });
    expect(restartApplication).toThrow('请先暂停');
    expect(mocks.quit).not.toHaveBeenCalled();
    expect(mocks.relaunch).not.toHaveBeenCalled();
  });

  it('waits for capture finalization once before quitting', async () => {
    let finish!: () => void;
    let stored!: () => void;
    mocks.stop.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    mocks.flushStorage.mockReturnValue(new Promise<void>(resolve => { stored = resolve; }));
    await import('../main.js');
    await flush();
    const preventDefault = vi.fn();
    mocks.handlers.get('before-quit')?.({ preventDefault });
    mocks.handlers.get('before-quit')?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.quit).not.toHaveBeenCalled();
    finish();
    await flush();
    expect(mocks.flushStorage).toHaveBeenCalledOnce();
    expect(mocks.quit).not.toHaveBeenCalled();
    stored();
    await flush();
    expect(mocks.quit).not.toHaveBeenCalled();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(mocks.quit).toHaveBeenCalledOnce();
    const allowQuit = vi.fn();
    mocks.handlers.get('before-quit')?.({ preventDefault: allowQuit });
    expect(allowQuit).not.toHaveBeenCalled();
  });

  it('does not reenter native quit in the same microtask checkpoint when capture and storage are already idle', async () => {
    await import('../main.js');
    await flush();
    const preventDefault = vi.fn();
    mocks.handlers.get('before-quit')?.({ preventDefault });
    await flush();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.flushStorage).toHaveBeenCalledOnce();
    expect(mocks.quit).not.toHaveBeenCalled();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(mocks.quit).toHaveBeenCalledOnce();
  });
});
