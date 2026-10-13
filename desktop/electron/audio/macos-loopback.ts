import {playMacTestTone} from './audio-self-test.js';
import {release} from 'node:os';
import type {WasapiCapture} from './windows-loopback.js';

export function supportsMacAudio(version = release()): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > 23 || (major === 23 && minor >= 2);
}
export function createMacLoopback(): WasapiCapture {
  if (process.platform !== 'darwin' || !supportsMacAudio())
    throw new Error('纯系统音频需要 macOS 14.2 或更新版本。请升级系统，或手动选择「屏幕采集兼容模式」。');
  try {
    // In-process N-API keeps permission attribution with the installed app.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./mac-native/coreaudio_tap.node').createCapture() as WasapiCapture;
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    if (reason.includes('Core Audio') || reason.includes('macOS 授权')) throw error;
    throw new Error('纯系统音频组件无法加载，请安装完整的最新版客户端，或手动选择屏幕采集兼容模式。', {cause: error});
  }
}
let cancelCheck: (() => void) | null = null;
export function cancelMacAudioCheck() { cancelCheck?.(); }
let checking: Promise<{sampleRate: number; channels: number; signal: boolean}> | null = null;
/** Local-only short probe. Never opens a socket or creates a video stream.
 * Receiving silent PCM is NOT proof of permission: macOS may return silence after denial.
 */
export function checkMacAudio() {
  if (checking) return checking;
  const capture = createMacLoopback();
  const probe = probeMacAudio(capture, playMacTestTone);
  cancelCheck = probe.cancel;
  checking = probe.result.finally(() => { checking = null; cancelCheck = null; });
  return checking;
}

/** Exported boundary for hardware-free lifecycle tests. */
export function probeMacAudio(capture: WasapiCapture, playTone: () => () => void) {
  let cancel = () => {};
  const result = new Promise<{sampleRate: number; channels: number; signal: boolean}>((resolve, reject) => {
    let received = false, signal = false, settled = false, started = false;
    let stopTone: (() => void) | undefined;
    let sampleTimer: NodeJS.Timeout | undefined;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(sampleTimer);
      stopTone?.(); capture.stop();
      if (error) reject(error);
      else if (received) resolve({sampleRate: capture.sampleRate, channels: capture.channels, signal});
      else reject(new Error('系统音频自检未通过。请点击重新检查；若仍失败，请在音频权限设置中允许当前版本，再重启应用。无需自行播放声音。'));
    };
    // Permission may take time. Only play after HAL has finished starting.
    const timer = setTimeout(() => finish(), 30000);
    cancel = () => finish(new Error('音频检测已取消'));
    try {
      capture.start((error, buffer) => {
        if (settled) return;
        if (error) { finish(error); return; }
        if (!started) {
          started = true;
          try { stopTone = playTone(); }
          catch { finish(new Error('无法播放本机测试音，请重新检查系统音频。')); return; }
          sampleTimer = setTimeout(() => finish(), 3000);
        }
        if (!buffer?.length) return;
        received = true;
        for (let offset = 0; offset + 4 <= buffer.length; offset += 4)
          if (Math.abs(buffer.readFloatLE(offset)) > 0.0001) { signal = true; break; }
      });
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  });
  return {result, cancel: () => cancel()};
}
