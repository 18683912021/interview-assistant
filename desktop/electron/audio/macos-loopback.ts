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
  checking = new Promise<{sampleRate: number; channels: number; signal: boolean}>((resolve, reject) => {
    let received = false, signal = false, settled = false;
    let sampleTimer: NodeJS.Timeout | null = null;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); if (sampleTimer) clearTimeout(sampleTimer);
      capture.stop();
      if (error) reject(error);
      else if (received) resolve({sampleRate: capture.sampleRate, channels: capture.channels, signal});
      else reject(new Error('没有收到系统音频数据。请检查系统音频录制权限，退出并重新打开应用后重试。'));
    };
    // First use may wait for the user's OS permission prompt; keep UI responsive.
    const timer = setTimeout(() => finish(), 30000);
    cancelCheck = () => finish(new Error('音频检测已取消'));
    try {
      capture.start((error, buffer) => {
        if (settled) return;
        if (error) { finish(error); return; }
        if (!buffer?.length) return;
        if (!received) sampleTimer = setTimeout(() => finish(), 1200);
        received = true;
        for (let offset = 0; offset + 4 <= buffer.length; offset += 4)
          if (Math.abs(buffer.readFloatLE(offset)) > 0.0001) { signal = true; break; }
      });
    } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
  }).finally(() => { checking = null; cancelCheck = null; });
  return checking;
}
