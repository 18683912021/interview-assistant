/**
 * 存储平台适配层
 *
 * 自动检测运行环境：Electron → IPC 文件系统，Web → localStorage
 */

export interface StorageAPI {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electronAPI;
}

function createStorage(): StorageAPI {
  if (isElectron()) {
    const api = (window as any).electronAPI.storage;
    return {
      get: (key: string) => api.get(key),
      set: (key: string, value: string) => api.set(key, value),
      remove: (key: string) => api.remove(key),
    };
  }

  // Web fallback
  return {
    get: async (key: string) => localStorage.getItem(key),
    set: async (key: string, value: string) => { localStorage.setItem(key, value); },
    remove: async (key: string) => { localStorage.removeItem(key); },
  };
}

export const storage: StorageAPI = createStorage();
