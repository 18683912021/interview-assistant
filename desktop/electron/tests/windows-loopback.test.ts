import {describe, expect, it, vi} from 'vitest';
import {
  createWindowsLoopback,
  listSystemOutputs,
  type WindowsLoopbackAddon,
} from '../audio/windows-loopback';

function addon() {
  return {
    enumerateDevices: vi.fn(() => [{id: 'speaker-1', name: '扬声器', isDefault: true}]),
    WasapiLoopback: vi.fn(),
  } as unknown as WindowsLoopbackAddon;
}

describe('Windows playback device boundary', () => {
  it('does not even attempt to load a Windows module on macOS or Linux', () => {
    const load = vi.fn(() => {
      throw new Error('must never load');
    });
    expect(listSystemOutputs('darwin', load)).toEqual([]);
    expect(listSystemOutputs('linux', load)).toEqual([]);
    expect(() => createWindowsLoopback(undefined, 'darwin', load)).toThrow('仅适用于 Windows');
    expect(load).not.toHaveBeenCalled();
  });

  it('reports missing and outdated native components without pretending there are no devices', () => {
    expect(() =>
      listSystemOutputs('win32', () => {
        throw new Error('MODULE_NOT_FOUND');
      }),
    ).toThrow('组件无法加载');
    expect(() => listSystemOutputs('win32', () => ({}) as WindowsLoopbackAddon)).toThrow(
      '完整安装包',
    );
  });

  it('returns playback endpoint identifiers and the actual default device', () => {
    const native = addon();
    expect(listSystemOutputs('win32', () => native)).toEqual([
      {id: 'speaker-1', name: '扬声器', isDefault: true},
    ]);
    expect(native.WasapiLoopback).not.toHaveBeenCalled();
  });

  it('preserves native enumeration errors and rejects malformed device lists', () => {
    const native = addon();
    vi.mocked(native.enumerateDevices).mockImplementationOnce(() => {
      throw new Error('WASAPI HRESULT=0x88890004');
    });
    expect(() => listSystemOutputs('win32', () => native)).toThrow('HRESULT=0x88890004');
    vi.mocked(native.enumerateDevices).mockReturnValueOnce([
      {id: '', name: 'invalid', isDefault: true},
    ]);
    expect(() => listSystemOutputs('win32', () => native)).toThrow('设备信息无效');
  });

  it('passes a selected endpoint verbatim and uses the current default when unset', () => {
    const native = addon();
    createWindowsLoopback('headphones-{4A}', 'win32', () => native);
    createWindowsLoopback('', 'win32', () => native);
    createWindowsLoopback(undefined, 'win32', () => native);
    expect(native.WasapiLoopback).toHaveBeenNthCalledWith(1, 'headphones-{4A}');
    expect(native.WasapiLoopback).toHaveBeenNthCalledWith(2);
    expect(native.WasapiLoopback).toHaveBeenNthCalledWith(3);
  });
});
