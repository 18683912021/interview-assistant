import type {Settings} from '../api/workspace';
import {captureMicrophone} from './microphone-capture';
import {messageOf} from '../utils/error-message';

export type PreparedStreams = {mic: MediaStream; system: MediaStream | null};
type MediaAccess = Pick<MediaDevices, 'getUserMedia' | 'getDisplayMedia'>;
export const SCREEN_AUDIO_FALLBACK = '__screen_capture__';
const systemConstraints: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
};
export function releaseStreams(streams: Partial<PreparedStreams>) {
  for (const stream of [streams.mic, streams.system])
    stream?.getTracks().forEach(track => track.stop());
}
export function audioPreparationError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError')
    return '未获音频权限或已取消选择。请在系统设置中允许本应用使用麦克风及所选音频来源，再重试。';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return '已选音频设备不可用，请重新选择设备或使用系统默认输入。';
  if (name === 'NotReadableError')
    return '音频输入或回声消除无法启动，请检查设备连接、麦克风与系统音频权限，并关闭正在独占设备的应用。';
  if (error instanceof Error && error.message.includes('Invalid capture constraints'))
    return '系统音频采集未能启动。请检查屏幕与系统音频录制权限，重新允许本应用后重启；也可以选择「仅麦克风」。';
  return error instanceof Error ? messageOf(error) : '音频准备失败，请检查设备后重试。';
}

async function captureSystemPlayback(media: MediaAccess): Promise<MediaStream> {
  try {
    return await media.getDisplayMedia({video: true, audio: true});
  } catch (error) {
    // Fetch only after the request fails, preserving the start click's user
    // activation. The main process stores no device names or captured content.
    const bridge = typeof window !== 'undefined' ? window.electronAPI?.audio : undefined;
    const failure = await bridge?.takeDisplayCaptureFailure?.().catch(() => null);
    if (failure) throw new Error(failure.message);
    throw error;
  }
}

/** Acquire permissions/devices before creating a session or opening billable provider streams. */
export async function prepareAudioStreams(
  settings: Settings,
  source: 'both' | 'mic',
  media: MediaAccess,
  isMac: boolean,
  cancelled: () => boolean = () => false,
): Promise<PreparedStreams> {
  const streams: Partial<PreparedStreams> = {};
  try {
    if (
      source === 'both' &&
      isMac &&
      settings.system_device_id &&
      settings.system_device_id === settings.microphone_id
    )
      throw new Error(
        '麦克风与系统音频选中了同一个输入。请将麦克风设为内置或耳机麦克风，系统音频选择电脑播放声音或独立虚拟输入。',
      );
    // Screen capture is an explicit fallback; native audio never requests a screen.
    if (source === 'both' && isMac && !settings.system_device_id) {
      const api = typeof window !== 'undefined' ? window.electronAPI?.audio : undefined;
      if (!api?.checkSystemAudio) throw new Error('纯系统音频需要最新版桌面客户端。');
      await api.checkSystemAudio();
    }
    if (source === 'both' && isMac && settings.system_device_id) {
      streams.system = settings.system_device_id !== SCREEN_AUDIO_FALLBACK
        ? await media.getUserMedia({
            audio: {...systemConstraints, deviceId: {exact: settings.system_device_id}},
          })
        : await captureSystemPlayback(media);
      if (!streams.system.getAudioTracks().some(track => track.readyState === 'live'))
        throw new Error(
          '系统音频未成功获取。请重新选择系统音频来源，或在设备设置中选择已配置的虚拟音频输入。',
        );
      // Only audio is needed. Do not keep the screen/video track running.
      streams.system.getVideoTracks().forEach(track => track.stop());
    }
    if (cancelled()) throw new Error('启动已取消');
    streams.mic = await captureMicrophone(media, settings.microphone_id);
    if (!streams.mic.getAudioTracks().some(track => track.readyState === 'live'))
      throw new Error('麦克风没有可用音轨，请重新选择输入设备。');
    if (streams.system && settings.system_device_id) {
      const micTrack = streams.mic.getAudioTracks()[0];
      const systemTrack = streams.system.getAudioTracks()[0];
      const mic = micTrack?.getSettings();
      const system = systemTrack?.getSettings();
      const isAlias = (id?: string) => id === 'default' || id === 'communications';
      // groupId alone identifies hardware, not an input endpoint. Require the
      // browser's default-device label to resolve to this same named endpoint.
      const endpoint = (label = '') =>
        label
          .replace(/^(?:default|communications|默认(?:设备)?|通信(?:设备)?)\s*(?:-|:|：|—)\s*/i, '')
          .trim();
      const sameEndpoint =
        endpoint(micTrack?.label) && endpoint(micTrack?.label) === endpoint(systemTrack?.label);
      if (
        (mic?.deviceId && mic.deviceId === system?.deviceId) ||
        ((isAlias(mic?.deviceId) || isAlias(system?.deviceId)) &&
          mic?.groupId &&
          mic.groupId === system?.groupId &&
          sameEndpoint)
      )
        throw new Error('麦克风与系统音频实际使用了同一个输入，请重新选择麦克风设备。');
    }
    if (cancelled()) throw new Error('启动已取消');
    return {mic: streams.mic, system: streams.system || null};
  } catch (error) {
    releaseStreams(streams);
    throw new Error(audioPreparationError(error));
  }
}
