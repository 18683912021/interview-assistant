/**
 * PcmNormalizer —— 音频重采样和归一化
 *
 * 必须和 Android 端字节级等价：
 *   - 线性插值重采样，sourceStep = inputRate / 16000
 *   - 立体声→单声道：(L + R) / 2
 *   - 输出：16kHz，mono，PCM16 LE
 */

export interface PcmFormat {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}

const TARGET_RATE = 16000;

/**
 * 线性插值重采样到 16kHz mono
 *
 * @param input PCM16 原始帧（Node.js Buffer）
 * @param inputRate 输入采样率
 * @param inputChannels 输入声道数
 * @returns 16kHz mono PCM16 Buffer
 */
export function normalizePcm(
  input: Buffer,
  inputRate: number,
  inputChannels: number,
): Buffer {
  if (inputChannels === 0 || input.length === 0) {
    return Buffer.alloc(0);
  }

  const sampleCount = Math.floor(input.length / (2 * inputChannels));
  const sourceStep = inputRate / TARGET_RATE;
  const outputSamples = Math.floor(sampleCount / sourceStep);
  const output = Buffer.alloc(outputSamples * 2); // 16-bit mono

  for (let outIdx = 0; outIdx < outputSamples; outIdx++) {
    const srcIdxFloat = outIdx * sourceStep;
    const srcIdx = Math.floor(srcIdxFloat);
    const frac = srcIdxFloat - srcIdx;

    let sample: number;

    if (inputChannels === 1) {
      // Mono: 线性插值
      const idx0 = Math.min(srcIdx * 2, input.length - 2);
      const idx1 = Math.min((srcIdx + 1) * 2, input.length - 2);
      const s0 = input.readInt16LE(idx0);
      const s1 = input.readInt16LE(idx1);
      sample = s0 + (s1 - s0) * frac;
    } else {
      // Stereo → mono: (L + R) / 2，再线性插值
      const byteIdx0 = Math.min(srcIdx * 2 * inputChannels, input.length - 2 * inputChannels);
      const byteIdx1 = Math.min((srcIdx + 1) * 2 * inputChannels, input.length - 2 * inputChannels);

      const l0 = input.readInt16LE(byteIdx0);
      const r0 = input.readInt16LE(byteIdx0 + 2);
      const l1 = input.readInt16LE(byteIdx1);
      const r1 = input.readInt16LE(byteIdx1 + 2);

      const m0 = Math.round((l0 + r0) / 2);
      const m1 = Math.round((l1 + r1) / 2);
      sample = Math.round(m0 + (m1 - m0) * frac);
    }

    // Clamp to int16
    const clamped = Math.max(-32768, Math.min(32767, Math.round(sample)));
    output.writeInt16LE(clamped, outIdx * 2);
  }

  return output;
}

/**
 * 快速重采样（无插值，用于性能敏感场景）
 */
export function normalizePcmFast(
  input: Buffer,
  inputRate: number,
  inputChannels: number,
): Buffer {
  if (inputChannels <= 1) {
    // 简单降采样：每 N 个样本取 1 个
    const sourceStep = inputRate / TARGET_RATE;
    const inputSamples = Math.floor(input.length / 2);
    const outputSamples = Math.floor(inputSamples / sourceStep);
    const output = Buffer.alloc(outputSamples * 2);

    for (let i = 0; i < outputSamples; i++) {
      const srcIdx = Math.floor(i * sourceStep) * 2;
      if (srcIdx + 1 < input.length) {
        const sample = input.readInt16LE(srcIdx);
        output.writeInt16LE(sample, i * 2);
      }
    }
    return output;
  }

  // Stereo fast: nearest-neighbor
  const sourceStep = inputRate / TARGET_RATE;
  const frameSize = 2 * inputChannels;
  const inputFrames = Math.floor(input.length / frameSize);
  const outputFrames = Math.floor(inputFrames / sourceStep);
  const output = Buffer.alloc(outputFrames * 2);

  for (let i = 0; i < outputFrames; i++) {
    const srcFrame = Math.floor(i * sourceStep);
    const byteIdx = srcFrame * frameSize;
    if (byteIdx + 3 < input.length) {
      const l = input.readInt16LE(byteIdx);
      const r = input.readInt16LE(byteIdx + 2);
      const mono = Math.round((l + r) / 2);
      const clamped = Math.max(-32768, Math.min(32767, mono));
      output.writeInt16LE(clamped, i * 2);
    }
  }
  return output;
}

/**
 * Float32 [-1, 1] → Int16LE
 */
export function floatToPcm16(samples: Float32Array): Buffer {
  const output = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    const int16 = Math.round(clamped * 32767);
    output.writeInt16LE(int16, i * 2);
  }
  return output;
}
