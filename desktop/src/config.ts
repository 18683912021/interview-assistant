/**
 * 应用配置
 *
 * 开发模式 (localhost:5173)：Vite 代理 /api → 后端，API_BASE 用空串
 * 生产模式 (Electron file://)：直连后端
 */
export const API_HOST: string = import.meta.env.VITE_API_HOST || '47.108.205.102';

/** 主进程直连后端的 WS 地址（不走 Vite proxy，proxy 只对浏览器生效） */
export const MAIN_STREAM_URL: string = `ws://${API_HOST}:8010/api/ws/audio/stream`;

export const API_BASE: string = import.meta.env.DEV
  ? ''  // Vite proxy handles /api
  : `http://${API_HOST}:8010`;

export const STREAM_URL: string = import.meta.env.DEV
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/ws/audio/stream`  // Vite WS proxy
  : `ws://${API_HOST}:8010/api/ws/audio/stream`;

// ── 共享设置 ──
export type AppLanguage = 'zh' | 'en';

let _language: AppLanguage = 'zh';
const _langListeners: Array<(lang: AppLanguage) => void> = [];

export function getLanguage(): AppLanguage {
  return _language;
}

export function setLanguage(lang: AppLanguage): void {
  if (_language === lang) { return; }
  _language = lang;
  _langListeners.forEach(fn => fn(lang));
}

export function onLanguageChange(fn: (lang: AppLanguage) => void): () => void {
  _langListeners.push(fn);
  return () => {
    const idx = _langListeners.indexOf(fn);
    if (idx !== -1) { _langListeners.splice(idx, 1); }
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
