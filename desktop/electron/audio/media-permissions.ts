import { app, desktopCapturer, dialog, session, systemPreferences } from 'electron';
import { release } from 'node:os';

/** Must run before app.whenReady(); this compatibility switch exists in Electron 43. */
export function configureSystemAudioCapture(): void {
  if (process.platform !== 'darwin' || process.versions.electron?.split('.')[0] !== '43') return;
  const flags = new Set(app.commandLine.getSwitchValue('disable-features').split(',').filter(Boolean));
  // Electron 43's CoreAudio Tap may fail without asking the responsible terminal
  // for permission. Its documented ScreenCaptureKit path uses OS screen approval.
  flags.add('MacCatapLoopbackAudioForScreenShare');
  app.commandLine.appendSwitch('disable-features', [...flags].join(','));
}

export function getAudioPermissions() {
  return {
    platform: process.platform,
    osRelease: release(),
    electronVersion: process.versions.electron || '',
    microphone: ['darwin', 'win32'].includes(process.platform)
      ? systemPreferences.getMediaAccessStatus('microphone') : 'unsupported',
    screen: process.platform === 'darwin'
      ? systemPreferences.getMediaAccessStatus('screen') : 'unsupported',
    systemAudioMode: process.platform === 'darwin' ? 'screen-capture-loopback' : 'native-loopback',
  };
}

export function allowMediaPermissions(): void {
  const mediaPermission = (permission: string) => permission === 'media' || permission === 'display-capture';
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => mediaPermission(permission));
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(mediaPermission(permission)));
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    // Electron 43's useSystemPicker branch returns VIDEO ONLY even if audio is
    // requested (electron v43.4.0 lib/browser/api/session.ts). Explicit loopback
    // is necessary. All video tracks are discarded immediately by the renderer.
    if (!request.audioRequested) { callback({}); return; }
    try {
      const choice = await dialog.showMessageBox({
        type: 'question', title: '采集系统声音',
        message: '允许转写电脑正在播放的声音？',
        detail: '这会包含其他应用播放的声音。macOS 可能要求允许屏幕与系统音频录制；画面不会保存或上传。',
        buttons: ['开始采集', '取消'], defaultId: 0, cancelId: 1, noLink: true,
      });
      if (choice.response !== 0) { callback({}); return; }
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      if (!sources.length) { callback({}); return; }
      callback({ video: sources[0], audio: 'loopback' });
    } catch {
      callback({});
    }
  }, { useSystemPicker: false });
}
