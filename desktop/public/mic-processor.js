/**
 * mic-processor.js —— 麦克风 PCM 采集 AudioWorklet（独立文件，不可被 bundle）
 *
 * 大厂主流做法（替代已废弃的 ScriptProcessorNode）：
 *  - 运行在专用音频渲染线程，不阻塞 UI 主线程；
 *  - process() 内禁止对象分配/GC/异步，固定缓冲累积；
 *  - 累积满 40ms（640 样本 @16kHz，与移动端帧节奏对齐）后以
 *    ArrayBuffer 所有权转移（transfer）postMessage 到主线程，零拷贝。
 *
 * 加载：dev 下由 Vite public/ 伺服为 /mic-processor.js；
 * 打包后随 dist-renderer 原样复制，file:// 下相对路径 addModule。
 */
const FRAME = 640; // 40ms @ 16kHz

class MicCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(FRAME); // 当前累积缓冲
    this.count = 0;                        // 已累积样本数
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;

    let i = 0;
    while (i < input.length) {
      const room = FRAME - this.count;
      const n = Math.min(room, input.length - i);
      this.buffer.set(input.subarray(i, i + n), this.count);
      this.count += n;
      i += n;

      if (this.count === FRAME) {
        const buf = this.buffer.buffer;
        this.buffer = new Float32Array(FRAME); // 先换新缓冲再转移，视图不指向已转移内存
        this.port.postMessage(buf, [buf]);    // 所有权转移，主线程零拷贝接收
        this.count = 0;
      }
    }
    return true; // 保持处理器存活
  }
}

registerProcessor('mic-capture-processor', MicCaptureProcessor);
