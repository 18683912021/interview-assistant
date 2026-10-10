import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const electron = vi.hoisted(() => ({
  app: {isPackaged: true},
  options: [] as Array<{transparent?: boolean; resizable?: boolean}>,
  windows: [] as Array<{
    loadURL: ReturnType<typeof vi.fn>;
    loadFile: ReturnType<typeof vi.fn>;
    webContents: {openDevTools: ReturnType<typeof vi.fn>};
  }>,
}));
vi.mock('electron', () => ({
  app: electron.app,
  BrowserWindow: class {
    loadURL = vi.fn();
    loadFile = vi.fn();
    webContents = {openDevTools: vi.fn()};
    constructor(options: {transparent?: boolean; resizable?: boolean}) {
      electron.windows.push(this);
      electron.options.push(options);
    }
    once() {}
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents() {}
    isDestroyed() {
      return false;
    }
  },
}));

beforeEach(() => {
  vi.resetModules();
  electron.windows.length = 0;
  electron.options.length = 0;
  electron.app.isPackaged = true;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('desktop page loading', () => {
  it('lets Electron handle file URL escaping for the packaged main window', async () => {
    const {createMainWindow} = await import('../windows/main-window');
    createMainWindow();
    const window = electron.windows[0]!;
    expect(window.loadURL).not.toHaveBeenCalled();
    expect(path.basename(window.loadFile.mock.calls[0]![0])).toBe('index.html');
    expect(window.webContents.openDevTools).not.toHaveBeenCalled();
  });

  it('keeps the overlay route separate from the packaged file path', async () => {
    const {createOverlayWindow} = await import('../windows/overlay-window');
    createOverlayWindow();
    const window = electron.windows[0]!;
    expect(window.loadURL).not.toHaveBeenCalled();
    expect(window.loadFile).toHaveBeenCalledWith(expect.stringContaining('dist-renderer'), {
      hash: '/overlay',
    });
  });

  it('preserves the existing macOS/dev server workflow', async () => {
    electron.app.isPackaged = false;
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5174');
    const {createMainWindow} = await import('../windows/main-window');
    createMainWindow();
    expect(electron.windows[0]!.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5174');
    expect(electron.windows[0]!.loadFile).not.toHaveBeenCalled();
  });

  it.each(['win32', 'darwin'])(
    'keeps the %s overlay usable while preserving Mac transparency',
    async platform => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue(platform as NodeJS.Platform);
      const {createOverlayWindow} = await import('../windows/overlay-window');
      createOverlayWindow();
      expect(electron.options[0]).toMatchObject({
        resizable: true,
        transparent: platform !== 'win32',
      });
    },
  );
});
