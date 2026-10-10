/// <reference types="vite/client" />

interface ElectronAPI {
  audio: {
    startCapture(opts: { source?: 'mic' | 'system' | 'both'; streamUrl?: string; token?: string; sessionId?: string; systemDeviceId?: string; directAddress?: string }): Promise<unknown>;
    stopCapture(): Promise<void>;
    getSnapshot(): Promise<unknown>;
    takeDisplayCaptureFailure(): Promise<{code: string; message: string} | null>;
    openPrivacySettings(kind: 'microphone' | 'screen'): Promise<void>;
    requestPermission(kind: 'microphone' | 'screen'): ReturnType<ElectronAPI['audio']['getPermissions']>;
    listSystemOutputs(): Promise<{id: string; name: string; isDefault: boolean}[]>;
    getPermissions(): Promise<{
      platform: string; osRelease: string; electronVersion: string;
      microphone: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown' | 'unsupported';
      screen: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown' | 'unsupported';
      systemAudioMode: string;
    }>;
    clearAnswer(): Promise<void>;
    sendControl(msg: unknown): Promise<unknown>;
    sendMicFrame(frame: Uint8Array): void;
    sendSystemFrame(frame: Uint8Array): void;
    onState(cb: (data: unknown) => void): () => void;
    onTranscription(cb: (data: unknown) => void): () => void;
    onLLMStart(cb: (data: unknown) => void): () => void;
    onLLMChunk(cb: (data: unknown) => void): () => void;
    onLLMDone(cb: (data: unknown) => void): () => void;
    onStreamState(cb: (data: unknown) => void): () => void;
    onLevels(cb: (data: unknown) => void): () => void;
    onError(cb: (data: unknown) => void): () => void;
  };
  files: {
    pickFile(extensions?: string[]): Promise<string | null>;
    saveFile(data: Uint8Array, defaultName: string): Promise<string | null>;
  };
  window: {
    openOverlay(): Promise<void>;
    closeOverlay(): Promise<void>;
    toggleOverlay(): Promise<void>;
    setAlwaysOnTop(on: boolean): Promise<void>;
    toggleContentProtection(): Promise<boolean>;
    getContentProtection(): Promise<boolean>;
    openExternal(url: string): Promise<{ ok: boolean; error?: string }>;
  };
  storage: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    remove(key: string): Promise<void>;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
