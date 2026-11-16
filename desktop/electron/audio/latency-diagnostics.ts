import fs from 'node:fs';
import path from 'node:path';

export type FrameTiming = {renderer_at_ms?: number; worklet_queue_ms?: number; input_latency_ms?: number};

/** Explicit local opt-in. Timing/counts only: no PCM, words, device names,
 * credentials or signed URLs. Bounded to 8 MiB per application launch. */
export class AudioLatencyDiagnostics {
  private directory = '';
  private writer: fs.WriteStream | null = null;
  private size = 0;
  private serial = 0;
  private frames = new Map<string, Record<string, number>>();
  enabled = false;
  configure(directory: string) { this.directory = directory; }
  requested() { return !!this.directory && fs.existsSync(path.join(this.directory, 'audio-latency.enabled')); }
  begin(sessionId: string) {
    this.enabled = this.requested();
    this.frames.clear();
    if (!this.enabled) return;
    if (!this.writer) {
      this.writer = fs.createWriteStream(path.join(this.directory, 'audio-latency.jsonl'), {flags:'a', mode:0o600});
      this.writer.on('error', () => { this.enabled = false; });
    }
    this.record('start', {session_id:sessionId, platform:process.platform});
  }
  private record(kind: string, data: Record<string, unknown>) {
    if (!this.enabled || !this.writer || this.size >= 8 * 1024 * 1024) return;
    const line = JSON.stringify({kind, at_ms:Date.now(), ...data})+'\n';
    this.size += Buffer.byteLength(line);
    this.writer.write(line);
  }
  async flush(): Promise<void> {
    if (!this.writer || this.writer.destroyed) return;
    await new Promise<void>(resolve => this.writer!.write('', () => resolve()));
  }
  async close(): Promise<void> {
    const writer = this.writer;
    this.writer = null;
    if (!writer || writer.closed) return;
    await new Promise<void>(resolve => {writer.once('close', resolve); writer.end();});
  }
  input(source: string, frame: Buffer, offsetMs: number, timing?: FrameTiming) {
    if (!this.enabled) return;
    const now = Date.now();
    const previous = this.frames.get(source);
    let squares = 0;
    for (let i=0; i+1<frame.length; i+=2) squares += (frame.readInt16LE(i)/32768)**2;
    const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
    const value = {offset_ms:offsetMs, rms:Math.sqrt(squares / Math.max(1, frame.length/2)),
      worklet_queue_ms:Math.max(previous?.worklet_queue_ms ?? 0, numeric(timing?.worklet_queue_ms)),
      ipc_ms:Math.max(previous?.ipc_ms ?? 0, timing?.renderer_at_ms ? now-numeric(timing.renderer_at_ms) : 0),
      input_latency_ms:numeric(timing?.input_latency_ms), last_log_ms:previous?.last_log_ms ?? 0};
    this.frames.set(source, value);
    if (now-value.last_log_ms >= 250) {
      this.record('input', {source, ...value});
      value.last_log_ms = now; value.worklet_queue_ms = value.ipc_ms = 0;
    }
  }
  transcription(event: Record<string, any>) {
    if (!this.enabled) return event;
    const id = ++this.serial;
    const serverTiming: Record<string, number | boolean> = {};
    for (const key of ['provider_received_at_ms','last_ingest_at_ms','sent_audio_ms','queued_audio_ms','server_sent_at_ms']) {
      const value = event.diagnostic_timing?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) serverTiming[key] = value;
    }
    if (event.diagnostic_timing?.status_only) serverTiming.status_only = true;
    this.record('transcription', {id, source:event.source, revision:event.revision,
      characters:typeof event.text === 'string' ? event.text.length : 0, final:event.is_final,
      recognition_status:event.recognition_status, start_time:event.start_time, end_time:event.end_time,
      input_offset_ms:this.frames.get(event.source)?.offset_ms,
      server_timing:serverTiming});
    return {...event, diagnostic_id:id};
  }
  rendered(value: unknown) {
    if (!value || typeof value !== 'object') return;
    const data = value as Record<string, unknown>;
    if (!Number.isSafeInteger(data.id) || (data.id as number)<1 || (data.id as number)>this.serial) return;
    const safe: Record<string, unknown> = {id:data.id};
    for (const key of ['renderer_received_at_ms','committed_at_ms','frame_at_ms']) {
      const number = data[key];
      if (typeof number !== 'number' || !Number.isFinite(number) || Math.abs(number-Date.now())>60000) return;
      safe[key] = number;
    }
    safe.coalesced = data.coalesced === true;
    safe.in_view = data.in_view === true;
    this.record('rendered', safe);
  }
}
export const audioLatencyDiagnostics = new AudioLatencyDiagnostics();
