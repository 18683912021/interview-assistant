import {storage} from '../platform/storage';
import type {WorkspaceSession} from '../api/workspace';
const prefix = (email: string) => `workspace-draft:${encodeURIComponent(email)}:`;
const writes = new Map<string, Promise<void>>();
const readIds = (value: string | null): string[] => {
  const ids: unknown = JSON.parse(value || '[]');
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string'))
    throw new Error('本机草稿索引损坏，原文件已保留');
  return [...new Set(ids)] as string[];
};
function mutate(email: string, action: () => Promise<void>) {
  const previous = writes.get(email) || Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  writes.set(email, next);
  void next
    .finally(() => {
      if (writes.get(email) === next) writes.delete(email);
    })
    .catch(() => {});
  return next;
}
export async function loadDrafts(
  email: string,
  onUnreadable?: (count: number) => void,
): Promise<WorkspaceSession[]> {
  await writes.get(email)?.catch(() => {});
  const ids = readIds(await storage.get(`${prefix(email)}index`));
  const values = await Promise.all(ids.map(id => storage.get(`${prefix(email)}${id}`)));
  let unreadable = 0;
  const drafts = values.flatMap((value, index): WorkspaceSession[] => {
    try {
      if (!value) throw new Error('missing');
      const snapshot = JSON.parse(value) as WorkspaceSession;
      if (
        snapshot.id !== ids[index] ||
        typeof snapshot.title !== 'string' ||
        !Number.isFinite(snapshot.started_at) ||
        !Number.isInteger(snapshot.revision) ||
        !Array.isArray(snapshot.conversation) ||
        !Array.isArray(snapshot.answers) ||
        !snapshot.preferences
      )
        throw new Error('invalid');
      return [snapshot];
    } catch {
      unreadable++;
      return [];
    }
  });
  if (unreadable) onUnreadable?.(unreadable);
  return drafts.sort((a, b) => b.started_at - a.started_at);
}
export function storeDraft(email: string, snapshot: WorkspaceSession) {
  return mutate(email, async () => {
    const key = `${prefix(email)}index`;
    const ids = readIds(await storage.get(key));
    await storage.set(`${prefix(email)}${snapshot.id}`, JSON.stringify(snapshot));
    if (!ids.includes(snapshot.id)) await storage.set(key, JSON.stringify([...ids, snapshot.id]));
  });
}
export function removeDraft(email: string, id: string) {
  return mutate(email, async () => {
    const key = `${prefix(email)}index`;
    const ids = readIds(await storage.get(key));
    await storage.set(key, JSON.stringify(ids.filter(value => value !== id)));
    await storage.remove(`${prefix(email)}${id}`);
  });
}
