// The parent owns cleanup: Windows keeps Chromium profile files open until the
// Electron process exits, even after its will-quit event.
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'interview-lifecycle-test-'));
const env = {...process.env, INTERVIEW_SMOKE_ROOT: tmp};
delete env.ELECTRON_RUN_AS_NODE;
let status = 1;
try {
  const result = spawnSync(require('electron'), [path.join(__dirname, 'smoke-app-lifecycle.cjs')], {stdio: 'inherit', env, timeout: 40000});
  if (result.error) throw result.error;
  status = result.status ?? 1;
} finally {
  fs.rmSync(tmp, {recursive: true, force: true, maxRetries: 8, retryDelay: 250});
}
process.exit(status);
