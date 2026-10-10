/**
 * IPC 路由注册 —— 连接 preload 暴露的 channel 和主进程实现
 */
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { getOverlayWindow, createOverlayWindow, destroyOverlayWindow } from './windows/overlay-window.js';
import { shell } from 'electron';
import { audioCapture } from './audio/audio-capture.js';
import { getAudioPermissions } from './audio/media-permissions.js';
import { listSystemOutputs } from './audio/windows-loopback.js';
import { DesktopStorage } from './storage.js';
import fs from 'fs';
import net from 'node:net';
import { app } from 'electron';
import { mainWindow } from './main.js';

const storage = new DesktopStorage(app.getPath('userData'));

export const flushStorage = (): Promise<void> => storage.flush();

// ── 端口检查工具 ──
export function checkPort(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
    server.on('error', () => resolve(false));
  });
}

export function registerIpcHandlers(): void {
  // 窗口可能已销毁（用户关闭/重建窗口时 mainWindow 仍指向旧实例），
  // webContents.send 会抛 "Object has been destroyed" 导致主进程崩溃
  const sendToMain = (channel: string, data: unknown): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };

  // ═══════════════════════════════════════════════════════════
  // 音频事件桥接 —— 把 AudioCaptureManager 事件推到渲染进程
  // ═══════════════════════════════════════════════════════════
  audioCapture.on('captureState', (data: unknown) => {
    sendToMain('audio:state', data);
  });
  audioCapture.on('transcription', (data: unknown) => {
    sendToMain('audio:transcription', data);
  });
  audioCapture.on('llmStart', (data: unknown) => {
    sendToMain('audio:llm-start', data);
    const overlay = getOverlayWindow();
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send('audio:llm-start', data);
  });
  audioCapture.on('llmChunk', (data: unknown) => {
    sendToMain('audio:llm-chunk', data);
    const overlay = getOverlayWindow();
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send('audio:llm-chunk', data);
  });
  audioCapture.on('llmDone', (data: unknown) => {
    sendToMain('audio:llm-done', data);
    const overlay = getOverlayWindow();
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send('audio:llm-done', data);
  });
  audioCapture.on('streamState', (data: unknown) => {
    sendToMain('audio:stream-state', data);
  });
  audioCapture.on('levels', (data: unknown) => {
    sendToMain('audio:levels', data);
  });
  // 采集/推流错误必须上屏：addon 缺失、声卡异常、PCM 转换失败等
  // 否则用户看到"已连接·转录中"却全程无声，无从诊断
  audioCapture.on('error', (data: unknown) => {
    sendToMain('audio:error', data);
  });

  // ── 存储 ──
  ipcMain.handle('storage:get', (_e, key: string) => storage.get(key));
  ipcMain.handle('storage:set', (_e, key: string, value: string) => storage.set(key, value));
  ipcMain.handle('storage:remove', (_e, key: string) => storage.remove(key));

  // ── 窗口管理 ──
  ipcMain.handle('window:open-overlay', () => {
    createOverlayWindow();
  });

  ipcMain.handle('window:close-overlay', () => {
    destroyOverlayWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
  });

  ipcMain.handle('window:toggle-overlay', () => {
    const overlay = getOverlayWindow();
    if (overlay) {
      destroyOverlayWindow();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
    } else {
      createOverlayWindow();
    }
  });

  ipcMain.handle('window:set-always-on-top', (_e, on: boolean) => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      win.setAlwaysOnTop(on);
    }
  });

  // ── ContentProtection 开关 ──
  let contentProtectionOn = false;

  ipcMain.handle('window:toggle-content-protection', () => {
    contentProtectionOn = !contentProtectionOn;
    // 应用到所有窗口
    BrowserWindow.getAllWindows().forEach(w => w.setContentProtection(contentProtectionOn));
    return contentProtectionOn;
  });

  ipcMain.handle('window:get-content-protection', () => {
    return contentProtectionOn;
  });

  // 打开外部链接（macOS BlackHole 安装指引等）
  ipcMain.handle('window:open-external', (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      shell.openExternal(url);
      return { ok: true };
    }
    return { ok: false, error: 'E_URL' };
  });

  // 文件选择与导出
  ipcMain.handle('file:pick', async (_e, extensions?: string[]) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: extensions ? [{ name: 'Files', extensions }] : [],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('file:save', async (_e, data: Uint8Array, defaultName: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return null;
    const result = await dialog.showSaveDialog(win, { defaultPath: defaultName });
    if (result.canceled || !result.filePath) return null;
    fs.writeFileSync(result.filePath, data);
    return result.filePath;
  });

  // ── 音频采集（主进程统一推流：采集 + WS 都在主进程） ──
  let audioSessionId: string | null = null;

  ipcMain.handle('audio:start-capture', async (_e, opts: { source?: string; streamUrl?: string; token?: string; sessionId?: string; systemDeviceId?: string; directAddress?: string }) => {
    if (!opts?.token || !opts?.sessionId) throw new Error('请先登录并保存本场面试');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(opts.sessionId)) throw new Error('无效的面试会话');
    const source = opts.source ?? 'both';
    if (source !== 'mic' && source !== 'system' && source !== 'both') throw new Error('无效的音频来源');
    if (opts.systemDeviceId !== undefined && typeof opts.systemDeviceId !== 'string') throw new Error('无效的系统音频输出设备');
    audioSessionId = opts.sessionId;
    // 主进程直连后端（renderer 的 Vite proxy 只对浏览器生效）
    const streamUrl = opts?.streamUrl || 'ws://127.0.0.1:8010/api/ws/audio/stream';
    console.log(`[audio] start-capture: source=${source}`);
    return audioCapture.start(source, audioSessionId, streamUrl, opts.token, opts.systemDeviceId, opts.directAddress);
  });

  ipcMain.handle('audio:stop-capture', async () => {
    await audioCapture.stop();
    audioSessionId = null;
    return {};
  });

  ipcMain.handle('audio:get-snapshot', async () => {
    return audioCapture.getSnapshot();
  });
  ipcMain.handle('audio:get-permissions', getAudioPermissions);
  ipcMain.handle('audio:list-system-outputs', () => listSystemOutputs());

  ipcMain.handle('audio:clear-answer', () => audioCapture.clearAnswer());

  // 渲染进程控制消息（llm_query / config / track_end 等）直接透传
  ipcMain.handle('audio:send-control', (_e, msg: unknown) => {
    if (msg && typeof msg === 'object') {
      audioCapture.sendControl(msg as object);
      return { ok: true };
    }
    return { ok: false, error: 'E_CONTROL_MESSAGE' };
  });

  // 渲染进程麦克风 PCM16 帧（16kHz mono，AudioContext 已归一化）→ 主进程统一推流
  ipcMain.on('audio:mic-frame', (_e, data: Uint8Array | ArrayBuffer) => {
    audioCapture.pushMicFrame(Buffer.from(data as any));
  });

  // 渲染进程系统音频 PCM16 帧（macOS getDisplayMedia/SCK 采集）→ 主进程统一推流
  ipcMain.on('audio:system-frame', (_e, data: Uint8Array | ArrayBuffer) => {
    audioCapture.pushSystemFrame(Buffer.from(data as any));
  });
}
