/** API/WS use local development by default; packaged deployments set explicit endpoints. */
export const API_HOST: string = import.meta.env.VITE_API_HOST || '127.0.0.1';
const localHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(API_HOST);
const defaultOrigin = localHost ? `http://${API_HOST}:8010` : `https://${API_HOST}`;
export const API_BASE: string = (
  import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? '' : defaultOrigin)
).replace(/\/$/, '');
const directOrigin = API_BASE || defaultOrigin;
/** Main-process connection cannot use the renderer's Vite proxy. */
export const MAIN_STREAM_URL: string =
  import.meta.env.VITE_STREAM_URL || `${directOrigin.replace(/^http/, 'ws')}/api/ws/audio/stream`;
/** Optional deployment IP for the realtime connection; DNS remains a fallback. */
export const STREAM_DIRECT_ADDRESS: string | undefined = import.meta.env.VITE_STREAM_DIRECT_IP || undefined;
export const STREAM_URL: string =
  import.meta.env.VITE_STREAM_URL ||
  (import.meta.env.DEV && !API_BASE && typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/ws/audio/stream`
    : MAIN_STREAM_URL);

// ── 共享设置 ──
export type AppLanguage = 'zh' | 'en';

let _language: AppLanguage = 'zh';
const _langListeners: Array<(lang: AppLanguage) => void> = [];

export function getLanguage(): AppLanguage {
  return _language;
}

export function setLanguage(lang: AppLanguage): void {
  if (_language === lang) {
    return;
  }
  _language = lang;
  _langListeners.forEach(fn => fn(lang));
}

export function onLanguageChange(fn: (lang: AppLanguage) => void): () => void {
  _langListeners.push(fn);
  return () => {
    const idx = _langListeners.indexOf(fn);
    if (idx !== -1) {
      _langListeners.splice(idx, 1);
    }
  };
}

// ── 编程语言赛道 ──
export type ProgLang = 'JavaScript' | 'Java' | 'Python' | 'C#' | 'C++' | 'Go';

let _progLang: ProgLang = 'JavaScript';

export function getProgLang(): ProgLang {
  return _progLang;
}

export function setProgLang(lang: ProgLang): void {
  _progLang = lang;
}
