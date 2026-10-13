import { afterEach, describe, expect, it, vi } from 'vitest';

const sockets = vi.hoisted(() => [] as any[]);
vi.mock('ws', async () => {
  const { EventEmitter } = await import('events');
  class Socket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    send = vi.fn();
    close = vi.fn();
    terminate = vi.fn();
    constructor(public url: string, public options: any) { super(); sockets.push(this); }
  }
  return { default: Socket };
});
import { StreamClient } from '../audio/stream-client';
import { AudioCaptureManager } from '../audio/audio-capture';

afterEach(() => vi.useRealTimers());

describe('desktop audio WebSocket boundary', () => {
  it('authenticates in headers and decodes text Buffer frames with request IDs', async () => {
    const client = new StreamClient();
    const chunks: any[] = [];
    const transcriptions: any[] = [];
    client.on('llmChunk', m => chunks.push(m));
    client.on('transcription', m => transcriptions.push(m));
    const connected = client.connect('wss://interview.example/api/ws/audio/stream', 'test-token');
    const socket = sockets.at(-1);
    expect(socket.options.headers).toEqual({ Authorization: 'Bearer test-token' });
    expect(socket.url).not.toContain('test-token');
    socket.emit('open');
    socket.emit('message', Buffer.from('{"type":"ready"}'), false);
    await connected;
    socket.emit('message', Buffer.from('{"type":"llm_chunk","request_id":"q-4","delta":"结论"}'), false);
    socket.emit('message', Buffer.from('{"type":"transcription","utterance_id":"segment-2","revision":4,"text":"完整问题","is_final":true}'), false);
    socket.emit('message', Buffer.from('{"type":"llm_chunk","request_id":"binary-must-ignore"}'), true);
    expect(chunks).toEqual([{ type: 'llm_chunk', request_id: 'q-4', delta: '结论' }]);
    expect(transcriptions[0]).toMatchObject({ utterance_id: 'segment-2', revision: 4, is_final: true });
    client.disconnect();
  });

  it('rejects credentials in URLs and unencrypted remote endpoints', async () => {
    const client = new StreamClient();
    await expect(client.connect('ws://interview.example/api/ws', 'token')).rejects.toThrow('WSS');
    await expect(client.connect('wss://interview.example/api/ws?token=secret', 'token')).rejects.toThrow('认证参数');
    await expect(client.connect('wss://interview.example/api/ws', '')).rejects.toThrow('登录凭证');
  });

  it('does not retry a revoked token', async () => {
    const client = new StreamClient();
    client.on('error', () => {});
    const states: string[] = [];
    client.on('streamState', state => states.push(state));
    const connected = client.connect('ws://127.0.0.1:8010/api/ws/audio/stream', 'revoked');
    const socket = sockets.at(-1);
    socket.emit('message', Buffer.from('{"type":"error","code":"E_AUTH","message":"登录已失效"}'), false);
    await expect(connected).rejects.toThrow('登录已失效');
    socket.emit('close', 4401, Buffer.alloc(0));
    expect(states).toContain('dead');
    expect(states).not.toContain('reconnecting');
    client.disconnect();
  });

  it('refuses manual answer controls when no connection is ready', () => {
    const manager = new AudioCaptureManager();
    expect(() => manager.sendControl({ type: 'llm_query', request_id: 'q' })).toThrow('尚未就绪');
  });

  it('shares finalization when the renderer and window close stop together', async () => {
    const manager = new AudioCaptureManager();
    const stopNative = vi.fn();
    (manager as any).state = 'capturing';
    (manager as any).nativeCapture = { stop: stopNative };
    const first = manager.stop('user_stop');
    const second = manager.stop('main_window_closed');
    expect(first).toBe(second);
    expect(stopNative).toHaveBeenCalledOnce();
    expect(manager.getState()).toBe('preparing');
    await first;
    expect(manager.getState()).toBe('completed');
  });

  it('restores the current answer for late overlay subscribers and ignores another request', () => {
    const manager = new AudioCaptureManager();
    const stream = (manager as unknown as { stream: StreamClient }).stream;
    const baseline = manager.getSnapshot();
    stream.emit('llmStart', { request_id: 'old', question_text: '旧问题' });
    stream.emit('llmChunk', { request_id: 'old', delta: '旧答案' });
    stream.emit('llmStart', { request_id: 'new', question_text: '当前问题' });
    stream.emit('llmChunk', { request_id: 'old', delta: '旧的迟到片段' });
    stream.emit('llmDone', { request_id: 'old', status: 'cancelled', full_answer: '旧答案' });
    expect(manager.getSnapshot().currentAnswer).toEqual({ request_id: 'new', question_text: '当前问题', text: '', chunk_index: -1, status: 'loading' });
    stream.emit('llmChunk', { request_id: 'new', delta: '当前回答', chunk_index: 0 });
    stream.emit('llmChunk', { request_id: 'new', delta: '重复片段', chunk_index: 0 });
    expect(manager.getSnapshot()).toMatchObject({ ...baseline,
      currentAnswer: { request_id: 'new', question_text: '当前问题', text: '当前回答', chunk_index: 0, status: 'streaming' } });
    const copy = manager.getSnapshot().currentAnswer!;
    copy.text = 'modified copy';
    expect(manager.getSnapshot().currentAnswer?.text).toBe('当前回答');
  });

  it.each([['completed', 'done'], ['failed', 'error'], ['cancelled', 'cancelled'], ['truncated', 'truncated']])(
    'keeps the final answer in late-open snapshots for %s', (status, expected) => {
      const manager = new AudioCaptureManager();
      const stream = (manager as unknown as { stream: StreamClient }).stream;
      stream.emit('llmStart', { request_id: 'current', question_text: '问题' });
      stream.emit('llmChunk', { request_id: 'current', delta: '已输出' });
      stream.emit('llmDone', { request_id: 'current', status, full_answer: '已输出内容' });
      stream.emit('llmChunk', { request_id: 'current', delta: '完成后的迟到片段' });
      expect(manager.getSnapshot().currentAnswer).toEqual({ request_id: 'current', question_text: '问题', text: '已输出内容', chunk_index: 0, status: expected });
    },
  );

  it('clears the previous answer when a new capture begins, including connection failure', async () => {
    const manager = new AudioCaptureManager();
    manager.on('error', () => {});
    const stream = (manager as unknown as { stream: StreamClient }).stream;
    stream.emit('llmStart', { request_id: 'old-session', question_text: '旧场次问题' });
    vi.spyOn(stream, 'connect').mockRejectedValue(new Error('mock connection failure'));
    await expect(manager.start('mic', '12345678-1234-1234-1234-123456789abc', 'wss://example.test', 'test-token')).rejects.toThrow('mock connection failure');
    expect(manager.getSnapshot().currentAnswer).toBeNull();
  });

  it('clears answer memory explicitly without later chunks restoring logged-out content', () => {
    const manager = new AudioCaptureManager();
    const stream = (manager as unknown as { stream: StreamClient }).stream;
    stream.emit('llmStart', { request_id: 'previous-user', question_text: '旧用户的问题' });
    stream.emit('llmChunk', { request_id: 'previous-user', delta: '个人经历', chunk_index: 0 });
    manager.clearAnswer();
    stream.emit('llmChunk', { request_id: 'previous-user', delta: '迟到内容', chunk_index: 1 });
    stream.emit('llmDone', { request_id: 'previous-user', full_answer: '个人经历', status: 'cancelled' });
    expect(manager.getSnapshot().currentAnswer).toBeNull();
  });

  it('schedules one reconnect when a handshake timeout also produces close', async () => {
    vi.useFakeTimers();
    const client = new StreamClient();
    client.on('error', () => {});
    const result = client.connect('ws://127.0.0.1:8010/api/ws', 'test').catch(error => error);
    const socket = sockets.at(-1);
    socket.terminate.mockImplementation(() => socket.emit('close', 1006, Buffer.alloc(0)));
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toBeInstanceOf(Error);
    expect(vi.getTimerCount()).toBe(1);
    const count = sockets.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(sockets).toHaveLength(count + 1);
    client.disconnect();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects control confirmation immediately on disconnect and removes its listeners', async () => {
    vi.useFakeTimers();
    const client = new StreamClient();
    const confirmation = client.waitForControl('session_stopped', 18000).catch(error => error);
    client.disconnect();
    expect((await confirmation).message).toContain('已中断');
    expect(client.listenerCount('controlMessage')).toBe(0);
    expect(client.listenerCount('streamState')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects the original connect promise when retries are exhausted', async () => {
    vi.useFakeTimers();
    const client = new StreamClient();
    client.on('error', () => {});
    const result = client.connect('ws://127.0.0.1:8010/api/ws', 'test').catch(error => error);
    for (let index = 0; index <= 10; index += 1) {
      sockets.at(-1).emit('close', 1006, Buffer.alloc(0));
      if (index < 10) await vi.advanceTimersByTimeAsync(Math.min(500 * 2 ** index, 30000));
    }
    expect((await result).message).toContain('重试失败');
    client.disconnect();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disconnects and removes retries after a manager start fails', async () => {
    vi.useFakeTimers();
    const manager = new AudioCaptureManager();
    manager.on('error', () => {});
    const start = manager.start('mic', '12345678-1234-1234-1234-123456789abc', 'ws://127.0.0.1:8010/api/ws', 'test').catch(error => error);
    const socket = sockets.at(-1);
    socket.terminate.mockImplementation(() => socket.emit('close', 1006, Buffer.alloc(0)));
    await vi.advanceTimersByTimeAsync(10000);
    expect(await start).toBeInstanceOf(Error);
    expect(manager.getState()).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not reconnect a deleted interview session', async () => {
    vi.useFakeTimers();
    const client = new StreamClient();
    client.on('error', () => {});
    const connected = client.connect('ws://127.0.0.1:8010/api/ws', 'test');
    const socket = sockets.at(-1);
    socket.emit('message', Buffer.from('{"type":"ready"}'), false);
    await connected;
    socket.emit('close', 4404, Buffer.alloc(0));
    expect(client.isReady()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    client.disconnect();
  });
});
