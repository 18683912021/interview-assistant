import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('capture worklet tail flush', () => {
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
