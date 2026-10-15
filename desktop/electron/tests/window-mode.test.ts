import {EventEmitter} from 'node:events';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {BrowserWindow} from 'electron';
const screenMock = vi.hoisted(() => ({area: {x: 0, y: 0, width: 1440, height: 900}}));
vi.mock('electron', () => ({screen: {getDisplayMatching: () => ({workArea: screenMock.area})}}));
import {getWindowMode, setWindowCompact, setWindowPinned} from '../windows/window-mode';
class WindowStub extends EventEmitter {
  bounds = {x: 100, y: 100, width: 1000, height: 700};
  fullscreen = false; maximized = false; destroyed = false;
  webContents = {send: vi.fn()};
  isDestroyed = () => this.destroyed;
  getNormalBounds = () => ({...this.bounds});
  isFullScreen = () => this.fullscreen;
  isMaximized = () => this.maximized;
  setFullScreen = vi.fn((on: boolean) => {this.fullscreen = on; queueMicrotask(() => this.emit(on ? 'enter-full-screen' : 'leave-full-screen')); });
  maximize = vi.fn(() => {this.maximized = true;});
  unmaximize = vi.fn(() => {this.maximized = false;});
  setBounds = vi.fn((value: typeof this.bounds) => {this.bounds = value;});
  setMinimumSize = vi.fn(); setMaximizable = vi.fn(); setFullScreenable = vi.fn();
  setAlwaysOnTop = vi.fn(); setSkipTaskbar = vi.fn(); setVisibleOnAllWorkspaces = vi.fn();
  asWindow() {return this as unknown as BrowserWindow;}
}
afterEach(() => {vi.restoreAllMocks(); screenMock.area = {x: 0, y: 0, width: 1440, height: 900};});
describe.each(['darwin', 'win32'] as const)('%s window modes', platform => {
  function setup() {vi.spyOn(process, 'platform', 'get').mockReturnValue(platform); return new WindowStub();}
  it('restores independent pin selection and normal bounds after compact mode', async () => {
    const win = setup(), target = win.asWindow(), original = {...win.bounds};
    await setWindowPinned(target, true);
    await setWindowCompact(target, true);
    expect(win.bounds.width).toBe(420);
    expect(win.bounds.height).toBeGreaterThan(win.bounds.width);
    expect(getWindowMode(target)).toEqual({compact: true, pinned: true, alwaysOnTop: true});
    await expect(setWindowPinned(target, false)).rejects.toThrow('小窗口始终置顶');
    await setWindowCompact(target, false);
    expect(win.bounds).toEqual(original);
    expect(getWindowMode(target)).toEqual({compact: false, pinned: true, alwaysOnTop: true});
    await setWindowPinned(target, false);
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(false, 'floating');
    expect(win.setSkipTaskbar).toHaveBeenLastCalledWith(true);
    if (platform === 'darwin') expect(win.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, {visibleOnFullScreen: true, skipTransformProcessType: true});
    else expect(win.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
  });
  it('serializes rapid transitions and preserves a maximized window without pinning it afterwards', async () => {
    const win = setup(); win.maximized = true;
    await Promise.all([setWindowCompact(win.asWindow(), true), setWindowCompact(win.asWindow(), true), setWindowCompact(win.asWindow(), false)]);
    expect(win.maximize).toHaveBeenCalledOnce();
    expect(win.unmaximize).toHaveBeenCalledOnce();
    expect(getWindowMode(win.asWindow())).toEqual({compact: false, pinned: false, alwaysOnTop: false});
  });
  it('exits native fullscreen before resizing and restores it on return', async () => {
    const win = setup(); win.fullscreen = true;
    await setWindowCompact(win.asWindow(), true);
    expect(win.fullscreen).toBe(false);
    expect(win.setFullScreen.mock.invocationCallOrder[0]).toBeLessThan(win.setBounds.mock.invocationCallOrder[0]!);
    await setWindowCompact(win.asWindow(), false);
    expect(win.fullscreen).toBe(true);
  });
  it('waits for the Mac fullscreen animation before completing a restore', async () => {
    if (platform !== 'darwin') return;
    const win = setup(); win.fullscreen = true;
    await setWindowCompact(win.asWindow(), true);
    let restored = false;
    win.setFullScreen.mockImplementation(on => {win.fullscreen = on;});
    const transition = setWindowCompact(win.asWindow(), false).then(() => {restored = true;});
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(restored).toBe(false);
    win.emit('enter-full-screen');
    await transition;
    expect(restored).toBe(true);
    expect(win.listenerCount('enter-full-screen')).toBe(0);
    expect(win.listenerCount('closed')).toBe(0);
  });
  it('keeps restored bounds on screen after a monitor is disconnected', async () => {
    const win = setup(); win.bounds.x = 1800;
    await setWindowCompact(win.asWindow(), true);
    screenMock.area = {x: 0, y: 0, width: 1280, height: 800};
    await setWindowCompact(win.asWindow(), false);
    expect(win.bounds.x + win.bounds.width).toBeLessThanOrEqual(1280);
    expect(win.bounds.y + win.bounds.height).toBeLessThanOrEqual(800);
  });
  it('does not force compact mode below the taskbar on a scaled short display', async () => {
    const win = setup();
    screenMock.area = {x: -1100, y: 40, width: 1024, height: 480};
    await setWindowCompact(win.asWindow(), true);
    expect(win.setMinimumSize).toHaveBeenLastCalledWith(360, 480);
    expect(win.bounds.y).toBeGreaterThanOrEqual(40);
    expect(win.bounds.y + win.bounds.height).toBeLessThanOrEqual(520);
    expect(win.bounds.x).toBeGreaterThanOrEqual(-1100);
    await setWindowCompact(win.asWindow(), false);
    expect(win.setMinimumSize).toHaveBeenLastCalledWith(480, 400);
    expect(win.bounds.y + win.bounds.height).toBeLessThanOrEqual(520);
  });
});
