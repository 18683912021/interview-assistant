import {NativeModules} from 'react-native';
interface PreferenceStore {
  storePreference(key: string, value: string): Promise<void>;
  getPreference(key: string): Promise<string | null>;
  removePreference(key: string): Promise<void>;
}
function store(): PreferenceStore {
  if (!NativeModules.AudioCapture) {
    throw new Error('请安装包含原生模块的 Android 安装包');
  }
  return NativeModules.AudioCapture;
}
export const AudioCapture = {
  copyText: (text: string): Promise<void> =>
    NativeModules.AudioCapture.copyText(text),
  storePreference: (key: string, value: string) =>
    store().storePreference(key, value),
  getPreference: (key: string) => store().getPreference(key),
  removePreference: (key: string) => store().removePreference(key),
  pickDocument: (
    mimeTypes: string[],
  ): Promise<{uri: string; name: string; type: string; size: number} | null> =>
    NativeModules.FilePicker.pickDocument(mimeTypes),
};
