/** Windows-only boundary. Importing this module never loads a native library on macOS. */
export interface SystemOutputDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface WasapiCapture {
  sampleRate: number;
  channels: number;
  isFloat: boolean;
  bitsPerSample: number;
  start(callback: (error: (Error & {code?: string}) | null, buffer: Buffer | null) => void): void;
  stop(): void;
}

export interface WindowsLoopbackAddon {
  enumerateDevices(): SystemOutputDevice[];
  WasapiLoopback: new (deviceId?: string) => WasapiCapture;
}

type AddonLoader = () => WindowsLoopbackAddon;
const nativeLoader: AddonLoader = () => {
  // Runtime-only require: bundling or importing the desktop on Mac must remain safe.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./native/build/Release/wasapi_loopback.node') as WindowsLoopbackAddon;
};

function loadAddon(platform: string, loader: AddonLoader): WindowsLoopbackAddon {
  if (platform !== 'win32') throw new Error('WASAPI 系统音频采集仅适用于 Windows');
  try {
    const addon = loader();
    if (
      typeof addon.WasapiLoopback !== 'function' ||
      typeof addon.enumerateDevices !== 'function'
    ) {
      throw new Error('安装包内的系统音频组件版本不匹配');
    }
    return addon;
  } catch (error) {
    throw new Error(
      'Windows 系统音频组件无法加载，请安装匹配当前 Windows 架构的完整安装包，或暂时选择仅麦克风。',
      {cause: error},
    );
  }
}

export function listSystemOutputs(
  platform = process.platform,
  loader: AddonLoader = nativeLoader,
): SystemOutputDevice[] {
  if (platform !== 'win32') return [];
  const addon = loadAddon(platform, loader);
  try {
    const devices = addon.enumerateDevices();
    if (
      !Array.isArray(devices) ||
      devices.some(
        device =>
          !device ||
          typeof device.id !== 'string' ||
          !device.id ||
          typeof device.name !== 'string' ||
          typeof device.isDefault !== 'boolean',
      )
    ) {
      throw new Error('系统音频组件返回的设备信息无效');
    }
    return devices;
  } catch (error) {
    const reason = error instanceof Error ? error.message : '未知设备错误';
    throw new Error(`无法读取 Windows 声音输出设备：${reason}`, {cause: error});
  }
}

export function createWindowsLoopback(
  deviceId?: string,
  platform = process.platform,
  loader: AddonLoader = nativeLoader,
): WasapiCapture {
  if (deviceId !== undefined && typeof deviceId !== 'string')
    throw new Error('无效的系统音频输出设备');
  const addon = loadAddon(platform, loader);
  // The native constructor resolves the default endpoint again at capture start,
  // so a device switch between the settings screen and this call is not cached.
  return deviceId ? new addon.WasapiLoopback(deviceId) : new addon.WasapiLoopback();
}
