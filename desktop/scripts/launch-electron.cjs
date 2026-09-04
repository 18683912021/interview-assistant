/**
 * launch-electron.cjs —— 等 Vite 就绪 + tsc 编译出主进程入口后启动 Electron
 *
 * 三个坑：
 * 1. macOS 的 VSCode 集成终端会继承 ELECTRON_RUN_AS_NODE=1，该变量让 Electron
 *    以纯 Node 模式运行：require('electron') 返回空、窗口永远无法创建，且无报错。
 *    因此在 Node 层删除该变量再 spawn（Windows 无此问题，但脚本必须跨平台）。
 * 2. 原方案用 wait-on 探测 http://localhost:5173，但它会走 shell 的
 *    HTTP_PROXY/HTTPS_PROXY 代理（如 Clash），代理返回 502 时永远等不到就绪。
 *    改用 TCP 连接探测端口，完全不受代理影响。
 * 3. 必须同时等 tsc 产出 dist-electron/main.js：全新环境首次 dev 时 dist-electron
 *    为空，只等 Vite 端口会让 Electron 抢先启动，报 "Cannot find module main.js"
 *    弹错误对话框（Electron 加载 package.json main 入口失败，窗口永远起不来）。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const electronPath = require('electron'); // npm 包导出 Electron 二进制路径

const PORT = 5173;
const HOSTS = ['::1', '127.0.0.1']; // 依次探测 IPv6/IPv4 回环
const APP_ENTRY = path.join(__dirname, '..', 'dist-electron', 'main.js'); // tsc watch 的产物
const POLL_INTERVAL_MS = 500;
const TIMEOUT_MS = 60000;

function isPortOpen(host) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: PORT, timeout: 1000 });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

async function waitForReady() {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    let portOpen = false;
    for (const host of HOSTS) {
      if (await isPortOpen(host)) { portOpen = true; break; }
    }
    if (portOpen && fs.existsSync(APP_ENTRY)) return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  console.error(
    `[launch-electron] 等待就绪超时（${TIMEOUT_MS / 1000}s）：` +
    `Vite 端口 ${PORT} 或 ${APP_ENTRY} 未就绪。若 main.js 缺失，请检查 tsc 是否报类型错误`,
  );
  process.exit(1);
}

async function main() {
  await waitForReady();

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });

  child.on('exit', (code) => process.exit(code ?? 1));
  child.on('error', (err) => {
    console.error('[launch-electron] 启动失败:', err.message);
    process.exit(1);
  });
}

main();
