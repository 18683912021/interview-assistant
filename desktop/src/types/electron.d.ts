/// <reference types="vite/client" />

interface ElectronAPI {
  audio: {
    startCapture(opts: { source?: 'mic' | 'system' | 'both'; streamUrl?: string }): Promise<unknown>;
    stopCapture(): Promise<void>;
    getSnapshot(): Promise<unknown>;
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
  fileConvert: {
    getLibreOfficeStatus(): Promise<{ available: boolean }>;
    downloadLibreOffice(): Promise<{ success: boolean; path?: string; error?: string }>;
    onDownloadProgress(cb: (data: { progress: number; stage: string; error?: string }) => void): () => void;
    convert(inputPath: string, format: string): Promise<string>;
    pickFile(extensions?: string[]): Promise<string | null>;
    saveFile(data: Uint8Array, defaultName: string): Promise<string | null>;
  };
  window: {
    openOverlay(): Promise<void>;
    closeOverlay(): Promise<void>;
    toggleOverlay(): Promise<void>;
    setAlwaysOnTop(on: boolean): Promise<void>;
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
