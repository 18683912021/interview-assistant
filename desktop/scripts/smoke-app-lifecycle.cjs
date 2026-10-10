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
fs.writeFileSync(fixture, '<!doctype html><title>Lifecycle regression</title><p>Local lifecycle fixture. No capture.</p>');
const originalLoadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function () { return originalLoadFile.call(this, fixture); };
const main = require(path.join(root, 'dist-electron/main.js'));
const trays = require(path.join(root, 'dist-electron/tray.js'));
const overlays = require(path.join(root, 'dist-electron/windows/overlay-window.js'));
const turn = () => new Promise(resolve => setImmediate(resolve));
let passed = false;
app.whenReady().then(async () => {
  await turn();
  let win = main.mainWindow;
  assert.ok(win);
  if (win.webContents.isLoading()) await once(win.webContents, 'did-finish-load');
  const icon = trays.createTrayIcon();
  assert.equal(icon.isEmpty(), false);
  assert.ok(icon.toBitmap().some((value, index) => index % 4 === 3 && value > 0));
  if (process.platform === 'darwin') {
    assert.equal(icon.isTemplateImage(), true);
    assert.equal(app.dock.isVisible(), true, 'main window must not hide Dock');
  }
  const tray = trays.createTray(() => { throw new Error('existing tray must be reused'); });
  overlays.createOverlayWindow();
  if (process.platform === 'darwin') assert.equal(app.dock.isVisible(), true, 'overlay must not hide Dock');
  overlays.destroyOverlayWindow();
  if (process.platform === 'darwin') {
    const closed = once(win, 'closed');
    win.close(); await closed; await turn();
    assert.equal(main.mainWindow, null);
    assert.equal(tray.isDestroyed(), false, 'tray must survive last window close');
    assert.equal(app.dock.isVisible(), true);
    Menu.getApplicationMenu().items[0].submenu.items[0].click();
    win = main.mainWindow;
    assert.ok(win && !win.isDestroyed(), 'menu must recreate the main window');
  }
  assert.equal(trays.createTray(() => {}), tray);
  console.log(JSON.stringify({electron:process.versions.electron, platform:process.platform,
    visibleTrayIcon:true, dockVisible:process.platform === 'darwin' ? app.dock.isVisible() : null,
    reopenedAfterClose:process.platform === 'darwin', capture:false}));
  passed = true;
  app.quit();
}).catch(error => { console.error(error); process.exitCode = 1; app.quit(); });
app.on('will-quit', () => {
  if (!passed) process.exitCode = 1;
  fs.rmSync(tmp, {recursive:true,force:true});
});
setTimeout(() => {console.error('lifecycle timeout');app.exit(1);}, 25000).unref();
process.on('unhandledRejection', error => { console.error(error); app.exit(1); });
