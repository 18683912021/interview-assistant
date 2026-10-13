import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const require = createRequire(import.meta.url);
const {ensureNative, inspectArtifact, sourceHash, cliTarget} = require('./ensure-native.cjs');
const beforePack = require('./before-pack.cjs');
const target = {electronVersion: '43.4.0', platform: 'win32', arch: 'x64'};
let root: string;
let native: string;
let addon: string;
let marker: string;
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

function artifact(machine = 0x8664) {
  // PE header fixture: these tests check build gating, not native execution.
  const bytes = Buffer.alloc(128);
  bytes.write('MZ');
  bytes.writeUInt32LE(64, 0x3c);
  bytes.write('PE\0\0', 64);
  bytes.writeUInt16LE(machine, 68);
  writeFileSync(addon, bytes);
  writeFileSync(
    marker,
    JSON.stringify({
      format: 1,
      ...target,
      sourceHash: sourceHash(native),
      addonHash: sha256(bytes),
    }),
  );
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'interview-native-'));
  native = path.join(root, 'electron/audio/native');
  mkdirSync(path.join(native, 'build/Release'), {recursive: true});
  addon = path.join(native, 'build/Release/wasapi_loopback.node');
  marker = path.join(native, 'build/Release/.electron-target');
  writeFileSync(path.join(native, 'wasapi_loopback.cc'), 'fixture source');
  writeFileSync(path.join(native, 'binding.gyp'), '{}');
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({devDependencies: {electron: target.electronVersion}}),
  );
  mkdirSync(path.join(root, 'node_modules/electron'), {recursive: true});
  writeFileSync(
    path.join(root, 'node_modules/electron/package.json'),
    JSON.stringify({version: target.electronVersion, main: 'index.js'}),
  );
  writeFileSync(
    path.join(root, 'node_modules/electron/index.js'),
    'throw new Error("must not launch Electron while cross-packaging")',
  );
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  rmSync(root, {recursive: true, force: true});
  vi.restoreAllMocks();
});

describe('native packaging gate', () => {
  it('leaves macOS builds independent of Windows sources and SDKs', async () => {
    rmSync(path.join(root, 'electron'), {recursive: true});
    ensureNative({root, platform: 'darwin', arch: 'arm64'});
    expect(existsSync(path.join(root, 'dist-electron'))).toBe(false);
  });

  it('fails closed for missing Windows native output on a Mac host', () => {
    expect(() => ensureNative({root, ...target, hostPlatform: 'darwin'})).toThrow('已阻止生成');
    expect(existsSync(path.join(root, 'dist-electron'))).toBe(false);
  });

  it('accepts recorded matching Windows output without trying to run it on Mac', () => {
    artifact();
    ensureNative({root, ...target, hostPlatform: 'darwin'});
    expect(
      readFileSync(
        path.join(root, 'dist-electron/audio/native/build/Release/wasapi_loopback.node'),
      ),
    ).toEqual(readFileSync(addon));
  });

  it('rejects a 32-bit binary even when metadata claims x64', () => {
    artifact(0x14c);
    expect(inspectArtifact(native, target)).toContain('addon 不是 Windows x64 二进制');
    expect(() => ensureNative({root, ...target, hostPlatform: 'darwin'})).toThrow('已阻止生成');
  });

  it('requires rebuilding legacy version-only markers and corrupt metadata', () => {
    artifact();
    for (const record of ['43.4.0', 'null', '{broken']) {
      writeFileSync(marker, record);
      expect(() => ensureNative({root, ...target, hostPlatform: 'darwin'})).toThrow('已阻止生成');
    }
  });

  it('rejects changed source and changed binaries regardless of mtimes', () => {
    artifact();
    writeFileSync(path.join(native, 'wasapi_loopback.cc'), 'new device switching implementation');
    expect(inspectArtifact(native, target)).toContain('原生源码或依赖已更新');
    artifact();
    const modified = readFileSync(addon);
    modified[100] = 1;
    writeFileSync(addon, modified);
    expect(inspectArtifact(native, target)).toContain('addon 与编译记录不一致');
  });

  it('checks new headers and dependency lock changes too', () => {
    artifact();
    writeFileSync(path.join(native, 'capture-format.h'), 'new header');
    expect(inspectArtifact(native, target)).toContain('原生源码或依赖已更新');
    artifact();
    writeFileSync(path.join(native, 'pnpm-lock.yaml'), 'dependency changed');
    expect(inspectArtifact(native, target)).toContain('原生源码或依赖已更新');
  });

  it('checks packaging target architecture and Electron version, not only the host', async () => {
    artifact();
    expect(inspectArtifact(native, {...target, arch: 'arm64'}).join('；')).toContain('arch 不匹配');
    await expect(
      beforePack({
        arch: 3,
        electronPlatformName: 'win32',
        packager: {projectDir: root, info: {framework: {version: '44.0.0'}}},
      }),
    ).rejects.toThrow('Electron 版本不一致');
    expect(() =>
      ensureNative({root, ...target, electronVersion: '44.0.0', hostPlatform: 'darwin'}),
    ).toThrow('Electron 版本不一致');
  });

  it('parses explicit targets and rejects typos instead of silently using the host', () => {
    expect(cliTarget(['--platform=win32', '--arch=x64', '--electron-version=43.4.0'])).toEqual(
      target,
    );
    expect(() => cliTarget(['--arhc=x64'])).toThrow('未知参数');
  });
});

it('default smoke loads the addon without constructing a recorder or loading Electron UI', () => {
  const constructed = vi.fn();
  class Recorder {
    constructor() {
      constructed();
    }
    start() {}
    stop() {}
  }
  const exit = new Error('expected process exit');
  const exitCodes: number[] = [];
  const source = readFileSync(path.join(__dirname, 'smoke-addon.cjs'), 'utf8');
  expect(() =>
    runInNewContext(source, {
      __dirname,
      console,
      process: {
        platform: 'win32',
        arch: 'x64',
        versions: {electron: '43.4.0'},
        argv: ['electron', 'smoke-addon.cjs'],
        env: {},
        exit: (code: number) => {
          exitCodes.push(code);
          throw exit;
        },
      },
      require: (name: string) => {
        if (name === 'node:path') return path;
        if (name.endsWith('.node'))
          return {
            WasapiLoopback: Recorder,
            enumerateDevices() {
              throw new Error('must not inspect hardware');
            },
          };
        throw new Error(`Unexpected module access: ${name}`);
      },
    }),
  ).toThrow(exit);
  expect(exitCodes).toEqual([0]);
  expect(constructed).not.toHaveBeenCalled();
});

it.each([
  {name: 'a real PCM buffer', events: [[null, Buffer.from([1, 2])]], success: true},
  {
    name: 'an error instead of a frame',
    events: [[new Error('device removed'), null]],
    success: false,
  },
  {
    name: 'valid PCM followed by a device error',
    events: [
      [null, Buffer.from([1, 2])],
      [new Error('device removed'), null],
    ],
    success: false,
  },
  {name: 'empty data', events: [[null, Buffer.alloc(0)]], success: false},
])('hardware smoke handles $name without counting errors as audio', async ({events, success}) => {
  vi.useFakeTimers();
  const app = {
    commandLine: {appendSwitch: vi.fn()},
    whenReady: () => Promise.resolve(),
    exit: vi.fn(),
    quit: vi.fn(),
  };
  class Recorder {
    start(callback: (error: Error | null, frame: Buffer | null) => void) {
      for (const [error, frame] of events) callback(error as Error | null, frame as Buffer | null);
      return true;
    }
    stop() {}
  }
  class Window {
    loadURL() {
      return Promise.resolve();
    }
    destroy() {}
    isDestroyed() {
      return false;
    }
  }
  const session = {
    defaultSession: {setPermissionCheckHandler() {}, setPermissionRequestHandler() {}},
  };
  try {
    runInNewContext(readFileSync(path.join(__dirname, 'smoke-addon.cjs'), 'utf8'), {
      __dirname,
      console: {log: vi.fn(), error: vi.fn()},
      Buffer,
      setTimeout,
      process: {
        platform: 'win32',
        arch: 'x64',
        versions: {electron: '43.4.0'},
        argv: ['electron', 'smoke-addon.cjs', '--hardware'],
        env: {},
        exit: vi.fn(),
      },
      require: (name: string) => {
        if (name === 'node:path') return path;
        if (name === 'electron') return {app, session, BrowserWindow: Window};
        if (name.endsWith('.node')) return {WasapiLoopback: Recorder, enumerateDevices() {}};
        throw new Error(`Unexpected module access: ${name}`);
      },
    });
    await vi.advanceTimersByTimeAsync(1500);
    if (success) {
      expect(app.quit).toHaveBeenCalledOnce();
      expect(app.exit).not.toHaveBeenCalled();
    } else {
      expect(app.exit).toHaveBeenCalledWith(1);
      expect(app.quit).not.toHaveBeenCalled();
    }
  } finally {
    vi.useRealTimers();
  }
});
