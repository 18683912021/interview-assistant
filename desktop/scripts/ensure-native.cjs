/**
 * ensure-native.cjs —— 确保 WASAPI addon 与当前 Electron 版本匹配（跨环境自愈）
 *
 * 背景：build/ 与 dist-electron/ 都不进 git。换机器/换环境后 addon 要么不存在，
 * 要么是旧 Electron ABI 编译的——手动重编容易漏做、拿错 target、或被 wasapi_loopback.cc
 * 里"无 --target"的旧命令坑到（拿系统 Node 头文件编译，任何 Electron 都加载不了）。
 *
 * 本脚本接管全流程，predev 与 build 都会经过它：
 *  1. 平台守卫：非 win32 直接跳过（addon 仅 Windows；macOS 系统音频走渲染进程 SCK）
 *  2. 依赖漂移检查：node_modules/electron 必须已安装，且与 package.json 声明版本一致；
 *     native 目录依赖（node-addon-api）缺失时自动 pnpm install（全新克隆后首次 predev 自愈）
 *  3. ABI 检查：marker（build/Release/.electron-target）与已安装 Electron 版本比对，
 *     缺失/失配/源码（.cc/.gyp）比产物新，则用 Electron 官方 headers 重编
 *     （--target --dist-url，见 Electron 官方文档 "Using Native Node Modules" 的手动方式）
 *  4. 拷贝到 dist-electron（tsc 不复制 .node；冒烟从 dist-electron 加载，故先拷贝）
 *  5. 重编后自动跑 smoke-addon 冒烟（真实 Electron 主进程：加载 addon + 采集 1s）
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NATIVE_DIR = path.join(ROOT, 'electron', 'audio', 'native');
const ADDON_PATH = path.join(NATIVE_DIR, 'build', 'Release', 'wasapi_loopback.node');
const MARKER_PATH = path.join(NATIVE_DIR, 'build', 'Release', '.electron-target');
const DEST_DIR = path.join(ROOT, 'dist-electron', 'audio', 'native', 'build', 'Release');

// Electron 43+ 的二进制在首次 require('electron') 时懒下载（@electron/get 走
// undici fetch，默认不吃 HTTP(S)_PROXY，直连 GitHub 在本网络下必失败）。
// 项目 .npmrc 的 electron_mirror 仅在经 pnpm 启动的脚本里以 npm_config_* 可见，
// 直接 node 调用时在此兜底读取（环境变量已显式设置时不覆盖）。
if (!process.env.ELECTRON_MIRROR && !process.env.npm_config_electron_mirror && !process.env.NPM_CONFIG_ELECTRON_MIRROR) {
  const npmrc = path.join(ROOT, '.npmrc');
  if (fs.existsSync(npmrc)) {
    const m = fs.readFileSync(npmrc, 'utf8').match(/^electron_mirror\s*=\s*(\S+)\s*$/m);
    if (m) process.env.ELECTRON_MIRROR = m[1];
  }
}

function log(msg) {
  console.log(`[ensure-native] ${msg}`);
}
function fail(msg) {
  console.error(`[ensure-native] ${msg}`);
  process.exit(1);
}

// ── 1. 平台守卫 ──
if (process.platform !== 'win32') {
  log('跳过（WASAPI addon 仅 Windows，macOS 系统音频走 ScreenCaptureKit）');
  process.exit(0);
}

// ── 2. 依赖漂移检查 ──
let electronPath;
try {
  electronPath = require('electron'); // npm 包导出 Electron 二进制路径；二进制缺失时会懒下载
} catch (e) {
  fail(`electron 不可用：${e?.message || e}（若是二进制下载失败，检查网络/代理后重试）`);
}
const installedVersion = JSON.parse(
  fs.readFileSync(path.join(path.dirname(require.resolve('electron')), 'package.json'), 'utf8'),
).version;
const declaredVersion = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
).devDependencies.electron;
if (installedVersion !== declaredVersion) {
  fail(`node_modules/electron ${installedVersion} 与 package.json 声明的 ${declaredVersion} 不一致，请先执行 pnpm install`);
}

// ── 2.5 native 目录依赖（node-addon-api）不进 git，全新环境需先安装 ──
if (!fs.existsSync(path.join(NATIVE_DIR, 'node_modules', 'node-addon-api'))) {
  log('native 目录依赖缺失（node-addon-api），执行 pnpm install ...');
  const runInstall = (args) =>
    spawnSync('pnpm', args, { cwd: NATIVE_DIR, stdio: 'inherit', shell: process.platform === 'win32' });
  const lockExists = fs.existsSync(path.join(NATIVE_DIR, 'pnpm-lock.yaml'));
  const r = runInstall(lockExists ? ['install', '--frozen-lockfile'] : ['install']);
  if (r.status !== 0) {
    fail('native 目录依赖安装失败（需 pnpm 可用且网络正常）');
  }
}

// ── 3. ABI 检查：addon + marker 缺一不可，marker 必须等于已安装版本，
//      且源码（.cc/.gyp）不得新于产物（addon 作者改代码后必须自动重编）──
function rebuildReasons() {
  const reasons = [];
  if (!fs.existsSync(ADDON_PATH)) reasons.push('addon 不存在');
  else if (!fs.existsSync(MARKER_PATH)) reasons.push('缺少编译版本标记');
  else if (fs.readFileSync(MARKER_PATH, 'utf8').trim() !== installedVersion)
    reasons.push('addon 编译时的 Electron 版本与当前不一致');
  else {
    const addonMtime = fs.statSync(ADDON_PATH).mtimeMs;
    for (const src of ['wasapi_loopback.cc', 'binding.gyp']) {
      const p = path.join(NATIVE_DIR, src);
      if (fs.existsSync(p) && fs.statSync(p).mtimeMs > addonMtime) reasons.push(`${src} 有更新`);
    }
  }
  return reasons;
}

let rebuilt = false;
const reasons = rebuildReasons();
if (reasons.length > 0) {
  log(`${reasons.join('、')}，用 Electron ${installedVersion} 官方 headers 重编 addon ...`);
  const r = spawnSync(
    'npx',
    ['node-gyp', 'rebuild', `--target=${installedVersion}`, '--dist-url=https://electronjs.org/headers'],
    { cwd: NATIVE_DIR, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (r.status !== 0) {
    fail(
      'node-gyp 编译失败。请确认：1) 已安装 VS2022「使用 C++ 的桌面开发」工作负载；' +
        '2) 若 headers 下载失败，检查 HTTP_PROXY/HTTPS_PROXY 代理设置（本项目有 Clash 代理前科）',
    );
  }
  fs.writeFileSync(MARKER_PATH, installedVersion);
  log(`重编完成，已记录编译版本 ${installedVersion}`);
  rebuilt = true;
} else {
  log(`addon 与 Electron ${installedVersion} 匹配，跳过重编`);
}

// ── 4. 拷贝到 dist-electron（冒烟从 dist-electron 加载，必须先拷贝）──
fs.mkdirSync(DEST_DIR, { recursive: true });
fs.copyFileSync(ADDON_PATH, path.join(DEST_DIR, 'wasapi_loopback.node'));
log('addon 已拷贝到 dist-electron/audio/native/build/Release/');

// ── 5. 重编后自动冒烟（真实 Electron 主进程：加载 addon + 采集 1s）──
if (rebuilt) {
  log('运行 smoke-addon 冒烟验证 ...');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // VSCode 集成终端会注入该变量，让 Electron 变纯 Node
  const r = spawnSync(electronPath, [path.join(__dirname, 'smoke-addon.cjs')], {
    cwd: ROOT,
    stdio: 'inherit',
    env,
  });
  if (r.status !== 0) {
    fail(`冒烟验证失败（exit ${r.status}），请按上方输出排查`);
  }
  log('冒烟验证通过');
}
