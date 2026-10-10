import {describe, expect, it} from 'vitest';
import {
  accountSettings,
  assertSystemOutput,
  desktopPlatform,
  saveLocalAudioDevices,
  withLocalAudioDevices,
} from './audio-device-settings';
import type {Settings} from '../api/workspace';
const settings: Settings = {
  theme: 'dark',
  font_size: 16,
  language: 'auto',
  answer_length: 'brief',
  answer_style: 'conversational',
  microphone_id: 'remote-mic',
  system_device_id: 'mac-virtual-input',
};
const storage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};
describe('platform-local audio devices', () => {
  it('preserves existing Mac device choices when migrating to per-platform storage', () => {
    const local = storage();
    local.setItem(
      'interview_audio_devices',
      JSON.stringify({microphone_id: 'builtin', system_device_id: 'blackhole'}),
    );
    const value = withLocalAudioDevices(settings, 'mac', local);
    expect(value).toMatchObject({
      microphone_id: 'builtin',
      system_device_id: 'blackhole',
      theme: 'dark',
    });
    saveLocalAudioDevices(value, 'mac', local);
    expect(withLocalAudioDevices(settings, 'mac', local)).toEqual(value);
  });
  it('never imports remote or legacy Mac output ids into Windows endpoint selection', () => {
    const local = storage();
    local.setItem('interview_audio_devices', JSON.stringify({system_device_id: 'blackhole'}));
    expect(withLocalAudioDevices(settings, 'windows', local)).toMatchObject({
      microphone_id: '',
      system_device_id: '',
    });
    saveLocalAudioDevices({...settings, system_device_id: '{windows-endpoint}'}, 'windows', local);
    expect(withLocalAudioDevices(settings, 'windows', local).system_device_id).toBe(
      '{windows-endpoint}',
    );
    expect(withLocalAudioDevices(settings, 'mac', local).system_device_id).toBe('blackhole');
  });
  it('retains a legacy local Windows microphone while resetting the previously unused output field', () => {
    const local = storage();
    local.setItem(
      'interview_audio_devices',
      JSON.stringify({microphone_id: 'local-mic', system_device_id: 'unused'}),
    );
    expect(withLocalAudioDevices(settings, 'windows', local)).toMatchObject({
      microphone_id: 'local-mic',
      system_device_id: '',
    });
  });
  it('does not transmit OS endpoints to the account settings API', () => {
    const changes = {...settings};
    expect(accountSettings(changes)).not.toHaveProperty('system_device_id');
    expect(accountSettings(changes)).not.toHaveProperty('microphone_id');
    expect(accountSettings(changes)).toMatchObject({theme: 'dark', language: 'auto'});
    expect(changes).toEqual(settings);
  });
  it('handles damaged and wrong-type local preferences without adopting invalid endpoints', () => {
    const local = storage();
    local.setItem('interview_audio_devices:windows', '{broken');
    local.setItem('interview_audio_devices', JSON.stringify({microphone_id: false}));
    expect(withLocalAudioDevices(settings, 'windows', local).microphone_id).toBe('');
  });
  it('rejects missing selected output instead of silently recording another device', () => {
    const devices = [{id: 'speaker', name: 'Speaker', isDefault: true}];
    expect(() => assertSystemOutput(devices, 'unplugged-headset')).toThrow('已断开');
    expect(() => assertSystemOutput([], '')).toThrow('默认输出');
    expect(() => assertSystemOutput(devices, '')).not.toThrow();
    expect(() => assertSystemOutput([{...devices[0]!, isDefault: false}], 'speaker')).not.toThrow();
  });
  it('distinguishes supported OSes without treating Linux as Windows', () => {
    expect(desktopPlatform('Windows NT 10.0')).toBe('windows');
    expect(desktopPlatform('Macintosh; Intel Mac OS X')).toBe('mac');
    expect(desktopPlatform('X11; Linux x86_64')).toBe('other');
  });
});
