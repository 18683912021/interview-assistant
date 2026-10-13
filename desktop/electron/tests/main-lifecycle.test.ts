import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => void>(),
  windows: [] as any[],
  register: vi.fn(), permissions: vi.fn(), createTray: vi.fn(), destroyTray: vi.fn(),
  destroyOverlay: vi.fn(), stop: vi.fn(), flushStorage: vi.fn(), quit: vi.fn(),
  relaunch: vi.fn(), activation: vi.fn(), menu: vi.fn(), snapshot: vi.fn(),
  registerShortcut: vi.fn(), unregisterShortcut: vi.fn(), restoreWindows: vi.fn(), drain: vi.fn(),
  dialog: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    whenReady: () => Promise.resolve(), isReady: () => true, quit: mocks.quit,
    relaunch: mocks.relaunch, setActivationPolicy: mocks.activation,
    on: (name: string, fn: (...args: any[]) => void) => mocks.handlers.set(name, fn),
  },
  BrowserWindow: {},
  dialog: {showMessageBox: mocks.dialog},
}));
vi.mock('../ipc-handlers.js', () => ({ registerIpcHandlers: mocks.register, flushStorage: mocks.flushStorage }));
vi.mock('../audio/audio-capture.js', () => ({ audioCapture: { stop: mocks.stop, getSnapshot: mocks.snapshot } }));
vi.mock('../menu.js', () => ({ createApplicationMenu: mocks.menu }));
vi.mock('../audio/media-permissions.js', () => ({ configureSystemAudioCapture: vi.fn() }));
vi.mock('../tray.js', () => ({ createTray: mocks.createTray, destroyTray: mocks.destroyTray }));
vi.mock('../windows/overlay-window.js', () => ({ destroyOverlayWindow: mocks.destroyOverlay }));
vi.mock('../windows/window-privacy.js', () => ({
  registerPrivacyShortcut: mocks.registerShortcut, unregisterPrivacyShortcut: mocks.unregisterShortcut,
  restorePrivateWindows: mocks.restoreWindows,
}));
vi.mock('../renderer-shutdown.js', () => ({drainRenderer: mocks.drain}));
vi.mock('../windows/main-window.js', () => ({
  allowMediaPermissions: mocks.permissions,
  createMainWindow: () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    const win = {
      destroyed: false,
      isDestroyed: () => win.destroyed,
      isMinimized: () => false,
      show: vi.fn(), focus: vi.fn(), restore: vi.fn(),
      webContents: {send: vi.fn()},
      once: (name: string, fn: () => void) => handlers.set(name, fn),
      on: (name: string, fn: () => void) => handlers.set(name, fn),
      close: () => {
        const event = {preventDefault: vi.fn()};
        handlers.get('close')?.(event);
        if (!event.preventDefault.mock.calls.length) {win.destroyed = true; handlers.get('closed')?.();}
      },
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
  mocks.drain.mockResolvedValue(true);
});

describe('native app lifecycle', () => {
  it('lets users return to their draft if renderer saving fails', async () => {
    mocks.drain.mockResolvedValue(false);
    mocks.dialog.mockResolvedValue({response: 0});
    await import('../main.js');
    await flush();
    mocks.handlers.get('before-quit')?.({preventDefault: vi.fn()});
    await flush();
    expect(mocks.dialog).toHaveBeenCalledOnce();
    expect(mocks.quit).not.toHaveBeenCalled();
    expect(mocks.destroyTray).not.toHaveBeenCalled();
    expect(mocks.windows[0].webContents.send).toHaveBeenCalledWith('window:quit-cancelled');
    expect(mocks.windows[0].focus).toHaveBeenCalledOnce();
  });
  it('quits on main-window close but keeps the renderer alive until drafts are drained', async () => {
    await import('../main.js');
    await flush();
    expect(mocks.windows).toHaveLength(1);
    mocks.windows[0].close();
    expect(mocks.quit).toHaveBeenCalledOnce();
    expect(mocks.windows[0].destroyed).toBe(false);
    mocks.handlers.get('before-quit')?.({preventDefault: vi.fn()});
    await flush();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(mocks.drain).toHaveBeenCalledWith(mocks.windows[0]);
    expect(mocks.flushStorage).toHaveBeenCalledOnce();
    expect(mocks.destroyTray).toHaveBeenCalledOnce();
    expect(mocks.unregisterShortcut).toHaveBeenCalledOnce();
    mocks.windows[0].close();
    expect(mocks.windows[0].destroyed).toBe(true);
    mocks.handlers.get('activate')?.();
    expect(mocks.windows).toHaveLength(1);
  });

  it('restores the hidden main window from the tray without creating another instance', async () => {
    await import('../main.js');
    await flush();
    const reopen = mocks.createTray.mock.calls[0]![0];
    reopen();
    expect(mocks.windows).toHaveLength(1);
    expect(mocks.windows[0].focus).toHaveBeenCalledOnce();
    expect(mocks.restoreWindows).toHaveBeenCalledTimes(2);
    expect(mocks.registerShortcut).toHaveBeenCalledWith(reopen);
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
