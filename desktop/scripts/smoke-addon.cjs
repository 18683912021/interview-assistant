/**
 * smoke-addon.cjs —— addon 加载验证（默认不打开音频设备）
 *
 * 默认用法（可以设置 ELECTRON_RUN_AS_NODE=1，无需桌面会话）：
 *   .\node_modules\electron\dist\electron.exe scripts/smoke-addon.cjs
 *
 * 默认仅使用 Electron 的 Node 运行时加载 addon 并检查导出，不录音、不播放声音。
 * 手动硬件验证需明确追加 --hardware，并清除 ELECTRON_RUN_AS_NODE：
 *   .\node_modules\electron\dist\electron.exe scripts/smoke-addon.cjs --hardware
 * 在真实 Electron 主进程环境验证：
 *  1. session 权限双 handler 注册（setPermissionCheckHandler + setPermissionRequestHandler）不抛错；
 *  2. WASAPI addon 以当前 Electron 的 ABI 正常加载并返回设备快照；
 *  3. 自造测试音 → start → 收帧 → stop → 退出不崩溃（exit 0）。
 *
 * 第 3 点必须自造声音：WASAPI loopback 只在系统有活跃渲染流时产生数据，
 * 无活跃渲染流时可能一帧都收不到（GetNextPacketSize 持续返回零），也就覆盖不到
 * "有帧在途时 stop/退出"的竞态路径。隐藏窗口 + WebAudio 振荡器渲染 1s 测试音，
 * 并断言收帧数 > 0，收不到帧一律判失败。
 */
if (process.platform !== 'win32') {
  console.log('[smoke] 跳过（WASAPI addon 仅 Windows，macOS 走 ScreenCaptureKit）');
  process.exit(0);
}

if (!process.versions.electron) {
  console.error('[smoke] 请使用项目安装的 Electron 运行，不能使用系统 Node');
  process.exit(1);
}
for (const [option, actual] of [
  ['expect-electron', process.versions.electron],
  ['expect-arch', process.arch],
]) {
  const expected = process.argv
    .find(argument => argument.startsWith(`--${option}=`))
    ?.split('=')[1];
  if (expected && actual !== expected) {
    console.error(`[smoke] ${option} 不匹配：需要 ${expected}，实际 ${actual}`);
    process.exit(1);
  }
}

const path = require('node:path');
const addonArgument = process.argv.indexOf('--addon');
if (addonArgument >= 0 && !process.argv[addonArgument + 1]) {
  console.error('[smoke] --addon 需要文件路径');
  process.exit(1);
}
const addon = require(
  addonArgument >= 0
    ? path.resolve(process.argv[addonArgument + 1])
    : path.join(__dirname, '../dist-electron/audio/native/build/Release/wasapi_loopback.node'),
);
if (
  typeof addon.WasapiLoopback !== 'function' ||
  typeof addon.WasapiLoopback.prototype.start !== 'function' ||
  typeof addon.WasapiLoopback.prototype.stop !== 'function' ||
  typeof addon.enumerateDevices !== 'function'
) {
  throw new Error('WASAPI addon 导出不完整');
}
if (!process.argv.includes('--hardware')) {
  console.log(
    `[smoke] PASS: Electron ${process.versions.electron} / ${process.arch} addon 加载成功（未打开设备、未录音）`,
  );
  process.exit(0);
}
if (process.env.ELECTRON_RUN_AS_NODE) {
  console.error('[smoke] 硬件测试需要清除 ELECTRON_RUN_AS_NODE');
  process.exit(1);
}

const {app, session, BrowserWindow} = require('electron');
let recorder;
let toneWindow;

// Chromium 自动播放策略：无用户手势也允许 AudioContext 发声（测试音需要）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app
  .whenReady()
  .then(async () => {
    session.defaultSession.setPermissionCheckHandler(() => true);
    session.defaultSession.setPermissionRequestHandler((_wc, _p, callback) => callback(true));

    const dev = (recorder = new addon.WasapiLoopback());
    const snap = {
      sampleRate: dev.sampleRate,
      channels: dev.channels,
      bitsPerSample: dev.bitsPerSample,
      isFloat: dev.isFloat,
    };
    console.log('[smoke] permission handlers OK');
    console.log('[smoke] addon OK, device:', JSON.stringify(snap));

    // 完整采集链路：start → 收帧 → stop（验证线程 COM 初始化 + 退出无死锁/无崩溃）
    let frames = 0;
    let captureError = null;
    const ok = dev.start((error, frame) => {
      if (error) {
        captureError = error;
        return;
      }
      if (Buffer.isBuffer(frame) && frame.length > 0) frames++;
    });
    if (!ok) throw new Error('start() returned false');
    console.log('[smoke] start OK');

    // 隐藏窗口向默认播放设备渲染 1s 测试音（440Hz）
    const win = (toneWindow = new BrowserWindow({
      show: false,
      webPreferences: {backgroundThrottling: false},
    }));
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
      if (captureError || frames === 0) {
        console.error(
          '[smoke] FAIL:',
          captureError || '播放测试音期间未收到任何帧（默认播放设备不可用？）',
        );
        app.exit(1);
        return;
      }
      console.log('[smoke] PASS');
      app.quit();
    }, 1500);
  })
  .catch(e => {
    try {
      recorder?.stop();
    } catch {}
    if (toneWindow && !toneWindow.isDestroyed()) toneWindow.destroy();
    console.error('[smoke] FAIL:', e);
    app.exit(1);
  });
