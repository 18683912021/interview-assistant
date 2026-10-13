/** Validate WASAPI for the requested Electron + platform + architecture.
 * Default smoke only loads the addon. Recording requires an explicit hardware smoke.
 * https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
 */
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {createRequire} = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const PE_MACHINES = {ia32: 0x14c, x64: 0x8664, arm64: 0xaa64};
const hash = value => createHash('sha256').update(value).digest('hex');

function sourceHash(nativeDir) {
  // mtimes are unreliable after copying artifacts or checking out another commit.
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      if (['build', 'node_modules', '.git'].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (
        /\.(?:cc|cpp|c|h|hpp|gyp|gypi)$/.test(entry.name) ||
        ['package.json', 'pnpm-lock.yaml'].includes(entry.name)
      )
        files.push(absolute);
    }
  };
  visit(nativeDir);
  const digest = createHash('sha256');
  for (const file of files.sort()) {
    digest.update(path.relative(nativeDir, file).split(path.sep).join('/'));
    digest.update('\0');
    digest.update(fs.readFileSync(file));
    digest.update('\0');
  }
  return digest.digest('hex');
}

function peArchitecture(bytes) {
  if (bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') return null;
  const offset = bytes.readUInt32LE(0x3c);
  if (offset > bytes.length - 6 || bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0')
    return null;
  const machine = bytes.readUInt16LE(offset + 4);
  return Object.keys(PE_MACHINES).find(arch => PE_MACHINES[arch] === machine) ?? null;
}

function inspectArtifact(nativeDir, target) {
  const addon = path.join(nativeDir, 'build', 'Release', 'wasapi_loopback.node');
  const marker = path.join(nativeDir, 'build', 'Release', '.electron-target');
  if (!fs.existsSync(addon)) return ['WASAPI addon 不存在'];
  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(marker, 'utf8'));
  } catch {
    return ['缺少完整的 Electron/架构编译记录（旧版本标记需要重建）'];
  }
  const problems = [];
  if (!metadata || metadata.format !== 1) return ['编译记录格式不匹配'];
  for (const key of ['electronVersion', 'platform', 'arch']) {
    if (metadata[key] !== target[key])
      problems.push(`${key} 不匹配：需要 ${target[key]}，现有 ${metadata[key]}`);
  }
  if (metadata.sourceHash !== sourceHash(nativeDir)) problems.push('原生源码或依赖已更新');
  const bytes = fs.readFileSync(addon);
  if (metadata.addonHash !== hash(bytes)) problems.push('addon 与编译记录不一致');
  if (peArchitecture(bytes) !== target.arch)
    problems.push(`addon 不是 Windows ${target.arch} 二进制`);
  return problems;
}

function configureElectronMirror(root) {
  if (
    process.env.ELECTRON_MIRROR ||
    process.env.npm_config_electron_mirror ||
    process.env.NPM_CONFIG_ELECTRON_MIRROR
  )
    return;
  const npmrc = path.join(root, '.npmrc');
  if (!fs.existsSync(npmrc)) return;
  const match = fs.readFileSync(npmrc, 'utf8').match(/^electron_mirror\s*=\s*(\S+)\s*$/m);
  if (match) process.env.ELECTRON_MIRROR = match[1];
}

function installedNodeGyp(root) {
  // Use the toolchain from the project's locked electron-builder dependency tree.
  // npx node-gyp could silently fetch a different release on a clean Windows host.
  const builder = createRequire(require.resolve('electron-builder', {paths: [root]}));
  const library = createRequire(builder.resolve('app-builder-lib'));
  const rebuild = createRequire(library.resolve('@electron/rebuild'));
  return rebuild.resolve('node-gyp/bin/node-gyp.js');
}

function ensureNative({
  root = ROOT,
  platform = process.platform,
  arch = process.arch,
  electronVersion,
  hostPlatform = process.platform,
  hostArch = process.arch,
} = {}) {
  const log = message => console.log(`[ensure-native] ${message}`);
  if (platform !== 'win32') {
    log(`跳过 ${platform}（WASAPI 仅 Windows，macOS 使用独立 Core Audio 组件）`);
    return;
  }
  if (!PE_MACHINES[arch]) throw new Error(`WASAPI 不支持目标架构 ${arch}`);
  const declaredVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    .devDependencies.electron;
  const entry = require.resolve('electron', {paths: [root]});
  const installedVersion = JSON.parse(
    fs.readFileSync(path.join(path.dirname(entry), 'package.json'), 'utf8'),
  ).version;
  const version = electronVersion ?? installedVersion;
  if (installedVersion !== declaredVersion || version !== installedVersion) {
    throw new Error(
      `Electron 版本不一致（声明 ${declaredVersion}，安装 ${installedVersion}，打包 ${version}），请先 pnpm install`,
    );
  }
  const nativeDir = path.join(root, 'electron', 'audio', 'native');
  const addon = path.join(nativeDir, 'build', 'Release', 'wasapi_loopback.node');
  const marker = path.join(nativeDir, 'build', 'Release', '.electron-target');
  const target = {electronVersion: version, platform, arch};
  const problems = inspectArtifact(nativeDir, target);
  if (problems.length) {
    if (hostPlatform !== 'win32') {
      throw new Error(
        `${problems.join('；')}。不能在 ${hostPlatform} 上编译 WASAPI；请在 Windows ${arch} 构建，或提供相同 Electron/架构/源码的已验证原生产物。已阻止生成缺少系统音频功能的 Windows 安装包。`,
      );
    }
    log(`${problems.join('；')}，重建 Electron ${version} / Windows ${arch}`);
    configureElectronMirror(root);
    // A failed build/load must not leave an apparently valid artifact for packaging.
    fs.rmSync(marker, {force: true});
    const run = (command, args, cwd, env = process.env) => {
      const result = spawnSync(command, args, {
        cwd,
        stdio: 'inherit',
        env,
        shell: command === 'pnpm',
      });
      if (result.error || result.status !== 0)
        throw new Error(`${command} 失败：${result.error?.message ?? `exit ${result.status}`}`);
    };
    if (!fs.existsSync(path.join(nativeDir, 'node_modules', 'node-addon-api'))) {
      run(
        'pnpm',
        [
          'install',
          ...(fs.existsSync(path.join(nativeDir, 'pnpm-lock.yaml')) ? ['--frozen-lockfile'] : []),
        ],
        nativeDir,
      );
    }
    run(
      process.execPath,
      [
        installedNodeGyp(root),
        'rebuild',
        `--target=${version}`,
        `--arch=${arch}`,
        '--dist-url=https://electronjs.org/headers',
      ],
      nativeDir,
    );
    if (peArchitecture(fs.readFileSync(addon)) !== arch)
      throw new Error(`node-gyp 生成的文件不是 Windows ${arch} addon`);
    if (arch !== hostArch) {
      throw new Error(
        `已编译 ${arch}，但当前 Electron 是 ${hostArch}，无法执行加载验证。请在 Windows ${arch} 构建环境完成验证后打包。`,
      );
    }
    const electronPath = require(entry);
    // Node mode uses installed Electron without opening any audio device or window.
    run(
      electronPath,
      [
        path.join(root, 'scripts', 'smoke-addon.cjs'),
        '--addon',
        addon,
        `--expect-electron=${version}`,
        `--expect-arch=${arch}`,
      ],
      root,
      {...process.env, ELECTRON_RUN_AS_NODE: '1'},
    );
    fs.writeFileSync(
      marker,
      JSON.stringify(
        {
          format: 1,
          ...target,
          sourceHash: sourceHash(nativeDir),
          addonHash: hash(fs.readFileSync(addon)),
        },
        null,
        2,
      ),
    );
  }
  const destination = path.join(root, 'dist-electron', 'audio', 'native', 'build', 'Release');
  fs.mkdirSync(destination, {recursive: true});
  fs.copyFileSync(addon, path.join(destination, 'wasapi_loopback.node'));
  fs.copyFileSync(marker, path.join(destination, '.electron-target'));
  log(`已验证并复制 Electron ${version} / Windows ${arch} addon（未录音）`);
}

function cliTarget(args) {
  const target = {};
  for (const arg of args) {
    const match = arg.match(/^--(platform|arch|electron-version)=(.+)$/);
    if (!match) throw new Error(`未知参数 ${arg}；使用 --platform=win32 --arch=x64`);
    target[match[1] === 'electron-version' ? 'electronVersion' : match[1]] = match[2];
  }
  return target;
}
module.exports = {ensureNative, inspectArtifact, peArchitecture, sourceHash, cliTarget};
if (require.main === module) {
  try {
    ensureNative(cliTarget(process.argv.slice(2)));
  } catch (error) {
    console.error(`[ensure-native] ${error.message}`);
    process.exitCode = 1;
  }
}
