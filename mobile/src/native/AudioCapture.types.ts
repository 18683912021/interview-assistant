export type CaptureSource = 'mic' | 'system' | 'both';
export type TrackSource = 'mic' | 'system';
export type CaptureState =
  | 'idle'
  | 'preparing'
  | 'capturing'
  | 'stopping'
  | 'finalizing'
  | 'completed'
  | 'error';
export type StreamState =
  | 'idle'
  | 'connecting'
  | 'ready'
  | 'degraded'
  | 'backfilling'
  | 'closed'
  | 'error';

export interface AudioFormatSpec {
  sampleRate: number;
  channelCount: number;
  bitsPerSample: number;
}

export interface AudioCapabilities {
  apiLevel: number;
  microphone: boolean;
  systemAudio: boolean;
  outputSampleRate: number;
  outputChannels: number;
  outputBitDepth: number;
  chunkDurationMs: number;
}

export interface AudioLevels {
  mic: number;
  system: number;
}

export interface StreamStats {
  queuedBytes: number;
  transportBytes: number;
  acknowledgedBytes: number;
  realtimeFrames: number;
  droppedFrames: number;
  backfillBytes: number;
}

export interface TrackOutput {
  source: TrackSource;
  inputFormat: AudioFormatSpec;
  outputFormat: AudioFormatSpec;
  pcmPath: string;
  wavPath: string;
  pcmBytes: number;
  durationMs: number;
  pcmSha256: string;
  wavSha256: string;
}

export interface CaptureResult {
  operationId: string;
  sessionId: string;
  source: CaptureSource;
  startedAtUtc: string;
  endedAtUtc: string;
  stopReason: string;
  tracks: TrackOutput[];
}

export interface CaptureStartInfo {
  operationId: string;
  sessionId: string;
  source: CaptureSource;
  startedAtUtc: string;
  inputFormats: Partial<Record<TrackSource, AudioFormatSpec>>;
  outputFormat: AudioFormatSpec;
}

export interface CaptureSnapshot {
  captureState: CaptureState;
  streamState: StreamState;
  operationId?: string;
  sessionId?: string;
  source?: CaptureSource;
  startedAtUtc?: string;
  levels: AudioLevels;
  lastResult?: CaptureResult;
  streamStats: StreamStats;
  pendingBackfill: boolean;
}

export interface NativeCaptureError {
  code: string;
  stage: string;
  source?: TrackSource;
  recoverable: boolean;
  message: string;
}

export interface NativeCaptureStateEvent extends CaptureSnapshot {
  state: CaptureState;
}

export interface NativeStreamStateEvent {
  state: StreamState;
  message?: string;
}

export interface TranscriptionEvent {
  text: string;
  isFinal: boolean;
  source: 'mic' | 'system';
}

export interface LLMStartEvent {
  question_text: string;
  language: string;
  timestamp: number;
}

export interface LLMChunkEvent {
  chunk_index: number;
  delta: string;
  timestamp: number;
}

export interface LLMDoneEvent {
  full_answer: string;
  timestamp: number;
  error?: string;
}

export interface AudioCaptureNativeModule {
  getCapabilities(): Promise<AudioCapabilities>;
  requestProjectionConsent(): Promise<boolean>;
  startCapture(options: {
    operationId: string;
    source: CaptureSource;
  }): Promise<CaptureStartInfo>;
  stopCapture(): Promise<CaptureResult>;
  getSnapshot(): Promise<CaptureSnapshot>;
  connectStream(url: string): Promise<void>;
  disconnectStream(): Promise<void>;
  retryBackfill(): Promise<void>;
  sendControl(message: string): void;
  shareOutput(sessionId: string, source: TrackSource, kind: 'pcm' | 'wav'): Promise<void>;
  storePreference(key: string, value: string): Promise<void>;
  getPreference(key: string): Promise<string | null>;
  removePreference(key: string): Promise<void>;
  saveFile(fileName: string, base64Data: string): Promise<string>;
  readFileBase64(fileUri: string): Promise<string>;
}
