// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
vi.mock('../config', () => ({API_BASE: 'https://api.test'}));
vi.mock('../utils/token', () => ({getToken: async () => 'test-token'}));
import {streamJSON} from './stream';
afterEach(() => vi.unstubAllGlobals());
function response(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({start(controller) {
    // One-byte chunks deliberately cut through multibyte Chinese characters and records.
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  }}));
}
it('delivers UTF-8 deltas incrementally and requires a terminal record', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('{"type":"delta","text":"你好"}\n{"type":"done"}\n')));
  const receive = vi.fn();
  await streamJSON('/test', {}, receive, new AbortController().signal);
  expect(receive.mock.calls[0]?.[0]).toEqual({type: 'delta', text: '你好'});
  expect(receive.mock.calls[1]?.[0].type).toBe('done');
});
it('retains partial output and reports disconnection instead of claiming success', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('{"type":"delta","text":"已收到"}\n')));
  const receive = vi.fn();
  await expect(streamJSON('/test', {}, receive, new AbortController().signal)).rejects.toThrow('提前结束');
  expect(receive).toHaveBeenCalledTimes(1);
});
it('reports in-stream provider errors and signals expired authentication', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response('{"type":"error","text":"服务忙"}\n'))
    .mockResolvedValueOnce(new Response('{"detail":"登录失效"}', {status: 401}));
  vi.stubGlobal('fetch', fetch);
  await expect(streamJSON('/test', {}, () => {}, new AbortController().signal)).rejects.toThrow('服务忙');
  const expired = vi.fn(); window.addEventListener('interview:auth-expired', expired);
  await expect(streamJSON('/test', {}, () => {}, new AbortController().signal)).rejects.toThrow('登录失效');
  expect(expired).toHaveBeenCalledOnce(); window.removeEventListener('interview:auth-expired', expired);
});
