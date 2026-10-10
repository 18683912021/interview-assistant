import {beforeEach, describe, expect, it, vi} from 'vitest';
const data = vi.hoisted(() => new Map<string, string>());
vi.mock('../platform/storage', () => ({
  storage: {
    get: async (key: string) => data.get(key) ?? null,
    set: async (key: string, value: string) => {
      await Promise.resolve();
      data.set(key, value);
    },
    remove: async (key: string) => {
      data.delete(key);
    },
  },
}));
import {loadDrafts, removeDraft, storeDraft} from './drafts';
import type {WorkspaceSession} from '../api/workspace';
const draft = (id: string) =>
  ({
    id,
    title: id,
    revision: 2,
    started_at: 1,
    conversation: [],
    answers: [],
    preferences: {},
  }) as unknown as WorkspaceSession;
describe('local draft recovery', () => {
  beforeEach(() => data.clear());
  it('keeps every index entry across overlapping saves and removes', async () => {
    await Promise.all([storeDraft('user', draft('a')), storeDraft('user', draft('b'))]);
    expect((await loadDrafts('user')).map(value => value.id)).toEqual(['a', 'b']);
    await Promise.all([removeDraft('user', 'a'), storeDraft('user', draft('c'))]);
    expect((await loadDrafts('user')).map(value => value.id)).toEqual(['b', 'c']);
  });
  it('recovers good drafts even if another file is damaged without deleting the original', async () => {
    await storeDraft('user', draft('good'));
    data.set('workspace-draft:user:bad', '{broken');
    data.set('workspace-draft:user:index', '["good","bad"]');
    const warning = vi.fn();
    expect((await loadDrafts('user', warning)).map(value => value.id)).toEqual(['good']);
    expect(warning).toHaveBeenCalledWith(1);
    expect(data.get('workspace-draft:user:bad')).toBe('{broken');
  });
});
