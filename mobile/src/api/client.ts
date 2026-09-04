/**
 * API 请求基础层 —— 统一超时、错误处理、JSON 解析。
 *
 * 所有 API 模块通过此 client 发请求，后期改鉴权、加拦截器只改这里。
 */

import {API_BASE} from '../config';
import {getToken} from '../utils/token';

const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = 'ApiError';
  }
}

async function _headers(withAuth: boolean, extra: Record<string, string> = {}): Promise<Record<string, string> | undefined> {
  const h: Record<string, string> = {...extra};
  if (withAuth) {
    const token = await getToken();
    if (token) { h['Authorization'] = `Bearer ${token}`; }
  }
  return Object.keys(h).length > 0 ? h : undefined;
}

async function request<T = any>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  withAuth: boolean = false,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body
        ? {...(await _headers(withAuth)), 'Content-Type': 'application/json'}
        : await _headers(withAuth),
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      let detail = data.detail || `请求失败 (${res.status})`;
      // Pydantic 422 返回 [{type, loc, msg, input}]，提取 msg
      if (Array.isArray(detail)) {
        detail = detail.map((e: any) => e.msg || JSON.stringify(e)).join('；');
      }
      throw new ApiError(res.status, detail);
    }

    return data as T;
  } catch (err: unknown) {
    if (err instanceof ApiError) { throw err; }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(0, '请求超时，请检查网络');
    }
    throw new ApiError(0, '网络错误，请检查网络连接');
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  get: <T = any>(path: string, withAuth = false) => request<T>('GET', path, undefined, DEFAULT_TIMEOUT_MS, withAuth),
  post: <T = any>(path: string, body?: Record<string, unknown>, withAuth = false) =>
    request<T>('POST', path, body, DEFAULT_TIMEOUT_MS, withAuth),
  put: <T = any>(path: string, body?: Record<string, unknown>, withAuth = false) =>
    request<T>('PUT', path, body, DEFAULT_TIMEOUT_MS, withAuth),
  del: <T = any>(path: string, withAuth = false) =>
    request<T>('DELETE', path, undefined, DEFAULT_TIMEOUT_MS, withAuth),
  upload: <T = any>(path: string, formData: FormData) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    return getToken().then(token => {
      const headers: Record<string, string> = {};
      if (token) { headers['Authorization'] = `Bearer ${token}`; }
      return fetch(`${API_BASE}${path}`, {
        method: 'POST',
        body: formData,
        headers,
        signal: controller.signal,
      });
    }).then(async res => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        let detail = data.detail || '上传失败';
        if (Array.isArray(detail)) {
          detail = detail.map((e: any) => e.msg || JSON.stringify(e)).join('；');
        }
        throw new ApiError(res.status, detail);
      }
      return data as T;
    }).finally(() => clearTimeout(timer));
  },
};
