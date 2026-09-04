/**
 * PcmFrameAccumulator —— 累积 PCM 数据到固定大小帧
 *
 * 目标帧大小：1280 bytes = 40ms @ 16kHz mono PCM16
 *   16000 samples/s × 2 bytes/sample × 0.04s = 1280 bytes
 */
const FRAME_SIZE = 1280; // bytes

export class PcmFrameAccumulator {
  private buffer: Buffer = Buffer.alloc(0);
  private frameCallback: ((frame: Buffer) => void) | null = null;

  /**
   * 设置帧回调（每积累满一帧触发）
   */
  onFrame(callback: (frame: Buffer) => void): void {
    this.frameCallback = callback;
  }

  /**
   * 输入 PCM 数据，自动拆分为固定大小帧
   */
  push(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);

    while (this.buffer.length >= FRAME_SIZE) {
      const frame = this.buffer.subarray(0, FRAME_SIZE);
      this.buffer = this.buffer.subarray(FRAME_SIZE);
      this.frameCallback?.(Buffer.from(frame)); // 复制一份避免引用
    }
  }

  /**
   * 获取剩余未满一帧的数据并清空（采集结束时调用）
   */
  flush(): Buffer {
    const remaining = this.buffer;
    this.buffer = Buffer.alloc(0);
    return remaining;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}
