import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {BrowserWindow} from 'electron';

const shortcut = vi.hoisted(() => ({register: vi.fn(), unregister: vi.fn()}));
vi.mock('electron', () => ({globalShortcut: shortcut}));
function windowFixture(visible = false) {
  const closed = new Map<string, () => void>();
  const window = {
    visible, destroyed: false, minimized: false,
    show: vi.fn(() => {window.visible = true;}),
    hide: vi.fn(() => {window.visible = false;}),
    restore: vi.fn(() => {window.minimized = false;}),
    setContentProtection: vi.fn(), isContentProtected: () => true,
    isVisible: () => window.visible, isDestroyed: () => window.destroyed,
    isMinimized: () => window.minimized,
    once: (event: string, callback: () => void) => closed.set(event, callback),
    close: () => {window.destroyed = true; closed.get('closed')?.();},
  };
  return {window, native: window as unknown as BrowserWindow};
}
beforeEach(() => {vi.resetModules(); vi.clearAllMocks(); shortcut.register.mockReturnValue(true);});

describe('window privacy', () => {
  it('restores temporarily suspended windows but respects a user hide during screenshot selection', async () => {
    const privacy = await import('../windows/window-privacy');
    const main = windowFixture(true);
    privacy.protectWindow(main.native);
    const resume = privacy.suspendPrivateWindows();
    expect(main.window.visible).toBe(false);
    privacy.hideWindows(); resume();
    expect(main.window.visible).toBe(false);
    privacy.restorePrivateWindows();
    expect(main.window.visible).toBe(true);
  });
  it('hides and restores both windows, including an overlay that finishes loading while hidden', async () => {
    const privacy = await import('../windows/window-privacy');
    const main = windowFixture(true), overlay = windowFixture();
    privacy.protectWindow(main.native);
    privacy.hideWindows();
    privacy.protectWindow(overlay.native);
    privacy.showPrivateWindow(overlay.native);
    expect(main.window.visible).toBe(false);
    expect(overlay.window.show).not.toHaveBeenCalled();
    expect(overlay.window.setContentProtection).toHaveBeenCalledWith(true);
    privacy.restorePrivateWindows();
    expect(main.window.visible).toBe(true);
    expect(overlay.window.visible).toBe(true);
  });

  it('does not resurrect closed or previously invisible windows', async () => {
    const privacy = await import('../windows/window-privacy');
    const closed = windowFixture(true), invisible = windowFixture();
    privacy.protectWindow(closed.native); privacy.protectWindow(invisible.native);
    privacy.hideWindows(); closed.window.close(); privacy.restorePrivateWindows();
    expect(closed.window.show).not.toHaveBeenCalled();
    expect(invisible.window.show).not.toHaveBeenCalled();
  });

  it('uses the global shortcut to hide and restore, releasing only its own accelerator on exit', async () => {
    const privacy = await import('../windows/window-privacy');
    const main = windowFixture(true);
    const restore = vi.fn(() => privacy.restorePrivateWindows());
    privacy.protectWindow(main.native); privacy.registerPrivacyShortcut(restore);
    const toggle = shortcut.register.mock.calls[0]![1];
    toggle(); expect(main.window.visible).toBe(false);
    toggle(); expect(restore).toHaveBeenCalledOnce(); expect(main.window.visible).toBe(true);
    privacy.unregisterPrivacyShortcut();
    expect(shortcut.unregister).toHaveBeenCalledWith('CommandOrControl+Shift+H');
  });

  it('reports shortcut conflicts instead of displaying an unavailable shortcut', async () => {
    shortcut.register.mockReturnValue(false);
    const privacy = await import('../windows/window-privacy');
    privacy.registerPrivacyShortcut(vi.fn());
    expect(privacy.getWindowPrivacy().shortcut).toBeNull();
  });
});
