/** Stateful PCM16 conversion for WASAPI packets, independent of packet sizes. */
export class StreamingPcmNormalizer {
  private pending: number[] = [];
  // Integer units of 1/16000 input frames avoid cumulative fractional rounding.
  private position = 0;
  constructor(
    private readonly inputRate: number,
    private readonly channels: number,
  ) {
    if (
      !Number.isInteger(inputRate) ||
      inputRate < 8000 ||
      inputRate > 384000 ||
      !Number.isInteger(channels) ||
      channels < 1 ||
      channels > 32
    )
      throw new Error('系统输出的采样率或声道数不受支持');
  }

  push(input: Buffer): Buffer {
    const frameBytes = this.channels * 2;
    if (input.length % frameBytes) throw new Error('系统音频数据未按声道帧对齐');
    for (let offset = 0; offset < input.length; offset += frameBytes) {
      let sum = 0;
      // Include center/surround channels: meeting speech can live in the center
      // of a 5.1/7.1 mix. Averaging also keeps the downmix in PCM16 range.
      for (let channel = 0; channel < this.channels; channel++)
        sum += input.readInt16LE(offset + channel * 2);
      this.pending.push(sum / this.channels);
    }
    return this.drain(false);
  }

  flush(): Buffer {
    const result = this.drain(true);
    this.pending = [];
    this.position = 0;
    return result;
  }

  private drain(final: boolean): Buffer {
    const output: number[] = [];
    while (this.position < this.pending.length * 16000) {
      const index = Math.floor(this.position / 16000);
      if (!final && index + 1 >= this.pending.length) break;
      const left = this.pending[index]!;
      const right = this.pending[Math.min(index + 1, this.pending.length - 1)]!;
      const fraction = (this.position % 16000) / 16000;
      output.push(Math.max(-32768, Math.min(32767, Math.round(left + (right - left) * fraction))));
      this.position += this.inputRate;
    }
    const consumed = Math.min(Math.floor(this.position / 16000), this.pending.length);
    this.pending = this.pending.slice(consumed);
    this.position -= consumed * 16000;
    const bytes = Buffer.alloc(output.length * 2);
    output.forEach((sample, index) => bytes.writeInt16LE(sample, index * 2));
    return bytes;
  }
}
