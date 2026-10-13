import { app, desktopCapturer, dialog, session, shell, systemPreferences, type WebFrameMain } from 'electron';
import { release } from 'node:os';
import { execFile } from 'node:child_process';

type DisplayCaptureFailure = { code: string; message: string };
// Electron turns every rejected display callback into "Invalid capture
// constraints". Keep the actual reason scoped to the requesting frame.
const displayFailures = new WeakMap<WebFrameMain, DisplayCaptureFailure>();
export function takeDisplayCaptureFailure(frame: WebFrameMain | null): DisplayCaptureFailure | null {
  if (!frame) return null;
  const failure = displayFailures.get(frame) || null;
  displayFailures.delete(frame);
  return failure;
}

export async function openAudioPrivacySettings(kind: unknown): Promise<void> {
  if (process.platform !== 'darwin' || (kind !== 'microphone' && kind !== 'screen'))
    throw new Error('不支持的权限设置');
  // Only these two OS panels are allowed; never accept an arbitrary URL over IPC.
  await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${
    kind === 'screen' ? 'Privacy_ScreenCapture' : 'Privacy_Microphone'
  }`);
}

/** Called only from the user's permission button; does not start audio capture. */
export async function requestAudioPermission(kind: unknown) {
  if (process.platform !== 'darwin' || (kind !== 'microphone' && kind !== 'screen'))
    throw new Error('不支持的权限申请');
  if (systemPreferences.getMediaAccessStatus(kind) !== 'granted') {
    if (kind === 'microphone') {
      if (systemPreferences.getMediaAccessStatus('microphone') === 'not-determined')
        await systemPreferences.askForMediaAccess('microphone');
    } else {
      // Electron has no askForMediaAccess('screen'). Enumerating screens asks
      // macOS for access on first use, without opening a recording stream.
      try {
        await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      } catch { /* A denied request is handled by the targeted settings panel. */ }
    }
    // macOS does not repeat a rejected prompt; route directly to its OS panel.
    if (systemPreferences.getMediaAccessStatus(kind) !== 'granted')
      await openAudioPrivacySettings(kind);
  }
  return getAudioPermissions();
}

/** User-confirmed recovery for stale ad-hoc signatures; never grants access. */
export async function repairScreenPermission() {
  if (process.platform !== 'darwin' || !app.isPackaged)
    throw new Error('仅支持已安装的 Mac 客户端');
  const choice = await dialog.showMessageBox({
    type: 'question', title: '重新申请录屏权限',
    message: '清除本应用的旧授权，然后重新申请？',
    detail: '仅清除「AI面试助手」的屏幕与系统音频授权记录，不影响麦克风、其他应用或面试数据。随后请在系统弹框或设置中允许，再点击「已授权，重启应用」。',
    buttons: ['重新申请', '取消'], defaultId: 1, cancelId: 1, noLink: true,
  });
  if (choice.response !== 0) return getAudioPermissions();
  await new Promise<void>((resolve, reject) => {
    // This fixed bundle identifier matches electron-builder.yml. Never accept
    // a service, bundle id, executable or shell string from the renderer.
    execFile('/usr/bin/tccutil', ['reset', 'ScreenCapture', 'com.coagent.audio-capture'],
      { timeout: 10000 }, error => error ? reject(new Error('旧授权清理失败，请在系统设置中移除本应用后重新添加。')) : resolve());
  });
  return requestAudioPermission('screen');
}

function sourceFailure(): DisplayCaptureFailure {
  const screen = process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : '';
  if (screen === 'denied' || screen === 'restricted' || screen === 'not-determined')
    return { code: 'E_SCREEN_PERMISSION', message: 'macOS 尚未允许屏幕与系统音频录制。请打开系统权限设置，允许「AI面试助手」，然后完全退出并重新打开应用。' };
  return { code: 'E_SYSTEM_SOURCE', message: '系统音频来源无法打开。请检查屏幕与系统音频权限；若刚更新或重新安装应用，请在系统设置中重新确认授权，然后重启应用。' };
}

/** Must run before app.whenReady(); this compatibility switch exists in Electron 43. */
export function configureSystemAudioCapture(): void {
  if (process.platform !== 'darwin' || process.versions.electron?.split('.')[0] !== '43') return;
  const flags = new Set(app.commandLine.getSwitchValue('disable-features').split(',').filter(Boolean));
  // Only the explicitly selected legacy screen-capture route uses Chromium.
  // Default system audio uses our native Core Audio Tap and never enters here.
  flags.add('MacCatapLoopbackAudioForScreenShare');
  app.commandLine.appendSwitch('disable-features', [...flags].join(','));
}

export function getAudioPermissions() {
  return {
    platform: process.platform,
    osRelease: release(),
    electronVersion: process.versions.electron || '',
    canRepairScreenPermission: process.platform === 'darwin' && app.isPackaged,
    microphone: ['darwin', 'win32'].includes(process.platform)
      ? systemPreferences.getMediaAccessStatus('microphone') : 'unsupported',
    screen: process.platform === 'darwin'
      ? systemPreferences.getMediaAccessStatus('screen') : 'unsupported',
    systemAudioMode: process.platform === 'darwin' ? 'coreaudio-tap' : 'native-loopback',
  };
}

export function allowMediaPermissions(): void {
  const mediaPermission = (permission: string) => permission === 'media' || permission === 'display-capture';
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => mediaPermission(permission));
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(mediaPermission(permission)));
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const frame = request.frame;
    if (frame) displayFailures.delete(frame);
    const reject = (failure: DisplayCaptureFailure) => {
      if (frame) displayFailures.set(frame, failure);
      // Electron's documented rejection is null. An empty object throws
      // "Video was requested, but no video stream was provided" in 43.4.0.
      // Its TypeScript declaration omits null although the native API accepts it.
      (callback as (streams: Electron.Streams | null) => void)(null);
    };
    // Electron 43's useSystemPicker branch returns VIDEO ONLY even if audio is
    // requested (electron v43.4.0 lib/browser/api/session.ts). Explicit loopback
    // is necessary. All video tracks are discarded immediately by the renderer.
    if (!request.audioRequested) {
      reject({ code: 'E_AUDIO_REQUIRED', message: '未请求系统音频，请重新选择音频来源。' });
      return;
    }
    let streams: Electron.Streams = {};
    let failure: DisplayCaptureFailure | null = null;
    try {
      const choice = await dialog.showMessageBox({
        type: 'question', title: '采集系统声音',
        message: '允许转写电脑正在播放的声音？',
        detail: '这会包含其他应用播放的声音。macOS 可能要求允许屏幕与系统音频录制；画面不会保存或上传。',
        buttons: ['开始采集', '取消'], defaultId: 0, cancelId: 1, noLink: true,
      });
      if (choice.response !== 0) {
        failure = { code: 'E_CAPTURE_CANCELLED', message: '已取消系统音频采集。可重新开始，或选择「仅麦克风」。' };
      } else {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        if (!sources.length) failure = sourceFailure();
        else streams = { video: sources[0], audio: 'loopback' };
      }
    } catch {
      failure = sourceFailure();
    }
    // The native callback is one-shot; don't catch its own errors and call twice.
    if (failure) reject(failure);
    else callback(streams);
  }, { useSystemPicker: false });
}
