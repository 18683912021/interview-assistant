import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('capture worklet tail flush', () => {
  it('opt-in timing preserves PCM samples and normal mode still transfers bare buffers', () => {
    let Processor: any;
    const sent: any[] = [];
    class Base {port = {onmessage:undefined as any, postMessage:(data: any) => sent.push(data)};}
    runInNewContext(readFileSync('public/mic-processor.js', 'utf8'), {
      AudioWorkletProcessor:Base, registerProcessor:(_name: string, type: any) => {Processor=type;},
      Float32Array, currentTime:12, sampleRate:16000,
    });
    const processor = new Processor(), samples = new Float32Array(640).fill(.2);
    processor.process([[samples]]);
    expect(sent[0]).toBeInstanceOf(ArrayBuffer);
    processor.port.onmessage({data:{type:'diagnostics',enabled:true}});
    processor.process([[samples]]);
    expect(sent[1]).toMatchObject({type:'audio-frame',audio_time_end:12.04});
    expect(new Float32Array(sent[1].samples)).toEqual(samples);
  });
  it('delivers partial samples before the matching ack and stops producing audio', () => {
    let Processor: any;
    const sent: any[] = [];
    class Base {
      port = { onmessage: undefined as any, postMessage: (data: any) => sent.push(data) };
    }
    runInNewContext(readFileSync('public/mic-processor.js', 'utf8'), {
      AudioWorkletProcessor: Base,
      registerProcessor: (_name: string, type: any) => { Processor = type; },
      Float32Array,
    });
    const processor = new Processor();
    const samples = new Float32Array(384).fill(0.25);
    processor.process([[samples]]);
    expect(sent).toHaveLength(0);
    processor.port.onmessage({ data: { type: 'flush', id: 'stop-1' } });
    expect(new Float32Array(sent[0])).toEqual(samples);
    expect(sent[1]).toEqual({ type: 'flushed', id: 'stop-1' });
    expect(processor.process([[samples]])).toBe(false);
    expect(sent).toHaveLength(2);
  });
});
