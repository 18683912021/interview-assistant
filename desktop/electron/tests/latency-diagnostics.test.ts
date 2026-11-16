import {mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {expect, it} from 'vitest';
import {AudioLatencyDiagnostics} from '../audio/latency-diagnostics';

it('requires explicit opt-in and only saves numeric timing, never transcript/provider payloads', async () => {
  const directory = mkdtempSync(path.join(tmpdir(),'audio-diagnostics-test-'));
  try {
    const diagnostics = new AudioLatencyDiagnostics(); diagnostics.configure(directory);
    const event = {source:'mic',text:'private words must not be written',diagnostic_timing:{queued_audio_ms:40,raw_text:'private provider text'}};
    diagnostics.begin('session'); expect(diagnostics.transcription(event)).toBe(event);
    expect(existsSync(path.join(directory,'audio-latency.jsonl'))).toBe(false);
    writeFileSync(path.join(directory,'audio-latency.enabled'),''); diagnostics.begin('session');
    diagnostics.input('mic',Buffer.alloc(1280),40,{renderer_at_ms:Date.now(),worklet_queue_ms:8});
    const tagged = diagnostics.transcription(event);
    const now = Date.now();
    diagnostics.rendered({id:tagged.diagnostic_id,renderer_received_at_ms:now,committed_at_ms:now,frame_at_ms:now+16,raw_text:event.text});
    await diagnostics.flush();
    const raw = readFileSync(path.join(directory,'audio-latency.jsonl'),'utf8');
    expect(raw).not.toContain('private'); expect(raw).not.toContain('raw_text');
    const records = raw.trim().split('\n').map(line => JSON.parse(line));
    expect(records.map(record => record.kind)).toEqual(['start','input','transcription','rendered']);
    expect(records[2].server_timing).toEqual({queued_audio_ms:40});
    await diagnostics.close();
  } finally {rmSync(directory,{recursive:true,force:true});}
});
