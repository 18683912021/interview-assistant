import type {Settings} from '../api/workspace';
import {SCREEN_AUDIO_FALLBACK} from './capture-preparation';

export type DesktopPlatform = 'mac' | 'windows' | 'other';
type DeviceSettings = Pick<Settings, 'microphone_id' | 'system_device_id'>;
type DeviceStorage = Pick<Storage, 'getItem' | 'setItem'>;
const legacyKey = 'interview_audio_devices';
const keyFor = (platform: DesktopPlatform) => `${legacyKey}:${platform}`;

export function desktopPlatform(userAgent = navigator.userAgent): DesktopPlatform {
  return /Windows/i.test(userAgent) ? 'windows' : /Mac/i.test(userAgent) ? 'mac' : 'other';
}

function read(storage: DeviceStorage, key: string): Partial<DeviceSettings> {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) || 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const fields = value as Record<string, unknown>;
    return {
      ...(typeof fields.microphone_id === 'string' ? {microphone_id: fields.microphone_id} : {}),
      ...(typeof fields.system_device_id === 'string'
        ? {system_device_id: fields.system_device_id}
        : {}),
    };
  } catch {
    return {};
  }
}

export function withLocalAudioDevices(
  settings: Settings,
  platform = desktopPlatform(),
  storage: DeviceStorage = localStorage,
): Settings {
  const local = read(storage, keyFor(platform)),
    legacy = read(storage, legacyKey);
  const systemDevice = local.system_device_id ??
    (platform === 'mac' ? (legacy.system_device_id ?? settings.system_device_id) : '');
  return {
    ...settings,
    // Keep the existing Mac preference migration. Windows must not reuse a
    // device id synced from another machine or a macOS virtual input id.
    microphone_id:
      local.microphone_id ??
      legacy.microphone_id ??
      (platform === 'mac' ? settings.microphone_id : ''),
    // Migrate the old empty Core Audio default to the requested screen-audio route.
    // Explicit virtual inputs and Windows endpoints remain unchanged.
    system_device_id: platform === 'mac' && !systemDevice ? SCREEN_AUDIO_FALLBACK : systemDevice,
  };
}

export function saveLocalAudioDevices(
  settings: DeviceSettings,
  platform = desktopPlatform(),
  storage: DeviceStorage = localStorage,
) {
  storage.setItem(
    keyFor(platform),
    JSON.stringify({
      microphone_id: settings.microphone_id,
      system_device_id: settings.system_device_id,
    }),
  );
}

/** OS endpoint ids are local device configuration, never an account preference. */
export function accountSettings(changes: Partial<Settings>): Partial<Settings> {
  const copy = {...changes};
  delete copy.microphone_id;
  delete copy.system_device_id;
  return copy;
}

export interface SystemOutputDevice {
  id: string;
  name: string;
  isDefault: boolean;
}
export async function listSystemOutputs(): Promise<SystemOutputDevice[]> {
  const audio = window.electronAPI?.audio;
  if (!audio?.listSystemOutputs) throw new Error('请重启桌面客户端以加载音频设备功能。');
  return audio.listSystemOutputs();
}

export function assertSystemOutput(devices: SystemOutputDevice[], selectedId: string) {
  const selected = selectedId
    ? devices.find(device => device.id === selectedId)
    : devices.find(device => device.isDefault);
  if (!selected)
    throw new Error(
      selectedId
        ? '所选系统音频输出已断开，请在音频设置中重新选择扬声器或耳机。'
        : '没有可用的系统默认输出，请连接扬声器或耳机后重试。',
    );
}
