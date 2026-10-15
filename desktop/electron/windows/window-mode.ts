import {BrowserWindow, screen, type Rectangle} from 'electron';

export type WindowMode = {compact: boolean; pinned: boolean; alwaysOnTop: boolean};
type SavedWindow = {bounds: Rectangle; maximized: boolean; fullscreen: boolean};
// Window-local state: resizing never replaces the renderer or its live interview.
const states = new WeakMap<BrowserWindow, {mode: WindowMode; saved?: SavedWindow; pending: Promise<unknown>}>();
function state(win: BrowserWindow) {
  let value = states.get(win);
  if (!value) {
    value = {mode: {compact: false, pinned: false, alwaysOnTop: false}, pending: Promise.resolve()};
    states.set(win, value);
  }
  return value;
}
export function getWindowMode(win: BrowserWindow): WindowMode { return {...state(win).mode}; }
function apply(win: BrowserWindow) {
  const mode = state(win).mode;
  mode.alwaysOnTop = mode.compact || mode.pinned;
  win.setAlwaysOnTop(mode.alwaysOnTop, 'floating');
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(mode.alwaysOnTop, {
      visibleOnFullScreen: mode.alwaysOnTop, skipTransformProcessType: true,
    });
  }
  win.setSkipTaskbar(true);
  win.webContents.send('window:mode-changed', {...mode});
  return {...mode};
}
function enqueue(win: BrowserWindow, operation: () => Promise<WindowMode> | WindowMode): Promise<WindowMode> {
  const value = state(win);
  const next = value.pending.catch(() => {}).then(() => {
    if (win.isDestroyed()) throw new Error('窗口已关闭');
    return operation();
  });
  value.pending = next;
  return next;
}
function fit(bounds: Rectangle): Rectangle {
  const area = screen.getDisplayMatching(bounds).workArea;
  const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height);
  return {width, height, x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))};
}
async function changeFullscreen(win: BrowserWindow, on: boolean) {
  if (win.isFullScreen() === on) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      win.removeListener('enter-full-screen', done);
      win.removeListener('leave-full-screen', done);
      win.removeListener('closed', closed);
    };
    const done = () => {cleanup(); resolve();};
    const closed = () => {cleanup(); reject(new Error('窗口已关闭'));};
    const timer = setTimeout(() => {cleanup(); reject(new Error('全屏切换未完成，请稍后重试'));}, 4000);
    if (on) win.once('enter-full-screen', done);
    else win.once('leave-full-screen', done);
    win.once('closed', closed);
    win.setFullScreen(on);
    // Windows changes fullscreen synchronously and may not emit a transition event.
    if (process.platform !== 'darwin' && win.isFullScreen() === on) done();
  });
}
export function setWindowPinned(win: BrowserWindow, pinned: boolean) {
  return enqueue(win, () => {
    if (typeof pinned !== 'boolean') throw new Error('无效的置顶状态');
    if (state(win).mode.compact) throw new Error('小窗口始终置顶，请先恢复大窗口');
    state(win).mode.pinned = pinned;
    return apply(win);
  });
}
export function setWindowCompact(win: BrowserWindow, compact: boolean) {
  return enqueue(win, async () => {
    if (typeof compact !== 'boolean') throw new Error('无效的窗口模式');
    const value = state(win);
    if (value.mode.compact === compact) return {...value.mode};
    if (compact) {
      const saved = {bounds: win.getNormalBounds(), maximized: win.isMaximized(), fullscreen: win.isFullScreen()};
      await changeFullscreen(win, false);
      if (win.isMaximized()) win.unmaximize();
      value.saved = saved;
      const area = screen.getDisplayMatching(saved.bounds).workArea;
      // High display scaling can leave less than 560 DIP above the taskbar.
      // A minimum taller than the work area would override our fitted bounds.
      win.setMinimumSize(Math.min(360, area.width), Math.min(560, area.height));
      win.setMaximizable(false);
      win.setFullScreenable(false);
      win.setBounds(fit({x: area.x + area.width - 436, y: area.y + 16, width: 420, height: Math.min(740, area.height - 32)}));
    } else {
      const area = screen.getDisplayMatching(value.saved?.bounds ?? win.getNormalBounds()).workArea;
      win.setMinimumSize(Math.min(480, area.width), Math.min(400, area.height));
      win.setMaximizable(true);
      win.setFullScreenable(true);
      if (value.saved) {
        win.setBounds(fit(value.saved.bounds));
        if (value.saved.maximized) win.maximize();
        if (value.saved.fullscreen) {
          // Keep the transition queued until macOS has actually entered its Space.
          // A rapid second click must not resize halfway through that animation.
          value.mode.compact = false;
          try {await changeFullscreen(win, true);}
          catch (error) {value.saved = undefined; apply(win); throw error;}
        }
      }
      value.saved = undefined;
    }
    value.mode.compact = compact;
    return apply(win);
  });
}
