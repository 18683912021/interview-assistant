/**
 * LibreOffice 本地文件转换
 *
 * 用 spawn 直接调用 LibreOffice 渲染引擎，一行命令替代 Android 端 150+ 行容错逻辑。
 */
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { app } from 'electron';

// 缓存 LO 版本号，自检通过后复用，避免每次转换都 spawn
let selfCheckCache: string | null = null;

export function getLibreOfficePath(): string | null {
  // 1. 系统安装 / LOCALAPPDATA 安装
  const systemPaths = [
    process.platform === 'win32' && path.join(process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'), 'LibreOffice', 'program', 'soffice.bin'),
    process.platform === 'win32' && 'D:\\LibreOffice\\program\\soffice.bin',
    process.platform === 'win32' && 'C:\\Program Files\\LibreOffice\\program\\soffice.bin',
    process.platform === 'win32' && 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.bin',
    process.platform === 'darwin' && '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    process.platform === 'darwin' && path.join(app.getPath('home'), 'Applications', 'LibreOffice.app', 'Contents', 'MacOS', 'soffice'),
    process.platform === 'linux' && '/usr/bin/soffice',
  ].filter(Boolean) as string[];

  for (const p of systemPaths) {
    if (fs.existsSync(p)) return p;
  }

  // 2. 旧版 Portable（userData 目录兼容）
  const portableDir = path.join(app.getPath('userData'), 'libreoffice-portable');
  const portablePaths = process.platform === 'win32'
    ? [
        path.join(portableDir, 'LibreOfficePortable', 'App', 'libreoffice', 'program', 'soffice.bin'),
        path.join(portableDir, 'program', 'soffice.bin'),
      ]
    : [path.join(portableDir, 'MacOS', 'soffice')];

  for (const p of portablePaths) {
    if (fs.existsSync(p)) return p;
  }

  // 3. 都没有
  return null;
}

/** 运行 soffice 命令，返回 { code, signal, stdout, stderr }。超时时会杀掉整个进程树 */
function runSoffice(
  soffice: string,
  args: string[],
  programDir: string,
  envOverrides: Record<string, string | undefined> | null,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const env: Record<string, string | undefined> = { ...process.env };
    // soffice.bin 需要 programDir 在 PATH 中才能找到自己的 DLL
    env.PATH = `${programDir}${path.delimiter}${process.env.PATH || ''}`;
    if (envOverrides) Object.assign(env, envOverrides);

    const proc = spawn(soffice, args, { cwd: programDir, env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;

    // 超时手动管理，保证杀掉整个进程树（spawn 自带的 timeout 只杀父进程）
    const timer = setTimeout(() => {
      if (!settled) {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid!)], { windowsHide: true });
        } else {
          proc.kill('SIGKILL');
        }
      }
    }, timeoutMs);

    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    };

    proc.stdout?.on('data', (c: Buffer) => { stdout += c.toString(); });
    proc.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
    proc.on('close', (code, signal) => finish(code, signal));
    proc.on('error', () => finish(null, null));
  });
}

export async function convertFile(inputPath: string, outputDir: string, toFormat: string, infilter?: string): Promise<string> {
  const soffice = getLibreOfficePath();
  if (!soffice) {
    throw new Error('文件转换引擎未安装');
  }

  const programDir = path.dirname(soffice);

  // 轻量自检（仅首次，结果缓存），避免每次转换都 spawn 多次进程
  if (!selfCheckCache) {
    const { code, signal, stdout, stderr } = await runSoffice(soffice, ['--version'], programDir, null, 30_000);
    if (code !== 0) {
      const parts = [`LibreOffice --version 自检失败 (exit ${code}, sig ${signal})`];
      if (stderr.trim()) parts.push(stderr.trim().slice(0, 500));
      parts.push(`路径: ${soffice}`);
      throw new Error(parts.join('\n'));
    }
    selfCheckCache = stdout.trim();
  }
  const loVersion = selfCheckCache;

  console.log(`[libreoffice] 引擎就绪: ${loVersion} (${soffice})`);

  // ═══ 执行转换 ═══
  const filterMap: Record<string, string> = {
    pdf: 'pdf:writer_pdf_Export',
    docx: 'docx:Office Open XML Text',
    doc: 'doc:MS Word 97',
    odt: 'odt:writer8',
    html: 'html',
  };
  const filter = filterMap[toFormat] || toFormat;

  // Windows 下中文文件名会导致 LO 命令行解析乱码，
  // 将文件复制到临时目录用 ASCII 安全文件名，转换完再搬回来
  const hasNonAscii = /[^\x00-\x7F]/.test(inputPath);
  const useTempFile = process.platform === 'win32' && hasNonAscii;
  const actualInput = useTempFile
    ? path.join(os.tmpdir(), `lo_input_${Date.now()}${path.extname(inputPath)}`)
    : inputPath;
  const tempOutputDir = useTempFile ? os.tmpdir() : outputDir;

  if (useTempFile) {
    fs.copyFileSync(inputPath, actualInput);
  }

  try {
    const args = ['--headless', '--norestore'];
    if (infilter) args.push(`--infilter=${infilter}`);
    args.push('--convert-to', filter, '--outdir', tempOutputDir, actualInput);

    const result = await runSoffice(soffice, args, programDir, null, 300_000);

    if (result.code !== 0 || result.signal) {
      const parts = [`转换失败 (exit ${result.code}, signal ${result.signal})`];
      if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.trim().slice(0, 1000)}`);
      if (result.stdout.trim()) parts.push(`stdout:\n${result.stdout.trim().slice(0, 1000)}`);
      parts.push(`命令: ${soffice} ${args.join(' ')}`);
      if (useTempFile) parts.push(`原文件: ${inputPath}`);
      parts.push(`LO 版本: ${loVersion}`);
      throw new Error(parts.join('\n'));
    }

    const outName = path.basename(actualInput, path.extname(actualInput)) + '.' + toFormat;
    const outPath = path.join(tempOutputDir, outName);

    if (useTempFile) {
      const finalPath = path.join(outputDir, path.basename(inputPath, path.extname(inputPath)) + '.' + toFormat);
      fs.copyFileSync(outPath, finalPath);
      try { fs.unlinkSync(outPath); } catch {}
      return finalPath;
    }
    return outPath;
  } finally {
    if (useTempFile) {
      try { fs.unlinkSync(actualInput); } catch {}
    }
  }
}

export async function convertToPdf(inputPath: string, outputDir: string): Promise<string> {
  return convertFile(inputPath, outputDir, 'pdf');
}
