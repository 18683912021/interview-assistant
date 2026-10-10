import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopStorage } from '../storage';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

let directory: string;
let storage: DesktopStorage;
const preferences = () => path.join(directory, 'preferences.json');
const draftFile = (key: string) => path.join(directory, 'workspace-drafts', `${createHash('sha256').update(key).digest('hex')}.json`);

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'interview-storage-'));
  storage = new DesktopStorage(directory);
});
afterEach(async () => {
  vi.mocked(rename).mockClear();
  await rm(directory, { recursive: true, force: true });
});

describe('desktop draft persistence', () => {
  it('reads old values and migrates only successfully updated draft keys, including the index', async () => {
    const draft = 'workspace-draft:person:index-1';
    const index = 'workspace-draft:person:index';
    const other = 'workspace-draft:person:index-2';
    await writeFile(preferences(), JSON.stringify({ theme: 'light', [draft]: 'old', [index]: '["index-1"]', [other]: 'untouched' }));
    expect(await storage.get(draft)).toBe('old');
    await storage.set(draft, '{"text":"new answer"}');
    await storage.set(index, '["index-1","index-2"]');
    expect(await storage.get(draft)).toBe('{"text":"new answer"}');
    expect(JSON.parse(await readFile(draftFile(draft), 'utf8'))).toBe('{"text":"new answer"}');
    expect(JSON.parse(await readFile(preferences(), 'utf8'))).toEqual({ theme: 'light', [other]: 'untouched' });
    expect(await storage.get(index)).toBe('["index-1","index-2"]');
    expect(await storage.get(other)).toBe('untouched');
  });

  it('isolates keys and serializes concurrent writes without accepting path traversal', async () => {
    const first = 'workspace-draft:a:../../../../escaped';
    const second = 'workspace-draft:b:../../../../escaped';
    await Promise.all([
      storage.set(first, 'first'), storage.set(second, 'other person'), storage.set(first, 'latest'),
      storage.set('theme', 'dark'), storage.set('language', 'zh'), storage.set('__proto__', 'plain value'),
    ]);
    expect(await storage.get(first)).toBe('latest');
    expect(await storage.get(second)).toBe('other person');
    expect(await storage.get('theme')).toBe('dark');
    expect(await storage.get('language')).toBe('zh');
    expect(await storage.get('__proto__')).toBe('plain value');
    expect(await storage.get('constructor')).toBeNull();
    expect((await readdir(path.join(directory, 'workspace-drafts'))).every(file => /^[a-f0-9]{64}\.json$/.test(file))).toBe(true);
    expect((await readdir(directory)).sort()).toEqual(['preferences.json', 'workspace-drafts']);
  });

  it('falls back from a corrupt single draft without damaging other drafts', async () => {
    const broken = 'workspace-draft:person:broken';
    const healthy = 'workspace-draft:person:healthy';
    await storage.set(healthy, 'healthy');
    await writeFile(preferences(), JSON.stringify({ [broken]: 'legacy recovery', theme: 'dark' }));
    await writeFile(draftFile(broken), '{incomplete');
    expect(await storage.get(broken)).toBe('legacy recovery');
    expect(await storage.get(healthy)).toBe('healthy');
    await storage.set(broken, 'recovered');
    expect(await storage.get(broken)).toBe('recovered');
    expect(await storage.get(healthy)).toBe('healthy');
    expect(JSON.parse(await readFile(preferences(), 'utf8'))).toEqual({ theme: 'dark' });
  });

  it('preserves a broken shared preferences file while allowing isolated draft saves', async () => {
    const corrupt = '{"token":"unfinished';
    await writeFile(preferences(), corrupt);
    expect(await storage.get('theme')).toBeNull();
    await expect(storage.set('theme', 'dark')).rejects.toThrow('未覆盖');
    await expect(storage.remove('theme')).rejects.toThrow('未覆盖');
    await storage.set('workspace-draft:person:one', 'saved separately');
    expect(await storage.get('workspace-draft:person:one')).toBe('saved separately');
    expect(await readFile(preferences(), 'utf8')).toBe(corrupt);
  });

  it('retains the old complete file and removes temporary files when replacement fails', async () => {
    const key = 'workspace-draft:person:one';
    await storage.set(key, 'last complete version');
    vi.mocked(rename).mockRejectedValueOnce(new Error('simulated rename failure'));
    await expect(storage.set(key, 'uncommitted update')).rejects.toThrow('rename failure');
    expect(await storage.get(key)).toBe('last complete version');
    expect(await readdir(path.join(directory, 'workspace-drafts'))).toHaveLength(1);
    await storage.set(key, 'retry succeeds');
    expect(await storage.get(key)).toBe('retry succeeds');
  });

  it('deletes both legacy and isolated copies without resurrecting a draft', async () => {
    const key = 'workspace-draft:person:one';
    const neighbor = 'workspace-draft:person:two';
    await mkdir(path.join(directory, 'workspace-drafts'));
    await writeFile(draftFile(key), JSON.stringify('isolated'));
    await writeFile(preferences(), JSON.stringify({ [key]: 'legacy', theme: 'light' }));
    await storage.set(neighbor, 'keep');
    await storage.remove(key);
    await storage.remove(key);
    expect(await storage.get(key)).toBeNull();
    expect(await storage.get(neighbor)).toBe('keep');
    expect(JSON.parse(await readFile(preferences(), 'utf8'))).toEqual({ theme: 'light' });
    await storage.remove('theme');
    expect(await storage.get('theme')).toBeNull();
  });

  it('waits for an in-flight atomic replacement before allowing shutdown', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(rename).mockImplementationOnce(async (from, to) => {
      await blocked;
      await actual.rename(from, to);
    });
    const saving = storage.set('workspace-draft:person:last', 'final snapshot');
    let drained = false;
    const draining = storage.flush().then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);
    release();
    await Promise.all([saving, draining]);
    expect(drained).toBe(true);
    expect(await storage.get('workspace-draft:person:last')).toBe('final snapshot');
  });
});
