import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

class CorruptPreferencesError extends Error {
  constructor() { super('本地偏好文件损坏，已保留原文件，未覆盖其他设置'); }
}

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

/** Write beside the destination so rename never crosses filesystems. */
async function atomicWrite(file: string, contents: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

/** Async storage for IPC. Draft writes never rewrite unrelated interview data. */
export class DesktopStorage {
  private readonly preferencesPath: string;
  private readonly draftDirectory: string;
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly migrated = new Set<string>();

  constructor(userData: string) {
    this.preferencesPath = path.join(userData, 'preferences.json');
    this.draftDirectory = path.join(userData, 'workspace-drafts');
  }

  async flush(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending.values()]);
  }

  private validateKey(key: string): void {
    if (typeof key !== 'string' || !key.length || key.length > 8192) throw new Error('无效的本地存储键');
  }

  private draftPath(key: string): string {
    return path.join(this.draftDirectory, `${createHash('sha256').update(key).digest('hex')}.json`);
  }

  private serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key) ?? Promise.resolve();
    const running = previous.catch(() => {}).then(work);
    this.pending.set(key, running);
    const clear = () => { if (this.pending.get(key) === running) this.pending.delete(key); };
    void running.then(clear, clear);
    return running;
  }

  private async preferences(): Promise<Record<string, string>> {
    let raw: string;
    try { raw = await readFile(this.preferencesPath, 'utf8'); }
    catch (error) { if (isMissing(error)) return {}; throw error; }
    let data: unknown;
    try { data = JSON.parse(raw); } catch { throw new CorruptPreferencesError(); }
    if (!data || Array.isArray(data) || typeof data !== 'object' ||
        Object.values(data).some(value => typeof value !== 'string')) throw new CorruptPreferencesError();
    return data as Record<string, string>;
  }

  private legacyValue(key: string): Promise<string | null> {
    return this.serialize('preferences', async () => {
      try {
        const values = await this.preferences();
        return Object.hasOwn(values, key) ? values[key] ?? null : null;
      } catch (error) {
        if (error instanceof CorruptPreferencesError) return null;
        throw error;
      }
    });
  }

  private removeLegacyDraft(key: string): Promise<void> {
    return this.serialize('preferences', async () => {
      let values: Record<string, string>;
      try { values = await this.preferences(); }
      catch (error) {
        // A broken shared file must not prevent an isolated draft being saved.
        // Leave it intact for recovery instead of replacing it with an empty map.
        if (error instanceof CorruptPreferencesError) return;
        throw error;
      }
      if (!Object.hasOwn(values, key)) return;
      delete values[key];
      await atomicWrite(this.preferencesPath, JSON.stringify(values));
    });
  }

  async get(key: string): Promise<string | null> {
    this.validateKey(key);
    if (!key.startsWith('workspace-draft:')) return this.legacyValue(key);
    return this.serialize(this.draftPath(key), async () => {
      try {
        const value: unknown = JSON.parse(await readFile(this.draftPath(key), 'utf8'));
        if (typeof value === 'string') return value;
      } catch (error) {
        if (!(error instanceof SyntaxError) && !isMissing(error)) throw error;
      }
      // Old installations kept drafts inside preferences.json.
      return this.legacyValue(key);
    });
  }

  async set(key: string, value: string): Promise<void> {
    this.validateKey(key);
    if (typeof value !== 'string') throw new Error('本地存储值必须为字符串');
    if (!key.startsWith('workspace-draft:')) {
      return this.serialize('preferences', async () => {
        const values = await this.preferences();
        await atomicWrite(this.preferencesPath, JSON.stringify({ ...values, [key]: value }));
      });
    }
    return this.serialize(this.draftPath(key), async () => {
      await atomicWrite(this.draftPath(key), JSON.stringify(value));
      if (!this.migrated.has(key)) {
        // Only remove the legacy copy after the new file is safely in place.
        await this.removeLegacyDraft(key);
        this.migrated.add(key);
      }
    });
  }

  async remove(key: string): Promise<void> {
    this.validateKey(key);
    if (!key.startsWith('workspace-draft:')) {
      return this.serialize('preferences', async () => {
        const values = await this.preferences();
        if (!Object.hasOwn(values, key)) return;
        delete values[key];
        await atomicWrite(this.preferencesPath, JSON.stringify(values));
      });
    }
    return this.serialize(this.draftPath(key), async () => {
      // Remove the fallback first, so a crash cannot resurrect the legacy draft.
      await this.removeLegacyDraft(key);
      try { await unlink(this.draftPath(key)); }
      catch (error) { if (!isMissing(error)) throw error; }
      this.migrated.delete(key);
    });
  }
}
