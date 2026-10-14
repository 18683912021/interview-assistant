/**
 * Preload script —— contextBridge 暴露 IPC API 给渲染进程
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  screenshot: {
    recognize: (id: string) => ipcRenderer.invoke('screenshot:recognize', id),
    cancel: (id: string) => ipcRenderer.invoke('screenshot:cancel', id),
    onProgress: (cb: (value: {id: string; stage: string; percent?: number}) => void) => {
      const listener = (_event: unknown, value: Parameters<typeof cb>[0]) => cb(value);
      ipcRenderer.on('screenshot:progress', listener);
      return () => ipcRenderer.removeListener('screenshot:progress', listener);
    },
  },
  // 音频控制（采集 + WS 推流都在主进程，渲染进程只发控制与麦克风帧）
  audio: {
    startCapture: (opts: unknown) => ipcRenderer.invoke('audio:start-capture', opts),
    stopCapture: () => ipcRenderer.invoke('audio:stop-capture'),
    getSnapshot: () => ipcRenderer.invoke('audio:get-snapshot'),
    cancelSystemAudioCheck: () => ipcRenderer.invoke('audio:cancel-system-audio-check'),
    checkSystemAudio: () => ipcRenderer.invoke('audio:check-system-audio'),
    getPermissions: () => ipcRenderer.invoke('audio:get-permissions'),
    takeDisplayCaptureFailure: () => ipcRenderer.invoke('audio:display-capture-failure'),
    openPrivacySettings: (kind: 'microphone' | 'screen') => ipcRenderer.invoke('audio:open-privacy-settings', kind),
    requestPermission: (kind: 'microphone' | 'screen') => ipcRenderer.invoke('audio:request-permission', kind),
    repairScreenPermission: () => ipcRenderer.invoke('audio:repair-screen-permission'),
    listSystemOutputs: () => ipcRenderer.invoke('audio:list-system-outputs'),
    clearAnswer: () => ipcRenderer.invoke('audio:clear-answer'),
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

  files: {
    pickFile: (extensions?: string[]) => ipcRenderer.invoke('file:pick', extensions),
    saveFile: (data: Uint8Array, defaultName: string) => ipcRenderer.invoke('file:save', data, defaultName),
  },

  // 窗口管理
  window: {
    getMode: () => ipcRenderer.invoke('window:get-mode'),
    setCompact: (on: boolean) => ipcRenderer.invoke('window:set-compact', on),
    onModeChanged: (callback: (mode: {compact: boolean; pinned: boolean; alwaysOnTop: boolean}) => void) => {
      const listener = (_event: unknown, mode: Parameters<typeof callback>[0]) => callback(mode);
      ipcRenderer.on('window:mode-changed', listener);
      return () => ipcRenderer.removeListener('window:mode-changed', listener);
    },
    quitApp: () => ipcRenderer.invoke('window:quit-app'),
    hideAll: () => ipcRenderer.invoke('window:hide-all'),
    getPrivacy: () => ipcRenderer.invoke('window:get-privacy'),
    onPrepareQuit: (callback: () => Promise<void>) => {
      const listener = (_event: unknown, request: string) => {
        void callback().then(() => ipcRenderer.send('window:quit-ready', request, true))
          .catch(() => ipcRenderer.send('window:quit-ready', request, false));
      };
      ipcRenderer.on('window:prepare-quit', listener);
      return () => ipcRenderer.removeListener('window:prepare-quit', listener);
    },
    onQuitCancelled: (callback: () => void) => {
      ipcRenderer.on('window:quit-cancelled', callback);
      return () => ipcRenderer.removeListener('window:quit-cancelled', callback);
    },
    restartApp: () => ipcRenderer.invoke('window:restart-app'),
    openOverlay: () => ipcRenderer.invoke('window:open-overlay'),
    closeOverlay: () => ipcRenderer.invoke('window:close-overlay'),
    toggleOverlay: () => ipcRenderer.invoke('window:toggle-overlay'),
    setAlwaysOnTop: (on: boolean) => ipcRenderer.invoke('window:set-always-on-top', on),
    openExternal: (url: string) => ipcRenderer.invoke('window:open-external', url),
  },

  // 存储（IPC → 主进程文件系统）
  storage: {
    get: (key: string) => ipcRenderer.invoke('storage:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('storage:set', key, value),
    remove: (key: string) => ipcRenderer.invoke('storage:remove', key),
  },
});
