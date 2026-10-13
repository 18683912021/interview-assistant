import {API_BASE} from '../config';
import {getToken} from '../utils/token';
import {ApiError, AUTH_EXPIRED_EVENT} from './client';

export type StreamEvent = {type: 'delta' | 'done' | 'error'; text: string; status?: string; created_at?: string};
/** UTF-8 and JSON records can span arbitrary network chunks. A missing terminal record is a failure. */
export async function streamJSON(path: string, body: Record<string, unknown>, receive: (event: StreamEvent) => void, signal: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, {once: true});
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 150_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const token = await getToken();
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST', signal: controller.signal,
      headers: {'Content-Type': 'application/json', Accept: 'application/x-ndjson', ...(token ? {Authorization: `Bearer ${token}`} : {})},
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      if (response.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      const data = await response.json().catch(() => ({}));
      throw new ApiError(response.status, typeof data.detail === 'string' ? data.detail : `请求失败 (${response.status})`);
    }
    if (!response.body) throw new Error('服务器没有返回流式正文');
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', done = false;
    const consume = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === 'error') throw new ApiError(502, event.text || '生成中断，已保留收到的内容');
      if (event.type !== 'delta' && event.type !== 'done') throw new Error('流式数据格式异常');
      if (event.type === 'delta' && typeof event.text !== 'string') throw new Error('流式正文格式异常');
      if (event.type === 'done') done = true;
      receive(event);
    };
    while (!done) {
      const next = await reader.read();
      buffer += decoder.decode(next.value, {stream: !next.done});
      let newline: number;
      while (!done && (newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); consume(line);
      }
      if (buffer.length > 1_000_000) throw new Error('流式数据过大');
      if (next.done) {
        if (!done && buffer.trim()) consume(buffer);
        if (!done) throw new Error('生成连接提前结束，已保留收到的内容，请重试');
        break;
      }
    }
  } catch (error) {
    if (signal.aborted) throw new DOMException('已停止生成', 'AbortError');
    if (controller.signal.aborted) throw new Error('生成超时，已保留收到的内容');
    throw error;
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', abort);
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}
