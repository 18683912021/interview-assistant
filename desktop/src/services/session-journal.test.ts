import {describe, expect, it, vi} from 'vitest';
import {SessionJournal} from './session-journal';
import type {WorkspaceSession} from '../api/workspace';
const session: WorkspaceSession = {
  id: 'session',
  title: '测试',
  role: '后端',
  company: '',
  job_description: '',
  resume_id: null,
  resume_snapshot: null,
  status: 'active',
  started_at: 1,
  ended_at: null,
  duration_seconds: 0,
  conversation: [],
  answers: [],
  preferences: {language: 'zh', answer_length: 'brief', answer_style: 'conversational'},
  revision: 1,
};
describe('continuous interview journal', () => {
  it('persists the last shutdown draft without waiting for network access', async () => {
    const local = vi.fn().mockResolvedValue(undefined), remote = vi.fn();
    const journal = new SessionJournal(1, local, remote, () => {}, 60000);
    journal.push({...session, status: 'interrupted', duration_seconds: 75});
    await journal.flushLocal();
    expect(local).toHaveBeenCalledWith(expect.objectContaining({status: 'interrupted', duration_seconds: 75, revision: 2}));
    expect(remote).not.toHaveBeenCalled();
    journal.dispose();
  });
  it('uploads unchanged recovered content before newer edits without changing the lost-response revision', async () => {
    const remote = vi.fn().mockResolvedValue({});
    const journal = new SessionJournal(
      7,
      async () => {},
      remote,
      () => {},
      60000,
      3,
    );
    journal.recover({...session, revision: 7, status: 'completed', sync_base_revision: 3});
    await journal.flush();
    expect(remote.mock.calls.map(call => [call[0].revision, call[1]])).toEqual([[7, 3]]);
    journal.dispose();

    const changed = new SessionJournal(
      7,
      async () => {},
      remote,
      () => {},
      60000,
      3,
    );
    changed.recover({...session, revision: 7, sync_base_revision: 3});
    changed.push({...session, duration_seconds: 30});
    await changed.flush();
    expect(remote.mock.calls.slice(1).map(call => [call[0].revision, call[1]])).toEqual([
      [7, 3],
      [8, 7],
    ]);
    changed.dispose();
  });
  it('serializes slow writes and sends the newest queued snapshot using the acknowledged base revision', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => (release = resolve));
    const remote = vi
      .fn()
      .mockImplementationOnce(() => pending)
      .mockResolvedValue({});
    const local = vi.fn().mockResolvedValue(undefined);
    const journal = new SessionJournal(1, local, remote, () => {}, 60000);
    journal.push(session);
    const flushing = journal.flush();
    await vi.waitFor(() => expect(remote).toHaveBeenCalledTimes(1));
    journal.push({...session, duration_seconds: 10});
    journal.push({...session, duration_seconds: 20});
    release();
    await flushing;
    expect(remote).toHaveBeenCalledTimes(2);
    expect(remote.mock.calls[0]?.[1]).toBe(1);
    expect(remote.mock.calls[1]?.[1]).toBe(2);
    expect(remote.mock.calls[1]?.[0]).toMatchObject({duration_seconds: 20, revision: 4});
    expect(local.mock.calls.at(-1)?.[0]).toMatchObject({revision: 4, sync_base_revision: 4});
    journal.dispose();
  });
  it('keeps the same failed snapshot for idempotent retry and persists local recovery before uploading', async () => {
    const order: string[] = [];
    const local = vi.fn(async () => {
      order.push('local');
    });
    const remote = vi
      .fn()
      .mockImplementationOnce(async () => {
        order.push('remote');
        throw new Error('offline');
      })
      .mockResolvedValue({});
    const state = vi.fn();
    const journal = new SessionJournal(1, local, remote, state, 60000);
    journal.push(session);
    await expect(journal.flush()).rejects.toThrow('offline');
    expect(order.slice(0, 2)).toEqual(['local', 'remote']);
    expect(state).toHaveBeenCalledWith('offline', expect.any(Error));
    await journal.flush();
    expect(remote.mock.calls[0]?.[0]).toEqual(remote.mock.calls[1]?.[0]);
    expect(remote.mock.calls[1]?.[1]).toBe(1);
    journal.dispose();
  });
  it('retries the unacknowledged write before newer text when the server response was lost', async () => {
    let reject!: (reason: Error) => void;
    const pending = new Promise<void>((_, fail) => (reject = fail));
    const remote = vi
      .fn()
      .mockImplementationOnce(() => pending)
      .mockResolvedValue({});
    const journal = new SessionJournal(
      1,
      async () => {},
      remote,
      () => {},
      60000,
    );
    journal.push(session);
    const first = journal.flush();
    await vi.waitFor(() => expect(remote).toHaveBeenCalledTimes(1));
    journal.push({...session, duration_seconds: 9});
    reject(new Error('response lost'));
    await expect(first).rejects.toThrow('response lost');
    await journal.flush();
    expect(remote.mock.calls.map(call => [call[0].revision, call[1]])).toEqual([
      [2, 1],
      [2, 1],
      [3, 2],
    ]);
    journal.dispose();
  });
  it('restores an offline draft against its last known server revision instead of its locally incremented revision', async () => {
    const remote = vi.fn().mockResolvedValue({});
    const journal = new SessionJournal(
      20,
      async () => {},
      remote,
      () => {},
      60000,
      3,
    );
    journal.push({...session, revision: 20});
    await journal.flush();
    expect(remote.mock.calls[0]?.[1]).toBe(3);
    expect(remote.mock.calls[0]?.[0].revision).toBe(21);
    journal.dispose();
  });
});
