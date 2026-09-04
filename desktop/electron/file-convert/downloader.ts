/**
 * 文件转换引擎下载 & 自动安装
 *
 * Windows: 下载 MSI → msiexec /i 静默安装（D盘优先，回退 %LOCALAPPDATA%）
 * macOS:   下载 DMG → 挂载复制到 ~/Applications（无需管理员权限）
 */
import { app, net } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn, execSync } from 'child_process';

const VERSION = '26.2.5';

// Windows MSI 路径（国内优先，亚洲备选，欧美兜底）
const WIN_MIRRORS = [
  'https://mirrors.aliyun.com/libreoffice/stable',              // 阿里云
  'https://mirrors.cloud.tencent.com/libreoffice/libreoffice',      // 腾讯云
  'https://free.nchc.org.tw/tdf/libreoffice/stable',               // 台湾 NCHC
  'https://ftp.jaist.ac.jp/pub/tdf/libreoffice/stable',             // 日本 JAIST
  'https://ftp.kaist.ac.kr/tdf/libreoffice/stable',                 // 韩国 KAIST
  'https://ftp.osuosl.org/pub/tdf/libreoffice/stable',              // 美国
  'https://download.documentfoundation.org/libreoffice/stable',     // 官方
];
const WIN_FILE = `LibreOffice_${VERSION}_Win_x86-64.msi`;
const WIN_INSTALL_DIR = (() => {
  // D 盘可用则优先装 D 盘，否则回退到 %LOCALAPPDATA%
  if (fs.existsSync('D:\\')) return 'D:\\LibreOffice';
  return path.join(process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'), 'LibreOffice');
})();

// macOS 装到用户 ~/Applications，避免 /Applications 需要管理员权限
const MAC_APP_PATH = path.join(app.getPath('home'), 'Applications', 'LibreOffice.app');

// macOS DMG 路径
const MAC_MIRRORS = [
  'https://mirrors.aliyun.com/libreoffice/stable',              // 阿里云
  'https://mirrors.cloud.tencent.com/libreoffice/libreoffice',      // 腾讯云
  'https://free.nchc.org.tw/tdf/libreoffice/stable',               // 台湾
  'https://ftp.jaist.ac.jp/pub/tdf/libreoffice/stable',             // 日本
  'https://ftp.kaist.ac.kr/tdf/libreoffice/stable',                 // 韩国
  'https://ftp.osuosl.org/pub/tdf/libreoffice/stable',              // 美国
  'https://download.documentfoundation.org/libreoffice/stable',     // 官方
];
const MAC_ARCH = process.arch === 'arm64' ? 'aarch64' : 'x86-64';
const MAC_FILE = `LibreOffice_${VERSION}_MacOS_${MAC_ARCH}.dmg`;

const STATE_FILE = path.join(app.getPath('userData'), 'libreoffice-download-state.json');

interface DownloadState {
  url: string;
  totalBytes: number;
  downloadedBytes: number;
  tmpFile: string;
}

let abortReq: Electron.ClientRequest | null = null;
let curTmp: string | null = null;
let busy = false;

/* ── 工具 ── */
function rd(): DownloadState | null {
  try { if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); } catch {}
  return null;
}
function wr(s: DownloadState) { fs.writeFileSync(STATE_FILE, JSON.stringify(s), 'utf-8'); }
function cl() { try { fs.unlinkSync(STATE_FILE); } catch {} }
function tmp() { return path.join(app.getPath('userData'), `lo-installer-${Date.now()}.tmp`); }
function slp(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function isWin() { return process.platform === 'win32'; }

/* ── 检查已安装 ── */
export function isLibreOfficeDownloaded(): boolean {
  if (isWin()) {
    const paths = [
      path.join(WIN_INSTALL_DIR, 'program', 'soffice.bin'),
      'C:\\Program Files\\LibreOffice\\program\\soffice.bin',
      'D:\\LibreOffice\\program\\soffice.bin',
    ];
    return paths.some(p => fs.existsSync(p));
  }
  return fs.existsSync(path.join(MAC_APP_PATH, 'Contents', 'MacOS', 'soffice'));
}

/* ── 检查未完成下载 ── */
export function getPartialDownload(): { downloadedBytes: number; totalBytes: number } | null {
  const s = rd();
  if (!s || !s.tmpFile || s.downloadedBytes <= 0 || !fs.existsSync(s.tmpFile)) return null;
  const st = fs.statSync(s.tmpFile);
  if (st.size < s.downloadedBytes - 4096 || st.size > s.downloadedBytes + 1048576) {
    try { fs.unlinkSync(s.tmpFile); } catch {}; cl(); return null;
  }
  curTmp = s.tmpFile;
  return { downloadedBytes: s.downloadedBytes, totalBytes: s.totalBytes };
}

/* ── URL 列表 ── */
function urls(): string[] {
  const mirrors = isWin() ? WIN_MIRRORS : MAC_MIRRORS;
  const file = isWin() ? WIN_FILE : MAC_FILE;
  const subdir = isWin() ? 'win/x86_64' : `mac/${MAC_ARCH}`;
  return mirrors.map(b => `${b}/${VERSION}/${subdir}/${file}`);
}

/* ── 启动清理 ── */
export function cleanupStaleFiles(): void {
  const dir = app.getPath('userData');
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('lo-installer-') || f === 'libreoffice-installer-tmp') {
        const s = rd();
        if (!s || s.tmpFile !== path.join(dir, f)) try { fs.unlinkSync(path.join(dir, f)); } catch {}
      }
    }
  } catch {}
}

/* ═══════════════════════════════
   主流程
   ═══════════════════════════════ */
export async function downloadLibreOffice(
  onProgress: (pct: number, stage: string) => void,
  resume: boolean = false,
): Promise<string> {
  if (isLibreOfficeDownloaded()) { onProgress(100, 'done'); return isWin() ? WIN_INSTALL_DIR : MAC_APP_PATH; }
  if (busy) throw new Error('下载已在进行中');
  busy = true;

  try {
    let start = 0;
    const s = resume ? rd() : null;
    if (resume && s && s.tmpFile && fs.existsSync(s.tmpFile)) {
      start = s.downloadedBytes; curTmp = s.tmpFile;
    } else {
      if (curTmp) { try { fs.unlinkSync(curTmp); } catch {} }
      cleanupStaleFiles(); curTmp = tmp(); cl();
    }

    let lastErr: Error | null = null;
    for (const url of urls()) {
      let retry = 0;
      while (retry < 3) {
        try {
          if (retry === 0) {
            const resumePct = start > 0 && s?.totalBytes ? Math.round(start / s.totalBytes * 100) : 0;
            onProgress(resumePct, 'connecting');
          }
          await dl(url, start, curTmp!, (dl, total) => {
            const pct = total > 0 ? Math.round(dl / total * 100) : 0;
            wr({ url, totalBytes: total, downloadedBytes: dl, tmpFile: curTmp! });
            onProgress(pct, 'downloading');
          });
          lastErr = null; break;
        } catch (e: any) {
          lastErr = e;
          if (e.message === 'PAUSED') throw e;
          retry++;
          if (retry < 3) {
            await slp(Math.min(1000 * Math.pow(2, retry - 1), 8000));
            const ns = rd();
            if (ns && ns.downloadedBytes > 0 && fs.existsSync(ns.tmpFile)) { start = ns.downloadedBytes; curTmp = ns.tmpFile; }
            else { start = 0; if (curTmp) { try { fs.unlinkSync(curTmp); } catch {} } curTmp = tmp(); }
          }
        }
      }
      if (!lastErr) break;
      start = 0; if (curTmp) { try { fs.unlinkSync(curTmp); } catch {} } curTmp = tmp();
    }
    if (lastErr) { cl(); throw lastErr; }

    // ── 校验 ──
    if (!fs.existsSync(curTmp!)) throw new Error('下载文件丢失');
    const stat = fs.statSync(curTmp!);
    if (stat.size < 100 * 1024 * 1024) throw new Error(`下载文件不完整 (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);

    // MSI 文件头校验：合法 MSI 前 8 字节固定为 OLE2 复合文档魔术字
    if (isWin()) {
      const head = Buffer.alloc(8);
      const fd = fs.openSync(curTmp!, 'r');
      fs.readSync(fd, head, 0, 8, 0);
      fs.closeSync(fd);
      const MSI_MAGIC = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
      if (!head.equals(MSI_MAGIC)) {
        const preview = head.toString('hex');
        try { fs.unlinkSync(curTmp!); } catch {}
        throw new Error(`下载的文件不是有效的 MSI 安装包（文件头: ${preview}，镜像可能返回了错误页面）`);
      }
    }

    // ── 安装 ──
    onProgress(100, 'extracting');
    if (isWin()) {
      await installMSI(curTmp!);
    } else {
      await installDMG(curTmp!);
    }

    try { fs.unlinkSync(curTmp!); } catch {}
    cl();
    onProgress(100, 'done');
    return isWin() ? WIN_INSTALL_DIR : MAC_APP_PATH;
  } finally {
    busy = false;
  }
}

/* ── Windows MSI 完整安装 ── */
async function installMSI(msiPath: string): Promise<void> {
  // 清理目标目录残留，避免 1603
  if (fs.existsSync(WIN_INSTALL_DIR)) {
    try { fs.rmSync(WIN_INSTALL_DIR, { recursive: true, force: true }); } catch {}
  }
  const parentDir = path.dirname(WIN_INSTALL_DIR);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // 原地重命名 .tmp → .msi（不跨目录，避免 SecureRepair）
  const safePath = msiPath.replace(/\.tmp$/, '.msi');
  try { fs.renameSync(msiPath, safePath); } catch {
    fs.copyFileSync(msiPath, safePath);
    try { fs.unlinkSync(msiPath); } catch {}
  }

  // 先卸载可能残留的同版本 MSI 记录
  try {
    await new Promise<void>((res) => {
      const p = spawn('msiexec', ['/x', safePath, '/qn', '/norestart'], { timeout: 60_000, windowsHide: true });
      p.on('close', () => res());
      p.on('error', () => res());
    });
    await slp(1000);
  } catch {}

  // /i 完整安装：会正确生成 services.rdb、注册过滤器等
  await new Promise<void>((resolve, reject) => {
    const args = [
      '/i', safePath,
      '/qn', '/norestart',
      `INSTALLLOCATION=${WIN_INSTALL_DIR}`,
      'ADDLOCAL=ALL',
      'REGISTER_NO_MSO_TYPES=1',
      'REGISTER_DOC=0',
      'ISCHECKFORPRODUCTUPDATES=0',
    ];
    const p = spawn('msiexec', args, { timeout: 300_000, windowsHide: true });
    p.on('close', (c: number | null) => {
      try { fs.unlinkSync(safePath); } catch {}
      if (c === 0 || c === 3010) {
        const exe = path.join(WIN_INSTALL_DIR, 'program', 'soffice.bin');
        if (fs.existsSync(exe)) return resolve();
        return reject(new Error(`安装完成但未找到 soffice.bin（${WIN_INSTALL_DIR}）`));
      }
      const msgs: Record<number, string> = {
        1602: '安装被取消',
        1603: '安装过程发生致命错误（可能需要管理员权限安装到系统盘以外的目录）',
        1618: '另一个安装正在进行中',
        1619: '安装包无法打开，文件可能已损坏',
        1620: '安装包不是有效的 MSI 文件',
        1625: '需要管理员权限',
      };
      reject(new Error(msgs[c||0] || `安装失败 (exit ${c})`));
    });
    p.on('error', (e) => {
      try { fs.unlinkSync(safePath); } catch {}
      reject(new Error(`安装启动失败: ${e.message}`));
    });
  });

  // 补 VC++ DLL（/qn 静默安装可能跳过 VC++ Merge Module）
  const VC_DLLS = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll', 'concrt140.dll', 'vccorlib140.dll'];
  const sysDir = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32') : 'C:\\Windows\\System32';
  const progDir = path.join(WIN_INSTALL_DIR, 'program');
  for (const dll of VC_DLLS) {
    const dest = path.join(progDir, dll);
    if (!fs.existsSync(dest)) {
      const src = path.join(sysDir, dll);
      if (fs.existsSync(src)) {
        try { fs.copyFileSync(src, dest); } catch {}
      }
    }
  }
}

/* ── macOS DMG 安装 ── */
async function installDMG(dmgPath: string): Promise<void> {
  const mountPoint = `/Volumes/LibreOffice-${Date.now()}`;
  return new Promise((resolve, reject) => {
    try {
      execSync(`hdiutil attach "${dmgPath}" -mountpoint "${mountPoint}" -nobrowse -quiet`, { timeout: 60000 });
      // DMG 内的 .app 名称可能是 "LibreOffice.app" 或带版本号
      const files = fs.readdirSync(mountPoint);
      const appName = files.find(f => f.endsWith('.app')) || 'LibreOffice.app';
      const targetDir = path.dirname(MAC_APP_PATH);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      // 如果已存在旧版本，先删除
      if (fs.existsSync(MAC_APP_PATH)) fs.rmSync(MAC_APP_PATH, { recursive: true, force: true });
      execSync(`cp -R "${mountPoint}/${appName}" "${MAC_APP_PATH}"`, { timeout: 120000 });
      execSync(`hdiutil detach "${mountPoint}" -quiet`, { timeout: 10000 });
      // macOS 清理：不注册文件关联
      try { execSync(`defaults write "${MAC_APP_PATH}/Contents/Info.plist" CFBundleDocumentTypes -array`, { timeout: 5000 }); } catch {}
      resolve();
    } catch (e: any) { reject(e); }
  });
}

/* ── 下载 ── */
function dl(url: string, startByte: number, tf: string, onData: (dl: number, total: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url, redirect: 'follow' });
    if (startByte > 0) req.setHeader('Range', `bytes=${startByte}-`);
    abortReq = req;
    let settled = false;

    // 空闲超时：60s 内没收到数据才断，每收到数据就重置
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const resetIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!settled) { req.abort(); done(new Error('下载超时，请检查网络')); }
      }, 60_000);
    };
    resetIdle();

    const done = (e?: Error) => {
      if (settled) return;
      settled = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (abortReq === req) abortReq = null;
      e ? reject(e) : resolve();
    };

    let lastPct = -1;
    let lastTime = 0;

    req.on('response', (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) { done(new Error(`服务器返回 ${res.statusCode}`)); return; }
      const cl = parseInt((res.headers['content-length'] as string) ?? '0', 10);
      const cr = res.headers['content-range'] as string | undefined;
      let total = cl + startByte;
      if (cr) { const m = cr.match(/bytes \d+-\d+\/(\d+)/); if (m) total = parseInt(m[1]!, 10); }
      const ws = fs.createWriteStream(tf, { flags: startByte > 0 ? 'a' : 'w' });
      let d = startByte;
      res.on('data', (c: Buffer) => {
        try { ws.write(c); } catch {}
        d += c.length;
        resetIdle();

        // 节流：最多 100ms 一次，且百分比至少变 1%
        const now = Date.now();
        const pct = total > 0 ? Math.round(d / total * 100) : 0;
        if (pct !== lastPct && now - lastTime >= 100) {
          lastPct = pct;
          lastTime = now;
          onData(d, total);
        }
      });
      res.on('end', () => { ws.end(); ws.on('finish', () => done()); });
      res.on('error', (e) => { ws.close(); done(e); });
      res.on('aborted', () => { ws.close(); done(new Error('PAUSED')); });
    });
    req.on('error', (e) => done(e));
    req.on('abort', () => done(new Error('PAUSED')));
    req.end();
  });
}

/* ── 暂停 ── */
export function pauseDownload(): void { abortReq?.abort(); abortReq = null; }

/* ── 清理 ── */
export function cleanupPartialDownload(): void {
  pauseDownload();
  const s = rd();
  if (s?.tmpFile) { try { fs.unlinkSync(s.tmpFile); } catch {} }
  if (curTmp) { try { fs.unlinkSync(curTmp); } catch {} }
  curTmp = null; cl(); cleanupStaleFiles();
}

/* ── 本地安装 ── */
export async function installFromLocalFile(pth: string, onProgress: (pct: number, stage: string) => void): Promise<string> {
  if (!fs.existsSync(pth)) throw new Error('文件不存在');
  if (isLibreOfficeDownloaded()) { onProgress(100, 'done'); return isWin() ? WIN_INSTALL_DIR : MAC_APP_PATH; }
  cl(); onProgress(50, 'extracting');
  if (isWin()) { await installMSI(pth); } else { await installDMG(pth); }
  onProgress(100, 'done');
  return isWin() ? WIN_INSTALL_DIR : MAC_APP_PATH;
}
