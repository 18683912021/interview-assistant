/**
 * Preload script —— contextBridge 暴露 IPC API 给渲染进程
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // 音频控制（采集 + WS 推流都在主进程，渲染进程只发控制与麦克风帧）
  audio: {
    startCapture: (opts: unknown) => ipcRenderer.invoke('audio:start-capture', opts),
    stopCapture: () => ipcRenderer.invoke('audio:stop-capture'),
    getSnapshot: () => ipcRenderer.invoke('audio:get-snapshot'),
    sendControl: (msg: unknown) => ipcRenderer.invoke('audio:send-control', msg),
    sendMicFrame: (frame: Uint8Array) => ipcRenderer.send('audio:mic-frame', frame),
    sendSystemFrame: (frame: Uint8Array) => ipcRenderer.send('audio:system-frame', frame),
    onState: (cb: (data: unknown) => void) => {
      const listener = (_: unknown, data: unknown) => cb(data);
      ipcRenderer.on('audio:state', listener);
      return () => ipcRenderer.removeListener('audio:state', listener);
    },
    onTranscription: (cb: (data: unknown) => void) => {
      const listener = (_: unknown, data: unknown) => cb(data);
      ipcRenderer.on('audio:transcription', listener);
      return () => ipcRenderer.removeListener('audio:transcription', listener);
    },
    onLLMStart: (cb: (data: unknown) => void) => {
      const listener = (_: unknown, data: unknown) => cb(data);
      ipcRenderer.on('audio:llm-start', listener);
      return () => ipcRenderer.removeListener('audio:llm-start', listener);
    },
    onLLMChunk: (cb: (data: unknown) => void) => {
      const listener = (_: unknown, data: unknown) => cb(data);
      ipcRenderer.on('audio:llm-chunk', listener);
      return () => ipcRenderer.removeListener('audio:llm-chunk', listener);
    },
    onLLMDone: (cb: (data: unknown) => void) => {
      const listener = (_: unknown, data: unknown) => cb(data);
      ipcRenderer.on('audio:llm-done', listener);
      return () => ipcRenderer.removeListener('audio:llm-done', listener);
    },
    onStreamState: (cb: (data: unknown) => void) => {
      const listener = (_: unknown, data: unknown) => cb(data);
      ipcRenderer.on('audio:stream-state', listener);
      return () => ipcRenderer.removeListener('audio:stream-state', listener);
    },
    onLevels: (cb: (data: unknown) => void) => {
      const listener = (_: unknown, data: unknown) => cb(data);
      ipcRenderer.on('audio:levels', listener);
      return () => ipcRenderer.removeListener('audio:levels', listener);
    },
    onError: (cb: (data: unknown) => void) => {
      const listener = (_: unknown, data: unknown) => cb(data);
      ipcRenderer.on('audio:error', listener);
      return () => ipcRenderer.removeListener('audio:error', listener);
    },
  },

  // 文件转换
  fileConvert: {
    getLibreOfficeStatus: () => ipcRenderer.invoke('file:libreoffice-status'),
    downloadLibreOffice: (resume?: boolean) => ipcRenderer.invoke('file:download-libreoffice', resume ?? false),
    pauseDownload: () => ipcRenderer.invoke('file:pause-download'),
    checkPartialDownload: () => ipcRenderer.invoke('file:check-partial-download'),
    cleanupDownload: () => ipcRenderer.invoke('file:cleanup-download'),
    openDownloadPage: () => ipcRenderer.invoke('file:open-download-page'),
    installFromLocal: (localPath: string) => ipcRenderer.invoke('file:install-local', localPath),
    onDownloadProgress: (cb: (data: { progress: number; stage: string; error?: string }) => void) => {
      const listener = (_: unknown, data: any) => cb(data);
      ipcRenderer.on('file:download-progress', listener);
      return () => ipcRenderer.removeListener('file:download-progress', listener);
    },
    writeTemp: (data: Uint8Array, suffix: string) => ipcRenderer.invoke('file:write-temp', data, suffix),
    readBase64: (filePath: string) => ipcRenderer.invoke('file:read-base64', filePath),
    convert: (inputPath: string, format: string) => ipcRenderer.invoke('file:convert', inputPath, format),
    pickFile: (extensions?: string[]) => ipcRenderer.invoke('file:pick', extensions),
    saveOutput: (sourcePath: string) => ipcRenderer.invoke('file:save-output', sourcePath),
    saveFile: (data: Uint8Array, defaultName: string) => ipcRenderer.invoke('file:save', data, defaultName),
  },

  // 窗口管理
  window: {
    openOverlay: () => ipcRenderer.invoke('window:open-overlay'),
    closeOverlay: () => ipcRenderer.invoke('window:close-overlay'),
    toggleOverlay: () => ipcRenderer.invoke('window:toggle-overlay'),
    setAlwaysOnTop: (on: boolean) => ipcRenderer.invoke('window:set-always-on-top', on),
    toggleContentProtection: () => ipcRenderer.invoke('window:toggle-content-protection'),
    getContentProtection: () => ipcRenderer.invoke('window:get-content-protection'),
    openExternal: (url: string) => ipcRenderer.invoke('window:open-external', url),
  },

  // 存储（IPC → 主进程文件系统）
  storage: {
    get: (key: string) => ipcRenderer.invoke('storage:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('storage:set', key, value),
    remove: (key: string) => ipcRenderer.invoke('storage:remove', key),
  },
});
