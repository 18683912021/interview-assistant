import {API_BASE} from '../config';
import {getToken} from '../utils/token';
import {ApiError} from './client';
export interface StreamEvent {
  type: 'delta' | 'done' | 'error';
  text: string;
  status?: string;
  created_at?: string;
}

/** NDJSON boundaries are independent of transport chunks. Require an explicit terminal event. */
export class LineStream {
  private pending = '';
  done = false;
  constructor(private onEvent: (event: StreamEvent) => void) {}
  push(chunk: string, end = false) {
    this.pending += chunk;
    const lines = this.pending.split('\n');
    this.pending = lines.pop() || '';
    if (end && this.pending.trim()) {
      lines.push(this.pending);
      this.pending = '';
    }
    for (const line of lines) {
      if (!line.trim() || this.done) {
        continue;
      }
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === 'error') {
        throw new Error(event.text || '生成失败，请重试');
      }
      if (event.type === 'done') {
        this.done = true;
      }
      this.onEvent(event);
    }
    if (end && !this.done) {
      throw new Error('连接中断，已保留收到的内容');
    }
  }
}

/** RN 0.78 fetch has no portable streaming body. XHR progress enables native incremental delivery. */
export async function streamJSON(
  path: string,
  body: object,
  onEvent: (e: StreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const token = await getToken();
  if (signal.aborted) {
    throw new Error('已停止生成');
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const parser = new LineStream(onEvent);
    let offset = 0,
      settled = false;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener('abort', abort);
      error ? reject(error) : resolve();
    };
    const abort = () => {
      finish(new Error('已停止生成'));
      xhr.abort();
    };
    const consume = (end = false) => {
      if (settled || xhr.status < 200 || xhr.status >= 300) {
        return;
      }
      try {
        const text = xhr.responseText;
        parser.push(text.slice(offset), end);
        offset = text.length;
      } catch (error) {
        finish(error as Error);
        xhr.abort();
      }
    };
    xhr.open('POST', `${API_BASE}${path}`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    xhr.timeout = 180000;
    xhr.onprogress = () => consume();
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let message = `请求失败（${xhr.status}）`;
        try {
          const d = JSON.parse(xhr.responseText).detail;
          if (typeof d === 'string') {
            message = d;
          }
        } catch {}
        finish(new ApiError(xhr.status, message));
      } else {
        consume(true);
        finish();
      }
    };
    xhr.onerror = () => finish(new Error('网络中断，已保留收到的内容'));
    xhr.ontimeout = () => finish(new Error('生成超时，已保留收到的内容'));
    signal.addEventListener('abort', abort);
    xhr.send(JSON.stringify(body));
  });
}
