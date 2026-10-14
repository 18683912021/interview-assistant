import {Worker} from 'node:worker_threads';
import path from 'node:path';

export class LocalOCR {
  private worker: Worker | null = null;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private pending: ((error: Error) => void) | null = null;
  warm(): void {
    clearTimeout(this.idle);
    if (!this.worker) {
      const entry = path.join(__dirname, 'ocr-worker.js').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
      const worker = new Worker(entry, {stderr: true});
      this.worker = worker;
      let errors = '';
      worker.stderr.on('data', bytes => {
        errors = (errors + String(bytes)).slice(-2048);
        if (/Error opening data file|Failed loading language|Aborted\(/.test(errors)) this.fail(worker);
      });
      worker.on('error', () => this.fail(worker));
      worker.on('exit', () => this.fail(worker));
      worker.on('message', value => {if (value.type === 'error') this.fail(worker);});
    }
    this.idle = setTimeout(() => this.dispose(), 120_000);
    this.idle.unref();
  }
  private fail(worker: Worker): void {
    if (this.worker !== worker) return;
    this.pending?.(new Error('本机识别失败，请重新框选；也可以直接输入问题。'));
    this.dispose();
  }
  dispose(): void {
    clearTimeout(this.idle);
    const worker = this.worker;
    this.worker = null;
    this.pending?.(new Error('识别已取消'));
    this.pending = null;
    void worker?.terminate();
  }
  async recognize(image: Buffer, signal: AbortSignal, progress: (value: number) => void): Promise<{text: string; confidence: number}> {
    if (signal.aborted) throw new Error('识别已取消');
    this.warm();
    clearTimeout(this.idle);
    const worker = this.worker!;
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, result?: {text: string; confidence: number}) => {
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        worker.removeListener('message', receive); this.pending = null;
        if (error) reject(error); else resolve(result!);
        if (this.worker === worker) {
          this.idle = setTimeout(() => this.dispose(), 120_000); this.idle.unref();
        }
      };
      const abort = () => {finish(new Error('识别已取消')); this.dispose();};
      const receive = (value: {type: string; text: string; confidence: number; progress: number}) => {
        if (value.type === 'result') finish(undefined, {text: value.text, confidence: value.confidence});
        else if (value.type === 'progress') progress(Math.round(value.progress * 100));
      };
      const timer = setTimeout(() => {finish(new Error('识别超时，请缩小到题目区域后重试。')); this.dispose();}, 30_000);
      this.pending = error => finish(error);
      signal.addEventListener('abort', abort, {once: true});
      worker.on('message', receive);
      worker.postMessage(image);
    });
  }
}
