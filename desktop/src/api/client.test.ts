import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
vi.mock('../config', () => ({API_BASE: 'http://127.0.0.1:8010'}));
vi.mock('../utils/token', () => ({getToken: vi.fn(async () => 'test-token')}));
import {api, ApiError, AUTH_EXPIRED_EVENT} from './client';

const dispatchEvent = vi.fn();
beforeEach(() => {
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    dispatchEvent,
  });
  dispatchEvent.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('workspace API authentication and failures', () => {
  it('sends the current bearer token and notifies the app only for authenticated 401', async () => {
    const fetch = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({detail: 'expired'}), {status: 401}),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(api.get('/api/workspace/settings', true)).rejects.toMatchObject({
      status: 401,
      detail: 'expired',
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({headers: {Authorization: 'Bearer test-token'}});
    expect(dispatchEvent.mock.calls[0]?.[0].type).toBe(AUTH_EXPIRED_EVENT);
    dispatchEvent.mockClear();
    await expect(
      api.post('/api/auth/login-password', {email: 'a@b.c', password: 'wrong'}),
    ).rejects.toBeInstanceOf(ApiError);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
  it('does not expire login on an unreachable server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(api.get('/api/workspace/settings', true)).rejects.toMatchObject({status: 0});
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
  it('preserves server model configuration errors rather than returning a fake result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: RequestInfo | URL, _init?: RequestInit) =>
          new Response(JSON.stringify({detail: '未配置模型'}), {status: 503}),
      ),
    );
    await expect(
      api.post('/api/workspace/tools/intro', {input: '内容'}, true),
    ).rejects.toMatchObject({status: 503, detail: '未配置模型'});
  });
  it('sends multipart uploads without overriding the browser boundary', async () => {
    const fetch = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({id: 'resume-1'}), {status: 200}),
    );
    vi.stubGlobal('fetch', fetch);
    const body = new FormData();
    body.append('file', new Blob(['resume']), 'resume.txt');
    await expect(api.upload('/api/workspace/resumes/upload', body)).resolves.toEqual({
      id: 'resume-1',
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      body,
      headers: {Authorization: 'Bearer test-token'},
    });
    expect((fetch.mock.calls[0]?.[1] as RequestInit)?.headers).not.toHaveProperty('Content-Type');
  });
});
