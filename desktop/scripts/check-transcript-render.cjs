// Own isolated Electron test profile; does not open or read the installed app.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
if (!process.versions.electron) {
  const {spawnSync} = require('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-render-check-'));
  const esbuild = require(require.resolve('esbuild', {paths:[path.dirname(require.resolve('vite'))]}));
  let status = 1;
  try {
    esbuild.buildSync({entryPoints:[path.join(__dirname,'transcript-render-fixture.tsx')], bundle:true,
      outfile:path.join(tmp,'fixture.js'), jsx:'automatic',
      define:{'process.env.NODE_ENV':'"production"', 'import.meta.env':'{}'}, minify:true});
    fs.writeFileSync(path.join(tmp,'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script>');
    const env = {...process.env, INTERVIEW_RENDER_FIXTURE:tmp};
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(require('electron'), [__filename], {env,stdio:'inherit',timeout:45000});
    if (result.error) throw result.error;
    status = result.status ?? 1;
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
  process.exit(status);
} else {
  const {app,BrowserWindow,ipcMain} = require('electron');
  const tmp = process.env.INTERVIEW_RENDER_FIXTURE;
  app.setPath('userData',path.join(tmp,'profile'));
  const preload = path.join(tmp,'preload.js');
  fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');
    const audio = {};
    for (const name of ['State','Transcription','LLMStart','LLMChunk','LLMDone','StreamState','Levels','Error'])
      audio['on'+name] = cb => {const listener = (_e, value) => cb(value);
        ipcRenderer.on('fixture:'+name, listener); return () => ipcRenderer.removeListener('fixture:'+name, listener);};
    audio.stopCapture = async () => {}; audio.cancelSystemAudioCheck = async () => {};
    contextBridge.exposeInMainWorld('electronAPI', {audio});
    contextBridge.exposeInMainWorld('renderFixture', {publish: events => ipcRenderer.invoke('fixture:publish', events)});
    contextBridge.exposeInMainWorld('reportRenderCheck', result=>ipcRenderer.send('render-check',result));`);
  ipcMain.handle('fixture:publish', (event, events) => {
    for (const [name, payload] of events) event.sender.send('fixture:'+name, payload);
  });
  ipcMain.once('render-check',(_event,result)=>{
    console.log(JSON.stringify(result));
    app.exit(result.messages===1000 && result.historyNodePreserved && result.latestBothVisible ? 0 : 1);
  });
  app.whenReady().then(()=>{
    const win = new BrowserWindow({show:false,width:1200,height:800,webPreferences:{preload,backgroundThrottling:false}});
    win.loadFile(path.join(tmp,'index.html'));
  });
}
