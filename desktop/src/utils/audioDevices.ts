/**
 * 音频输入设备枚举。macOS 默认通过 Electron 的 ScreenCaptureKit 回环采集；
 * 已配置 BlackHole 等虚拟声卡的用户也可以手动选择对应输入。
 * enumerateDevices 在未获麦克风权限时 label 为空——此时 deviceId 仍可用，只是不可读。
 */

export interface AudioInputDevice {
  deviceId: string;
  label: string;
  /** 名称疑似虚拟声卡（BlackHole / Soundflower / VB-Cable / Loopback…） */
  isVirtual: boolean;
}

/** 虚拟声卡名称特征（Windows 的 VB-Cable、macOS 的 BlackHole/Soundflower 均为常见命名） */
const VIRTUAL_NAME_RE = /blackhole|soundflower|vb[- ]?cable|loopback|virtual audio|虚拟/i;

export function isVirtualDeviceName(label: string): boolean {
  return VIRTUAL_NAME_RE.test(label);
}

/** 物理输入优先；虚拟输入保留标记，避免把系统回环误选为麦克风。 */
export async function enumerateAudioInputs(): Promise<AudioInputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(d => d.kind === 'audioinput');
    return inputs
      .map(d => ({ deviceId: d.deviceId, label: d.label || '(未命名设备)', isVirtual: isVirtualDeviceName(d.label) }))
      .sort((a, b) => Number(a.isVirtual) - Number(b.isVirtual) || a.label.localeCompare(b.label));
  } catch {
    return [];
  }
}

export const SYSTEM_DEVICE_STORAGE_KEY = 'system-audio-device-id';

/** 已保存的用户选择（填写后即回调旁路，仅存 deviceId） */
export async function loadSavedSystemDevice(): Promise<string | null> {
  try { return await (window as any).electronAPI?.storage?.get(SYSTEM_DEVICE_STORAGE_KEY) ?? null; } catch { return null; }
}

export async function saveSystemDevice(deviceId: string): Promise<void> {
  try { await (window as any).electronAPI?.storage?.set(SYSTEM_DEVICE_STORAGE_KEY, deviceId); } catch { /* ignore */ }
}
