// Run after tsc: pnpm exec electron scripts/smoke-media-permissions.cjs
// Exercises the real Electron/Chromium failure and IPC path with no real capture.
const {app, BrowserWindow, ipcMain, dialog, desktopCapturer, systemPreferences} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-permission-test-'));
app.setPath('userData', path.join(tmp, 'profile'));
app.disableHardwareAcceleration();
let scenario = 'denied';
// No microphone, screen or real system audio is opened by this regression test.
dialog.showMessageBox = async () => {throw new Error('Capture must never open an authorization dialog');};
desktopCapturer.getSources = async () => {if (scenario === 'empty') return []; throw new Error('source denied fixture');};
systemPreferences.getMediaAccessStatus = () => scenario === 'denied' ? 'denied' : 'granted';
const {allowMediaPermissions, takeDisplayCaptureFailure} = require(path.join(root, 'dist-electron/audio/media-permissions.js'));
const fixture = path.join(tmp, 'index.html');
fs.writeFileSync(fixture, '<!doctype html><meta charset="utf-8"><title>Permission regression</title><script src="capture.js"></script>');
require(require.resolve('esbuild', {paths: [require.resolve('vite')]})).buildSync({
  entryPoints: [path.join(root, 'src/services/capture-preparation.ts')], bundle: true,
  format: 'iife', globalName: 'Capture', outfile: path.join(tmp, 'capture.js'),
});
fs.writeFileSync(path.join(tmp,'preload.cjs'), `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('electronAPI',{audio:{takeDisplayCaptureFailure:()=>ipcRenderer.invoke('failure')}});`);
let win;
app.whenReady().then(async () => {
  allowMediaPermissions();
  ipcMain.handle('failure', e => takeDisplayCaptureFailure(e.senderFrame));
  win = new BrowserWindow({show:false,webPreferences:{preload:path.join(tmp,'preload.cjs'),contextIsolation:true,sandbox:false}});
  await win.loadFile(fixture);
  const report=[];
  for (scenario of ['denied','empty','failure']) {
    const result=await win.webContents.executeJavaScript(`(async()=>{
      let micCalls=0;
      try {await Capture.prepareAudioStreams({system_device_id:'__screen_capture__',microphone_id:''},'both',{
        getDisplayMedia:c=>navigator.mediaDevices.getDisplayMedia(c),
        getUserMedia:()=>{micCalls++;throw new Error('MIC MUST NEVER BE OPENED')}
      },true);return {unexpectedSuccess:true};}catch(e){return {message:e.message,micCalls};}
    })()`, true);
    assert.equal(result.micCalls,0);
    assert.match(result.message, scenario === 'denied' ? /macOS 尚未允许屏幕与系统音频录制/ : /系统音频来源无法打开/);
    assert.doesNotMatch(result.message,/Invalid capture constraints/);
    report.push({scenario,...result});
  }
  console.log(JSON.stringify({electron:process.versions.electron,chrome:process.versions.chrome,origin:'file://',realCapture:false}));
  console.log(JSON.stringify(report));
  app.quit();
}).catch(e=>{console.error(e);process.exitCode=1;app.quit();});
app.on('will-quit',()=>{fs.rmSync(tmp,{recursive:true,force:true});});
setTimeout(()=>{console.error('smoke timeout');process.exitCode=1;app.quit();},25000).unref();
process.on('unhandledRejection', e => { console.error(e); process.exitCode=1; app.quit(); });
