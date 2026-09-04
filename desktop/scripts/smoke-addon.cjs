/**
 * smoke-addon.cjs —— addon 冒烟验证（每次 rebuild 后运行；ensure-native.cjs 会自动调用）
 *
 * 用法：$env:ELECTRON_RUN_AS_NODE=$null 后
 *   .\node_modules\electron\dist\electron.exe scripts/smoke-addon.cjs
 * （VSCode 集成终端会注入 ELECTRON_RUN_AS_NODE=1，会把 electron 变成纯 Node，必须先清除）
 *
 * 在真实 Electron 主进程环境验证：
 *  1. session 权限双 handler 注册（setPermissionCheckHandler + setPermissionRequestHandler）不抛错；
 *  2. WASAPI addon 以当前 Electron 的 ABI 正常加载并返回设备快照；
 *  3. 自造测试音 → start → 收帧 → stop → 退出不崩溃（exit 0）。
 *
 * 第 3 点必须自造声音：WASAPI loopback 只在系统有活跃渲染流时产生数据，
 * 无声系统一帧都收不到（GetBuffer 会一直阻塞等数据），也就覆盖不到
 * "有帧在途时 stop/退出"的竞态路径。隐藏窗口 + WebAudio 振荡器渲染 1s 测试音，
 * 并断言收帧数 > 0，收不到帧一律判失败。
 */
if (process.platform !== 'win32') {
  console.log('[smoke] 跳过（WASAPI addon 仅 Windows，macOS 走 ScreenCaptureKit）');
  process.exit(0);
}

const { app, session, BrowserWindow } = require('electron');

// Chromium 自动播放策略：无用户手势也允许 AudioContext 发声（测试音需要）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(async () => {
  session.defaultSession.setPermissionCheckHandler(() => true);
  session.defaultSession.setPermissionRequestHandler((_wc, _p, callback) => callback(true));

  const addon = require('../dist-electron/audio/native/build/Release/wasapi_loopback.node');
  const dev = new addon.WasapiLoopback();
  const snap = { sampleRate: dev.sampleRate, channels: dev.channels, bitsPerSample: dev.bitsPerSample, isFloat: dev.isFloat };
  console.log('[smoke] permission handlers OK');
  console.log('[smoke] addon OK, device:', JSON.stringify(snap));

  // 完整采集链路：start → 收帧 → stop（验证线程 COM 初始化 + 退出无死锁/无崩溃）
  let frames = 0;
  const ok = dev.start(() => { frames++; });
  if (!ok) throw new Error('start() returned false');
  console.log('[smoke] start OK');

  // 隐藏窗口向默认播放设备渲染 1s 测试音（440Hz）
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  const html = `<!doctype html><html><body><script>
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = 440;
    g.gain.value = 0.2;
    osc.connect(g); g.connect(ctx.destination);
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close(); }, 1000);
  </script></body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  console.log('[smoke] test tone playing 1s...');

  setTimeout(() => {
    dev.stop();
    win.destroy();
    console.log(`[smoke] stop OK, frames received: ${frames}`);
    if (frames === 0) {
      console.error('[smoke] FAIL: 播放测试音期间未收到任何帧（默认播放设备不可用？）');
      app.exit(1);
      return;
    }
    console.log('[smoke] PASS');
    app.quit();
  }, 1500);
}).catch((e) => {
  console.error('[smoke] FAIL:', e);
  app.exit(1);
});
