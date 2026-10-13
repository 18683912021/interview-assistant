// Run after tsc: pnpm exec electron scripts/smoke-app-lifecycle.cjs
// Real Electron windows, menus and Dock; isolated profile, no audio/network/UI data.
const {app, BrowserWindow, Menu} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-lifecycle-test-'));
app.setPath('userData', path.join(tmp, 'profile'));
Object.defineProperty(app, 'isPackaged', {get: () => true});
const fixture = path.join(tmp, 'index.html');
fs.writeFileSync(fixture, `<!doctype html><title>Lifecycle regression</title><p>Local lifecycle fixture. No capture.</p>
<script>window.electronAPI.window.onPrepareQuit(async () => {
  await window.electronAPI.storage.set('shutdown-test', 'last-draft');
});</script>`);
const originalLoadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function () { return originalLoadFile.call(this, fixture); };
const main = require(path.join(root, 'dist-electron/main.js'));
const trays = require(path.join(root, 'dist-electron/tray.js'));
const overlays = require(path.join(root, 'dist-electron/windows/overlay-window.js'));
const modes = require(path.join(root, 'dist-electron/windows/window-mode.js'));
const privacy = require(path.join(root, 'dist-electron/windows/window-privacy.js'));
const turn = () => new Promise(resolve => setImmediate(resolve));
let passed = false;
app.whenReady().then(async () => {
  await turn();
  let win = main.mainWindow;
  assert.ok(win);
  if (win.webContents.isLoading()) await once(win.webContents, 'did-finish-load');
  if (!win.isVisible()) await once(win, 'ready-to-show');
  const icon = trays.createTrayIcon();
  assert.equal(icon.isEmpty(), false);
  assert.ok(icon.toBitmap().some((value, index) => index % 4 === 3 && value > 0));
  if (process.platform === 'darwin') {
    assert.equal(icon.isTemplateImage(), true);
    assert.equal(app.dock.isVisible(), false, 'main window must hide Dock');
  }
  const tray = trays.createTray(() => { throw new Error('existing tray must be reused'); });
  const overlay = overlays.createOverlayWindow();
  const overlayReady = once(overlay, 'ready-to-show');
  if (overlay.webContents.isLoading()) await once(overlay.webContents, 'did-finish-load');
  await overlayReady;
  await turn();
  assert.equal(win.isContentProtected(), true);
  assert.equal(overlay.isContentProtected(), true);
  privacy.hideWindows();
  assert.equal(win.isVisible(), false);
  assert.equal(overlay.isVisible(), false);
  const protection = privacy.getWindowPrivacy();
  if (process.platform === 'darwin') {
    assert.equal(app.dock.isVisible(), false, 'overlay must not reveal Dock');
    Menu.getApplicationMenu().items[0].submenu.items[0].click();
  } else {privacy.restorePrivateWindows(); win.show();}
  assert.equal(win.isVisible(), true);
  assert.equal(overlay.isVisible(), true);
  overlays.destroyOverlayWindow();
  assert.equal(win.isDestroyed(), false, 'closing the overlay must not close the main window');
  assert.equal(trays.createTray(() => {}), tray);
  const original = win.getNormalBounds();
  await modes.setWindowPinned(win, true);
  await modes.setWindowCompact(win, true);
  assert.equal(win.isAlwaysOnTop(), true);
  assert.equal(win.getBounds().width, 420);
  assert.equal(win.isMaximizable(), false);
  if (process.platform === 'darwin') {
    assert.equal(win.isVisibleOnAllWorkspaces(), true);
    assert.equal(app.dock.isVisible(), false);
  }
  privacy.hideWindows();
  privacy.restorePrivateWindows();
  assert.equal(win.isAlwaysOnTop(), true);
  assert.equal(modes.getWindowMode(win).compact, true);
  await modes.setWindowCompact(win, false);
  assert.deepEqual(win.getNormalBounds(), original);
  assert.equal(win.isAlwaysOnTop(), true);
  await modes.setWindowPinned(win, false);
  assert.equal(win.isAlwaysOnTop(), false);
  if (process.platform === 'darwin') {
    assert.equal(win.isVisibleOnAllWorkspaces(), false);
    const entered = once(win, 'enter-full-screen');
    win.setFullScreen(true);
    await entered;
    await modes.setWindowCompact(win, true);
    assert.equal(win.isFullScreen(), false);
    assert.equal(win.isAlwaysOnTop(), true);
    const restored = once(win, 'enter-full-screen');
    await modes.setWindowCompact(win, false);
    await restored;
    assert.equal(win.isFullScreen(), true);
    const left = once(win, 'leave-full-screen');
    win.setFullScreen(false);
    await left;
  }
  console.log(JSON.stringify({electron:process.versions.electron, platform:process.platform,
    visibleTrayIcon:true, dockVisible:process.platform === 'darwin' ? app.dock.isVisible() : null,
    protectionRequested:protection.protectionRequested, hideRestore:true, compactAndPin:true, capture:false}));
  win.once('closed', () => {
    const stored = JSON.parse(fs.readFileSync(path.join(tmp, 'profile', 'preferences.json'), 'utf8'));
    assert.equal(stored['shutdown-test'], 'last-draft', 'renderer draft must be saved before main-window destruction');
    assert.equal(tray.isDestroyed(), true);
  });
  passed = true;
  win.close();
}).catch(error => { console.error(error); process.exitCode = 1; app.quit(); });
app.on('will-quit', () => {
  fs.rmSync(tmp, {recursive:true,force:true});
  if (!passed) app.exit(1);
});
setTimeout(() => {console.error('lifecycle timeout');app.exit(1);}, 25000).unref();
process.on('unhandledRejection', error => { console.error(error); app.exit(1); });
process.on('uncaughtException', error => { console.error(error); app.exit(1); });
