const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {createHash} = require('node:crypto');
function ensureMacAudio({root = path.resolve(__dirname, '..'), platform = process.platform, arch = process.arch} = {}) {
  if (platform !== 'darwin') return;
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(arch))
    throw new Error('Core Audio must be built on macOS for arm64 or x64');
  const src = path.join(root, 'electron/audio/mac-native/coreaudio-tap.mm');
  const dir = path.join(root, 'dist-electron/audio/mac-native');
  const out = path.join(dir, 'coreaudio_tap.node');
  // Stable N-API uses the installed Node headers; no Electron ABI rebuild needed.
  const candidates = [process.env.NODE_INCLUDE_DIR, path.resolve(process.execPath, '../../include/node'),
    path.join(require('node:os').homedir(), '.cache/node-gyp', process.versions.node, 'include/node')].filter(Boolean);
  const include = candidates.find(p => fs.existsSync(path.join(p, 'node_api.h')));
  if (!include) throw new Error('Node headers missing: set NODE_INCLUDE_DIR to an official Node include/node directory');
  const sdk = execFileSync('xcrun', ['--show-sdk-path'], {encoding: 'utf8'}).trim();
  const hash = createHash('sha256').update(fs.readFileSync(src)).update(fs.readFileSync(__filename)).update(arch + sdk).digest('hex');
  fs.mkdirSync(dir, {recursive: true});
  if (!fs.existsSync(out) || !fs.existsSync(out + '.sha256') || fs.readFileSync(out + '.sha256', 'utf8') !== hash) {
    const temp = out + '.tmp';
    try {
      execFileSync('xcrun', ['clang++', '-std=c++17', '-fobjc-arc', '-bundle', '-undefined', 'dynamic_lookup',
        '-arch', arch === 'x64' ? 'x86_64' : 'arm64', '-isysroot', sdk, '-mmacosx-version-min=14.2',
        '-DNAPI_VERSION=8', '-I', include, '-framework', 'Foundation', '-framework', 'CoreAudio', src, '-o', temp], {stdio: 'inherit'});
      fs.renameSync(temp, out); fs.writeFileSync(out + '.sha256', hash);
    } finally { fs.rmSync(temp, {force: true}); }
  }
  execFileSync('lipo', [out, '-verify_arch', arch === 'x64' ? 'x86_64' : arch]);
  return out;
}
module.exports = {ensureMacAudio};
if (require.main === module) ensureMacAudio();
