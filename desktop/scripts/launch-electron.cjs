/**
 * Start Electron only after a fresh main/preload compilation and this project's
 * Vite server are ready. Raw TCP checks accept unrelated or stale preview servers.
 */
const {spawn} = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const RENDERER_URL = 'http://127.0.0.1:5173';
const READY_PATH = '/__desktop_dev_ready__';
const POLL_INTERVAL_MS = 500;
const TIMEOUT_MS = 60000;
// concurrently starts Vite and this process together, in either order.
const LAUNCH_STARTED_AT = Date.now();

function matchesReadyServer(value, projectRoot, launchedAt) {
  return (
    !!value &&
    value.app === 'interview-desktop' &&
    value.root === projectRoot &&
    typeof value.startedAt === 'number' &&
    value.startedAt >= launchedAt - 5000
  );
}

function checkVite(launchedAt = LAUNCH_STARTED_AT) {
  return new Promise(resolve => {
    // node:http bypasses shell proxy variables for this loopback request.
    const request = http.get(
      `${RENDERER_URL}${READY_PATH}`,
      {agent: false, timeout: 1000},
      response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          body += chunk;
          if (body.length > 8192) {
            request.destroy();
            resolve(false);
          }
        });
        response.on('error', () => resolve(false));
        response.on('end', () => {
          try {
            resolve(
              response.statusCode === 200 &&
                matchesReadyServer(JSON.parse(body), PROJECT_ROOT, launchedAt),
            );
          } catch {
            resolve(false);
          }
        });
      },
    );
    request.once('error', () => resolve(false));
    request.once('timeout', () => {
      request.destroy();
      resolve(false);
    });
  });
}

function compileMain() {
  return new Promise((resolve, reject) => {
    const compiler = require.resolve('typescript/bin/tsc');
    const child = spawn(
      process.execPath,
      [compiler, '-p', 'electron/tsconfig.json', '--noEmitOnError'],
      {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
      },
    );
    child.once('error', reject);
    child.once('exit', code => {
      if (code !== 0) {
        reject(new Error('主进程编译失败，请修复上方 TypeScript 错误后重试'));
        return;
      }
      const entries = [
        'main.js',
        'preload.js',
        'windows/main-window.js',
        'windows/overlay-window.js',
      ];
      if (!entries.every(file => fs.existsSync(path.join(PROJECT_ROOT, 'dist-electron', file)))) {
        reject(new Error('主进程或 preload 编译产物缺失，请检查 electron/tsconfig.json'));
        return;
      }
      resolve();
    });
  });
}

async function waitForVite(launchedAt = LAUNCH_STARTED_AT) {
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    if (await checkVite(launchedAt)) return;
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(
    '未等到本次启动的桌面前端（127.0.0.1:5173）。请检查 Vite 是否启动失败或端口被旧预览占用；测试预览请使用其他端口。',
  );
}

async function main() {
  // An old main.js is not evidence that the current source or preload compiled.
  await Promise.all([compileMain(), waitForVite()]);
  const env = {...process.env, ELECTRON_RENDERER_URL: RENDERER_URL};
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), ['.'], {cwd: PROJECT_ROOT, stdio: 'inherit', env});
  child.once('exit', code => process.exit(code ?? 1));
  child.once('error', error => {
    console.error('[launch-electron] 启动失败:', error.message);
    process.exit(1);
  });
}

module.exports = {matchesReadyServer};
if (require.main === module)
  main().catch(error => {
    console.error('[launch-electron]', error.message);
    process.exit(1);
  });
