import {describe, expect, it, vi} from 'vitest';
import {prepareAudioStreams} from './capture-preparation';
import {DEFAULT_SETTINGS} from '../api/workspace';
vi.mock('../api/client', () => ({api: {}}));
const stream = (audio = true, deviceId = '', groupId = '', label = deviceId) => {
  const track = {
    stop: vi.fn(),
    readyState: 'live',
    label,
    getSettings: () => ({deviceId, groupId}),
  };
  return {
    getAudioTracks: () => (audio ? [track] : []),
    getVideoTracks: () => (audio ? [] : [track]),
    getTracks: () => [track],
  } as unknown as MediaStream;
};
describe('device preparation before interview creation', () => {
  it('keeps system audio unprocessed while requesting system-wide echo cancellation for the mic', async () => {
    const system = stream(true, 'loopback'),
      mic = stream(true, 'physical-mic');
    const getUserMedia = vi.fn().mockResolvedValueOnce(system).mockResolvedValueOnce(mic);
    const result = await prepareAudioStreams(
      {...DEFAULT_SETTINGS, system_device_id: 'loopback', microphone_id: 'physical-mic'},
      'both',
      {getUserMedia, getDisplayMedia: vi.fn()},
      true,
    );
    expect(result).toEqual({mic, system});
    expect(getUserMedia.mock.calls[0]?.[0].audio).toMatchObject({
      echoCancellation: false,
      noiseSuppression: false,
    });
    expect(getUserMedia.mock.calls[1]?.[0].audio).toMatchObject({
      echoCancellation: {exact: 'all'},
      noiseSuppression: true,
    });
  });
  it('rejects the same selected input before opening any audio stream', async () => {
    const getUserMedia = vi.fn(),
      getDisplayMedia = vi.fn();
    await expect(
      prepareAudioStreams(
        {...DEFAULT_SETTINGS, system_device_id: 'loopback', microphone_id: 'loopback'},
        'both',
        {getUserMedia, getDisplayMedia},
        true,
      ),
    ).rejects.toThrow('同一个输入');
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(getDisplayMedia).not.toHaveBeenCalled();
  });
  it('releases both tracks if default mic resolves to the selected system input', async () => {
    const mic = stream(true, 'loopback'),
      system = stream(true, 'loopback');
    await expect(
      prepareAudioStreams(
        {...DEFAULT_SETTINGS, system_device_id: 'loopback'},
        'both',
        {
          getUserMedia: vi.fn().mockResolvedValueOnce(system).mockResolvedValueOnce(mic),
          getDisplayMedia: vi.fn(),
        },
        true,
      ),
    ).rejects.toThrow('实际使用了同一个输入');
    expect(mic.getTracks()[0]!.stop).toHaveBeenCalledOnce();
    expect(system.getTracks()[0]!.stop).toHaveBeenCalledOnce();
  });
  it('detects a default-device alias of the system input by its resolved group', async () => {
    await expect(
      prepareAudioStreams(
        {...DEFAULT_SETTINGS, system_device_id: 'loopback'},
        'both',
        {
          getUserMedia: vi
            .fn()
            .mockResolvedValueOnce(stream(true, 'loopback', 'loopback-group'))
            .mockResolvedValueOnce(stream(true, 'default', 'loopback-group', 'Default - loopback')),
          getDisplayMedia: vi.fn(),
        },
        true,
      ),
    ).rejects.toThrow('实际使用了同一个输入');
  });
  it('does not confuse different input endpoints of the same default hardware group', async () => {
    const system = stream(true, 'loopback', 'interface', 'Playback'),
      mic = stream(true, 'default', 'interface', 'Default - Microphone');
    const result = await prepareAudioStreams(
      {...DEFAULT_SETTINGS, system_device_id: 'loopback'},
      'both',
      {
        getUserMedia: vi.fn().mockResolvedValueOnce(system).mockResolvedValueOnce(mic),
        getDisplayMedia: vi.fn(),
      },
      true,
    );
    expect(result).toEqual({mic, system});
  });
  it('allows distinct explicit input devices even when they share a hardware group', async () => {
    const system = stream(true, 'system-input', 'interface'),
      mic = stream(true, 'mic-input', 'interface');
    const result = await prepareAudioStreams(
      {...DEFAULT_SETTINGS, system_device_id: 'system-input', microphone_id: 'mic-input'},
      'both',
      {
        getUserMedia: vi.fn().mockResolvedValueOnce(system).mockResolvedValueOnce(mic),
        getDisplayMedia: vi.fn(),
      },
      true,
    );
    expect(result).toEqual({mic, system});
  });
  it('rejects a video-only sharing result and releases the shared screen before requesting the microphone', async () => {
    const videoOnly = stream(false),
      getUserMedia = vi.fn();
    await expect(
      prepareAudioStreams(
        DEFAULT_SETTINGS,
        'both',
        {getDisplayMedia: vi.fn().mockResolvedValue(videoOnly), getUserMedia},
        true,
      ),
    ).rejects.toThrow('系统音频未成功获取');
    expect(videoOnly.getTracks()[0]!.stop).toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });
  it('releases already prepared system audio if microphone permission is rejected', async () => {
    const system = stream();
    const denied = new Error('denied');
    denied.name = 'NotAllowedError';
    await expect(
      prepareAudioStreams(
        DEFAULT_SETTINGS,
        'both',
        {
          getDisplayMedia: vi.fn().mockResolvedValue(system),
          getUserMedia: vi.fn().mockRejectedValue(denied),
        },
        true,
      ),
    ).rejects.toThrow('未获音频权限');
    expect(system.getTracks()[0]!.stop).toHaveBeenCalled();
  });
  it('does not capture system audio for mic-only mode and releases input if preparation was cancelled', async () => {
    const mic = stream(),
      getDisplayMedia = vi.fn();
    let cancelled = false;
    await expect(
      prepareAudioStreams(
        DEFAULT_SETTINGS,
        'mic',
        {
          getDisplayMedia,
          getUserMedia: vi.fn(async () => {
            cancelled = true;
            return mic;
          }),
        },
        true,
        () => cancelled,
      ),
    ).rejects.toThrow('启动已取消');
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(mic.getTracks()[0]!.stop).toHaveBeenCalled();
  });
});
