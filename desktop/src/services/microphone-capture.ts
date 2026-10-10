export type MicrophoneEchoMode = 'all' | 'standard' | 'unavailable';
type MicrophoneAccess = Pick<MediaDevices, 'getUserMedia'>;

/** TS 5.6 predates the standard's string-valued echoCancellation constraint. */
function microphoneConstraints(deviceId: string, all: boolean): MediaTrackConstraints {
  return {
    echoCancellation: all ? {exact: 'all'} : true,
    noiseSuppression: true,
    // Do not amplify quiet loudspeaker leakage between the candidate's words.
    autoGainControl: false,
    channelCount: 1,
    ...(deviceId ? {deviceId: {exact: deviceId}} : {}),
  } as unknown as MediaTrackConstraints;
}

export function microphoneEchoMode(stream: MediaStream): MicrophoneEchoMode {
  const setting: unknown = stream.getAudioTracks()[0]?.getSettings().echoCancellation;
  return setting === 'all'
    ? 'all'
    : setting === true || setting === 'remote-only'
      ? 'standard'
      : 'unavailable';
}

export function microphoneEchoMessage(mode: MicrophoneEchoMode): string {
  if (mode === 'all') return '外放回声消除已开启';
  if (mode === 'standard') return '当前仅支持常规回声消除，外放时建议使用耳机';
  return '无法确认回声消除，外放时请使用耳机';
}

/** Cancel playback from external meeting apps as well as our own renderer. */
export async function captureMicrophone(media: MicrophoneAccess, deviceId: string) {
  try {
    return await media.getUserMedia({audio: microphoneConstraints(deviceId, true), video: false});
  } catch (error) {
    // Fall back only when this echo mode is unsupported. Permission, missing
    // device and device-busy errors must remain actionable, without a retry.
    if (
      !(error instanceof Error) ||
      error.name !== 'OverconstrainedError' ||
      (error as OverconstrainedError).constraint !== 'echoCancellation'
    )
      throw error;
    return media.getUserMedia({audio: microphoneConstraints(deviceId, false), video: false});
  }
}
