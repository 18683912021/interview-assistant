import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  check: vi.fn(), request: vi.fn(), display: vi.fn(), sources: vi.fn(), dialog: vi.fn(),
  status: vi.fn(), getSwitch: vi.fn(), appendSwitch: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { commandLine: { getSwitchValue: mocks.getSwitch, appendSwitch: mocks.appendSwitch } },
  session: { defaultSession: {
    setPermissionCheckHandler: mocks.check, setPermissionRequestHandler: mocks.request,
    setDisplayMediaRequestHandler: mocks.display,
  } },
  desktopCapturer: { getSources: mocks.sources },
  dialog: { showMessageBox: mocks.dialog }, systemPreferences: { getMediaAccessStatus: mocks.status },
}));

import { allowMediaPermissions, configureSystemAudioCapture, getAudioPermissions } from '../audio/media-permissions.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dialog.mockResolvedValue({ response: 0 });
  mocks.sources.mockResolvedValue([{ id: 'screen:1:0', name: 'Display' }]);
  mocks.getSwitch.mockReturnValue('ExistingFlag');
  mocks.status.mockReturnValue('granted');
});

describe('desktop system audio permissions', () => {
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
    expect(callback).toHaveBeenCalledExactlyOnceWith({});
    expect(mocks.sources).not.toHaveBeenCalled();
  });

  it('rejects screen-only and unavailable sources with one callback', async () => {
    allowMediaPermissions();
    const callback = vi.fn();
    await mocks.display.mock.calls[0][0]({ audioRequested: false }, callback);
    expect(mocks.dialog).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledExactlyOnceWith({});
    mocks.sources.mockRejectedValue(new Error('denied'));
    const failed = vi.fn();
    await mocks.display.mock.calls[0][0]({ audioRequested: true }, failed);
    expect(failed).toHaveBeenCalledExactlyOnceWith({});
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
