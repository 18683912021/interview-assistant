import {describe, expect, it} from 'vitest';
import {StreamingPcmNormalizer} from '../audio/windows-pcm';

function signal(frames: number, channels: number) {
  const buffer = Buffer.alloc(frames * channels * 2);
  for (let index = 0; index < frames; index++)
    for (let channel = 0; channel < channels; channel++)
      buffer.writeInt16LE(
        Math.round(9000 * Math.sin(index / 23 + channel)),
        (index * channels + channel) * 2,
      );
  return buffer;
}
describe('Windows packet-independent PCM normalization', () => {
  it.each([8000, 16000, 44100, 48000, 96000])(
    'preserves sample timing across arbitrary packet boundaries at %s Hz',
    rate => {
      const input = signal(rate, 2);
      const one = new StreamingPcmNormalizer(rate, 2);
      const expected = Buffer.concat([one.push(input), one.flush()]);
      const packets = new StreamingPcmNormalizer(rate, 2),
        output: Buffer[] = [];
      let offset = 0,
        index = 0;
      const sizes = [1, 127, 13, 480, 73];
      while (offset < input.length) {
        const end = Math.min(input.length, offset + sizes[index++ % sizes.length]! * 4);
        output.push(packets.push(input.subarray(offset, end)));
        offset = end;
      }
      output.push(packets.flush());
      expect(Buffer.concat(output)).toEqual(expected);
      expect(expected.length).toBe(16000 * 2);
      expect(packets.flush().length).toBe(0);
    },
  );
  it('retains center-channel speech in multichannel output', () => {
    const input = Buffer.alloc(48 * 6 * 2);
    for (let index = 0; index < 48; index++) input.writeInt16LE(12000, (index * 6 + 2) * 2);
    const normalizer = new StreamingPcmNormalizer(48000, 6);
    const result = Buffer.concat([normalizer.push(input), normalizer.flush()]);
    expect(result.length).toBe(16 * 2);
    for (let index = 0; index < result.length; index += 2)
      expect(result.readInt16LE(index)).toBe(2000);
  });
  it('preserves silence instead of shifting subsequent speech earlier', () => {
    const normalizer = new StreamingPcmNormalizer(48000, 2);
    const result = Buffer.concat([normalizer.push(Buffer.alloc(48000 * 4)), normalizer.flush()]);
    expect(result).toEqual(Buffer.alloc(16000 * 2));
  });
  it('rejects corrupt format or partial frames instead of silently misreading channels', () => {
    expect(() => new StreamingPcmNormalizer(0, 2)).toThrow();
    expect(() => new StreamingPcmNormalizer(48000, 0)).toThrow();
    expect(() => new StreamingPcmNormalizer(48000, 2).push(Buffer.alloc(3))).toThrow('对齐');
  });
});
