import {API_BASE} from '../config';
import {getToken} from '../utils/token';

export const AUTH_EXPIRED_EVENT = 'interview:auth-expired';
export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = 'ApiError';
  }
}
function errorDetail(data: {detail?: unknown}, status: number): string {
  if (typeof data.detail === 'string') return data.detail;
  if (Array.isArray(data.detail))
    return data.detail
      .map(e => (typeof e?.msg === 'string' ? e.msg : '输入内容不符合要求'))
      .join('；');
  return `请求失败 (${status})`;
}
async function request<T>(
  method: string,
  path: string,
  body?: Record<string, unknown> | FormData,
  withAuth = false,
  timeout = 15_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    const headers: Record<string, string> = {};
    if (withAuth) {
      const token = await getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const multipart = body instanceof FormData;
    if (body && !multipart) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? (multipart ? body : JSON.stringify(body)) : undefined,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && withAuth) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      throw new ApiError(response.status, errorDetail(data, response.status));
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError')
      throw new ApiError(0, '请求超时，请稍后重试');
    throw new ApiError(0, '无法连接服务器，请检查网络后重试');
  } finally {
    window.clearTimeout(timer);
  }
}
export const api = {
  get: <T = unknown>(path: string, auth = false) => request<T>('GET', path, undefined, auth),
  post: <T = unknown>(
    path: string,
    body?: Record<string, unknown>,
    auth = false,
    timeout = 15_000,
  ) => request<T>('POST', path, body, auth, timeout),
  put: <T = unknown>(path: string, body?: Record<string, unknown>, auth = false) =>
    request<T>('PUT', path, body, auth),
  del: <T = unknown>(path: string, auth = false) => request<T>('DELETE', path, undefined, auth),
  upload: <T = unknown>(path: string, body: FormData) =>
    request<T>('POST', path, body, true, 90_000),
};
export {messageOf} from '../utils/error-message';
