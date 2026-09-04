// ── 测试环境地址（改 ACTIVE_HOST 即可切换） ──
const TEST_HOSTS = {
  home:     '192.168.1.200',  // 家里 WiFi（静态 IP）
  company:  '192.168.7.149',  // 公司 WiFi
  local:    'localhost',      // 本机
  android:  '10.0.2.2',      // Android 模拟器
  server:   'interview.iyouzi.cc', // 生产服务器（nginx 反代 80/443，DNS 需已解析）
} as const;

/** 联调时在这里选一个环境 */
const ACTIVE_HOST: string = TEST_HOSTS.server;

/** 域名反代环境走 HTTPS/WSS（server 公网部署）；局域网/本机联调保持明文。
 *  部署后 8010 仅监听 127.0.0.1，公网必须经 nginx 站点访问。 */
const SECURE_HOSTS: ReadonlySet<string> = new Set([TEST_HOSTS.server]);
const secure = SECURE_HOSTS.has(ACTIVE_HOST);

export const STREAM_URL: string = `${secure ? 'wss' : 'ws'}://${ACTIVE_HOST}/api/ws/audio/stream`;

/** REST API 基础地址，简历上传等 HTTP 接口使用。 */
export const API_BASE: string = `${secure ? 'https' : 'http'}://${ACTIVE_HOST}`;

// ── 共享设置（跨 Tab 读写） ──
export type AppLanguage = 'zh' | 'en';

let _language: AppLanguage = 'zh';
const _listeners: Array<(lang: AppLanguage) => void> = [];

export function getLanguage(): AppLanguage {
  return _language;
}

export function setLanguage(lang: AppLanguage): void {
  if (_language === lang) { return; }
  _language = lang;
  _listeners.forEach(fn => fn(lang));
}

export function onLanguageChange(fn: (lang: AppLanguage) => void): () => void {
  _listeners.push(fn);
  return () => {
    const idx = _listeners.indexOf(fn);
    if (idx !== -1) { _listeners.splice(idx, 1); }
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
