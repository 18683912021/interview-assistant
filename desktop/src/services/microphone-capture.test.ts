import {describe, expect, it, vi} from 'vitest';
import {captureMicrophone, microphoneEchoMessage, microphoneEchoMode} from './microphone-capture';

const stream = (echoCancellation: unknown) =>
  ({
    getAudioTracks: () => [{getSettings: () => ({echoCancellation})}],
  }) as unknown as MediaStream;
const constraintError = (constraint: string) =>
  Object.assign(new Error('unsupported'), {
    name: 'OverconstrainedError',
    constraint,
  });

describe('microphone echo protection', () => {
  it('requests all system playback cancellation, preserving selected device and disabling AGC', async () => {
    const mic = stream('all'),
      getUserMedia = vi.fn().mockResolvedValue(mic);
    expect(await captureMicrophone({getUserMedia}, 'headset')).toBe(mic);
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({
      audio: {
        echoCancellation: {exact: 'all'},
        noiseSuppression: true,
        autoGainControl: false,
        channelCount: 1,
        deviceId: {exact: 'headset'},
      },
      video: false,
    });
    expect(microphoneEchoMode(mic)).toBe('all');
  });
  it('falls back to standard AEC only when the echo mode is unsupported', async () => {
    const mic = stream(true),
      getUserMedia = vi
        .fn()
        .mockRejectedValueOnce(constraintError('echoCancellation'))
        .mockResolvedValueOnce(mic);
    expect(await captureMicrophone({getUserMedia}, '')).toBe(mic);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1]?.[0].audio).toEqual({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
      channelCount: 1,
    });
    expect(microphoneEchoMode(mic)).toBe('standard');
    expect(microphoneEchoMessage(microphoneEchoMode(mic))).toContain('建议使用耳机');
  });
  it.each(['NotAllowedError', 'NotReadableError', 'NotFoundError'])(
    'does not mask %s with a weaker retry',
    async name => {
      const error = Object.assign(new Error('failed'), {name});
      const getUserMedia = vi.fn().mockRejectedValue(error);
      await expect(captureMicrophone({getUserMedia}, '')).rejects.toBe(error);
      expect(getUserMedia).toHaveBeenCalledOnce();
    },
  );
  it('does not replace a missing selected device with the default microphone', async () => {
    const error = constraintError('deviceId'),
      getUserMedia = vi.fn().mockRejectedValue(error);
    await expect(captureMicrophone({getUserMedia}, 'unplugged')).rejects.toBe(error);
    expect(getUserMedia).toHaveBeenCalledOnce();
  });
  it.each([false, undefined])(
    'does not report echo protection when track setting is %s',
    setting => {
      expect(microphoneEchoMode(stream(setting))).toBe('unavailable');
      expect(microphoneEchoMessage(microphoneEchoMode(stream(setting)))).toContain('无法确认');
    },
  );
  it('reports remote-only cancellation as standard, never as all-system cancellation', () => {
    expect(microphoneEchoMode(stream('remote-only'))).toBe('standard');
  });
});
