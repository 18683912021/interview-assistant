import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  check: vi.fn(), request: vi.fn(), display: vi.fn(), sources: vi.fn(), dialog: vi.fn(),
  status: vi.fn(), ask: vi.fn(), getSwitch: vi.fn(), appendSwitch: vi.fn(), openExternal: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { commandLine: { getSwitchValue: mocks.getSwitch, appendSwitch: mocks.appendSwitch } },
  session: { defaultSession: {
    setPermissionCheckHandler: mocks.check, setPermissionRequestHandler: mocks.request,
    setDisplayMediaRequestHandler: mocks.display,
  } },
  desktopCapturer: { getSources: mocks.sources },
  dialog: { showMessageBox: mocks.dialog }, systemPreferences: { getMediaAccessStatus: mocks.status, askForMediaAccess: mocks.ask },
  shell: { openExternal: mocks.openExternal },
}));

import { allowMediaPermissions, configureSystemAudioCapture, getAudioPermissions, openAudioPrivacySettings, requestAudioPermission, takeDisplayCaptureFailure } from '../audio/media-permissions.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dialog.mockResolvedValue({ response: 0 });
  mocks.sources.mockResolvedValue([{ id: 'screen:1:0', name: 'Display' }]);
  mocks.getSwitch.mockReturnValue('ExistingFlag');
  mocks.status.mockReturnValue('granted');
});

describe('desktop system audio permissions', () => {
  it('requests an undecided microphone permission and does not open settings after approval', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    mocks.status.mockReturnValue('not-determined');
    mocks.ask.mockImplementation(async () => { mocks.status.mockReturnValue('granted'); return true; });
    try {
      const result = await requestAudioPermission('microphone');
      expect(result.microphone).toBe('granted');
      expect(mocks.ask).toHaveBeenCalledExactlyOnceWith('microphone');
      expect(mocks.openExternal).not.toHaveBeenCalled();
      expect(mocks.sources).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); }
  });

  it.each(['screen', 'microphone'])('routes a denied %s permission to its exact settings panel', async kind => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    mocks.status.mockReturnValue('denied');
    mocks.sources.mockRejectedValue(new Error('denied'));
    try {
      await requestAudioPermission(kind);
      expect(mocks.ask).not.toHaveBeenCalled();
      expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(
        `x-apple.systempreferences:com.apple.preference.security?Privacy_${kind === 'screen' ? 'ScreenCapture' : 'Microphone'}`,
      );
      expect(mocks.sources).toHaveBeenCalledTimes(kind === 'screen' ? 1 : 0);
    } finally { vi.restoreAllMocks(); }
  });

  it('does not request an already granted permission or any unsupported permission', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    try {
      await requestAudioPermission('screen');
      await requestAudioPermission('microphone');
      await expect(requestAudioPermission('camera')).rejects.toThrow('不支持');
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      await expect(requestAudioPermission('screen')).rejects.toThrow('不支持');
      expect(mocks.ask).not.toHaveBeenCalled();
      expect(mocks.sources).not.toHaveBeenCalled();
      expect(mocks.openExternal).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); }
  });
  it('provides an explicit loopback track after confirmation, not the video-only native picker', async () => {
    allowMediaPermissions();
    const [handler, opts] = mocks.display.mock.calls[0];
    expect(opts).toEqual({ useSystemPicker: false });
    const callback = vi.fn();
    await handler({ audioRequested: true }, callback);
    expect(callback).toHaveBeenCalledExactlyOnceWith({ video: { id: 'screen:1:0', name: 'Display' }, audio: 'loopback' });
    expect(mocks.sources).toHaveBeenCalledWith({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    expect(mocks.check.mock.calls[0][0](null, 'media')).toBe(true);
    expect(mocks.check.mock.calls[0][0](null, 'display-capture')).toBe(true);
    expect(mocks.check.mock.calls[0][0](null, 'geolocation')).toBe(false);
  });

  it('does not enumerate or capture a screen when the user cancels', async () => {
    mocks.dialog.mockResolvedValue({ response: 1 });
    allowMediaPermissions();
    const callback = vi.fn();
    await mocks.display.mock.calls[0][0]({ audioRequested: true }, callback);
    expect(callback).toHaveBeenCalledExactlyOnceWith(null);
    expect(mocks.sources).not.toHaveBeenCalled();
  });

  it('preserves a cancelled request reason only for its requesting frame and consumes it once', async () => {
    const frame = {} as Electron.WebFrameMain;
    mocks.dialog.mockResolvedValue({ response: 1 });
    allowMediaPermissions();
    const callback = vi.fn();
    await mocks.display.mock.calls[0][0]({ audioRequested: true, frame }, callback);
    expect(callback).toHaveBeenCalledExactlyOnceWith(null);
    expect(takeDisplayCaptureFailure({} as Electron.WebFrameMain)).toBeNull();
    expect(takeDisplayCaptureFailure(frame)).toMatchObject({ code: 'E_CAPTURE_CANCELLED' });
    expect(takeDisplayCaptureFailure(frame)).toBeNull();
    expect(takeDisplayCaptureFailure(null)).toBeNull();
  });

  it.each(['reject', 'empty'])('explains missing macOS screen permission when sources %s', async result => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const frame = {} as Electron.WebFrameMain;
    mocks.status.mockReturnValue('denied');
    if (result === 'reject') mocks.sources.mockRejectedValue(new Error('Failed to get sources'));
    else mocks.sources.mockResolvedValue([]);
    allowMediaPermissions();
    const callback = vi.fn();
    try {
      await mocks.display.mock.calls[0][0]({ audioRequested: true, frame }, callback);
      expect(callback).toHaveBeenCalledExactlyOnceWith(null);
      expect(takeDisplayCaptureFailure(frame)).toMatchObject({
        code: 'E_SCREEN_PERMISSION', message: expect.stringContaining('macOS 尚未允许'),
      });
    } finally { vi.restoreAllMocks(); }
  });

  it('does not reuse an earlier failure after a successful retry', async () => {
    const frame = {} as Electron.WebFrameMain;
    mocks.dialog.mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 0 });
    allowMediaPermissions();
    const handler = mocks.display.mock.calls[0][0];
    await handler({ audioRequested: true, frame }, vi.fn());
    const callback = vi.fn();
    await handler({ audioRequested: true, frame }, callback);
    expect(callback).toHaveBeenCalledExactlyOnceWith({ video: { id: 'screen:1:0', name: 'Display' }, audio: 'loopback' });
    expect(takeDisplayCaptureFailure(frame)).toBeNull();
  });

  it.each([0, 1])('calls the native callback once even if it throws (choice %s)', async response => {
    mocks.dialog.mockResolvedValue({ response });
    allowMediaPermissions();
    const callback = vi.fn(() => { throw new Error('native callback failed'); });
    await expect(mocks.display.mock.calls[0][0]({ audioRequested: true }, callback)).rejects.toThrow('native callback failed');
    expect(callback).toHaveBeenCalledOnce();
  });

  it('opens only the two supported macOS permission panels', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    try {
      await openAudioPrivacySettings('screen');
      expect(mocks.openExternal).toHaveBeenLastCalledWith('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
      await openAudioPrivacySettings('microphone');
      expect(mocks.openExternal).toHaveBeenLastCalledWith('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
      await expect(openAudioPrivacySettings('https://example.com')).rejects.toThrow('不支持');
      expect(mocks.openExternal).toHaveBeenCalledTimes(2);
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      await expect(openAudioPrivacySettings('screen')).rejects.toThrow('不支持');
      expect(mocks.openExternal).toHaveBeenCalledTimes(2);
    } finally { vi.restoreAllMocks(); }
  });

  it('rejects screen-only and unavailable sources with one callback', async () => {
    allowMediaPermissions();
    const callback = vi.fn();
    await mocks.display.mock.calls[0][0]({ audioRequested: false }, callback);
    expect(mocks.dialog).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledExactlyOnceWith(null);
    mocks.sources.mockRejectedValue(new Error('denied'));
    const failed = vi.fn();
    await mocks.display.mock.calls[0][0]({ audioRequested: true }, failed);
    expect(failed).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('reads permission state without requesting capture', () => {
    const result = getAudioPermissions();
    expect(result.platform).toBe(process.platform);
    expect(typeof result.osRelease).toBe('string');
    expect(mocks.dialog).not.toHaveBeenCalled();
    expect(mocks.sources).not.toHaveBeenCalled();
  });

  it('limits the compatibility flag to Electron 43 on macOS and preserves existing flags', () => {
    const electron = Object.getOwnPropertyDescriptor(process.versions, 'electron');
    Object.defineProperty(process.versions, 'electron', { value: '43.4.0', configurable: true });
    try {
      configureSystemAudioCapture();
      if (process.platform === 'darwin') {
        expect(mocks.appendSwitch).toHaveBeenCalledWith('disable-features', 'ExistingFlag,MacCatapLoopbackAudioForScreenShare');
      } else expect(mocks.appendSwitch).not.toHaveBeenCalled();
      mocks.appendSwitch.mockClear();
      Object.defineProperty(process.versions, 'electron', { value: '45.0.0', configurable: true });
      configureSystemAudioCapture();
      expect(mocks.appendSwitch).not.toHaveBeenCalled();
    } finally {
      if (electron) Object.defineProperty(process.versions, 'electron', electron);
      else delete process.versions.electron;
    }
  });
});
