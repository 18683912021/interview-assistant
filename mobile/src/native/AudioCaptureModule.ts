import {
  NativeEventEmitter,
  NativeModules,
  type EmitterSubscription,
} from 'react-native';

import type {
  AudioCaptureNativeModule,
  AudioCapabilities,
  AudioLevels,
  CaptureResult,
  CaptureSnapshot,
  CaptureSource,
  CaptureStartInfo,
  LLMStartEvent,
  LLMChunkEvent,
  LLMDoneEvent,
  NativeCaptureError,
  NativeCaptureStateEvent,
  NativeStreamStateEvent,
  StreamStats,
  TrackSource,
  TranscriptionEvent,
} from './AudioCapture.types';

const nativeModule = NativeModules.AudioCapture as
  | AudioCaptureNativeModule
  | undefined;
const emitter = nativeModule
  ? new NativeEventEmitter(NativeModules.AudioCapture)
  : null;

function requireNative(): AudioCaptureNativeModule {
  if (!nativeModule) {
    throw new Error(
      'AudioCapture native module is unavailable. Rebuild the Android app after installing the native code.',
    );
  }
  return nativeModule;
}

function subscribe<T>(
  eventName: string,
  listener: (event: T) => void,
): EmitterSubscription | {remove(): void} {
  return emitter?.addListener(eventName, listener) ?? {remove: () => undefined};
}

export const AudioCapture = {
  isAvailable: nativeModule != null,

  getCapabilities(): Promise<AudioCapabilities> {
    return requireNative().getCapabilities();
  },

  requestProjectionConsent(): Promise<boolean> {
    return requireNative().requestProjectionConsent();
  },

  startCapture(
    operationId: string,
    source: CaptureSource,
  ): Promise<CaptureStartInfo> {
    return requireNative().startCapture({operationId, source});
  },

  stopCapture(): Promise<CaptureResult> {
    return requireNative().stopCapture();
  },

  getSnapshot(): Promise<CaptureSnapshot> {
    return requireNative().getSnapshot();
  },

  connectStream(url: string): Promise<void> {
    return requireNative().connectStream(url);
  },

  disconnectStream(): Promise<void> {
    return requireNative().disconnectStream();
  },

  retryBackfill(): Promise<void> {
    return requireNative().retryBackfill();
  },

  shareOutput(
    sessionId: string,
    source: TrackSource,
    kind: 'pcm' | 'wav',
  ): Promise<void> {
    return requireNative().shareOutput(sessionId, source, kind);
  },

  onCaptureState(listener: (event: NativeCaptureStateEvent) => void) {
    return subscribe('AudioCaptureState', listener);
  },

  onLevels(listener: (event: AudioLevels) => void) {
    return subscribe('AudioCaptureLevels', listener);
  },

  onStreamState(listener: (event: NativeStreamStateEvent) => void) {
    return subscribe('AudioStreamState', listener);
  },

  onStreamStats(listener: (event: StreamStats) => void) {
    return subscribe('AudioStreamStats', listener);
  },

  onError(listener: (event: NativeCaptureError) => void) {
    return subscribe('AudioCaptureError', listener);
  },

  onTranscription(listener: (event: TranscriptionEvent) => void) {
    return subscribe('AudioTranscription', listener);
  },

  onLLMStart(listener: (event: LLMStartEvent) => void) {
    return subscribe('AudioLLMStart', listener);
  },

  onLLMChunk(listener: (event: LLMChunkEvent) => void) {
    return subscribe('AudioLLMChunk', listener);
  },

  onLLMDone(listener: (event: LLMDoneEvent) => void) {
    return subscribe('AudioLLMDone', listener);
  },

  sendControl(message: object): void {
    requireNative().sendControl(JSON.stringify(message));
  },

  /** 选择 PDF 文件 */
  async pickPDF(): Promise<{uri: string; name: string; type: string; size: number} | null> {
    return NativeModules.FilePicker?.pickPDF() ?? null;
  },
  /** 选择文档文件（PDF/DOC/DOCX/WPS/ODT/RTF） */
  async pickDocument(mimeTypes: string[]): Promise<{uri: string; name: string; type: string; size: number} | null> {
    return NativeModules.FilePicker?.pickDocument(mimeTypes) ?? null;
  },
  /** 读取文件为 base64 字符串 */
  async readFileBase64(fileUri: string): Promise<string> {
    return requireNative().readFileBase64(fileUri);
  },

  async saveFile(fileName: string, base64Data: string): Promise<string> {
    return requireNative().saveFile(fileName, base64Data);
  },
  storePreference(key: string, value: string): Promise<void> {
    return requireNative().storePreference(key, value);
  },
  getPreference(key: string): Promise<string | null> {
    return requireNative().getPreference(key);
  },
  removePreference(key: string): Promise<void> {
    return requireNative().removePreference(key);
  },
};
