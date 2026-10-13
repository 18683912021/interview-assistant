// @vitest-environment jsdom
import {cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import InterviewScreen from './InterviewScreen';
import {ToastProvider} from '../components/Toast';
import {DEFAULT_SETTINGS, getWorkspaceInterview, type WorkspaceSession} from '../api/workspace';
import {streamJSON} from '../api/stream';
vi.mock('../config', () => ({API_BASE: '', MAIN_STREAM_URL: '', STREAM_DIRECT_ADDRESS: ''}));
vi.mock('../api/workspace', async original => {
  const actual = await original<typeof import('../api/workspace')>();
  return {...actual, getJobs: vi.fn().mockResolvedValue([]), getResumes: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue(actual.DEFAULT_SETTINGS), getWorkspaceInterview: vi.fn(),
    saveWorkspaceInterview: vi.fn(async (value: WorkspaceSession) => value)};
});
vi.mock('../services/drafts', () => ({loadDrafts: vi.fn().mockResolvedValue([]), storeDraft: vi.fn(), removeDraft: vi.fn()}));
vi.mock('../api/stream', () => ({streamJSON: vi.fn()}));
const session: WorkspaceSession = {id: 'session', title: '测试面试', role: '后端', company: '', job_description: '',
  resume_id: null, resume_snapshot: null, capture_source: 'mic', status: 'interrupted', started_at: 1, ended_at: null,
  duration_seconds: 0, revision: 1, preferences: DEFAULT_SETTINGS,
  conversation: [{id: 'one', role: 'interviewer', text: '原始问题', revision: 1, timestamp: 1, status: 'done'}],
  answers: [{id: 'answer', request_id: 'request', question_text: '原始问题', source_message_ids: ['one'],
    source_revisions: [1], text: '原答案', status: 'done', context_version: 1, context_snapshot: {...DEFAULT_SETTINGS}, timestamp: 2}]};
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); delete window.electronAPI;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', class {observe() {} unobserve() {} disconnect() {}});
  vi.mocked(getWorkspaceInterview).mockResolvedValue(session);
  vi.mocked(streamJSON).mockImplementation(async (_path, body, receive) => {
    receive({type: 'delta', text: `新答案：${body.question_text}`});
    receive({type: 'done', text: '', status: 'completed'});
  });
});
afterEach(() => {cleanup(); vi.unstubAllGlobals();});
const setup = () => render(<MemoryRouter initialEntries={['/interview?session=session']}><ToastProvider><InterviewScreen /></ToastProvider></MemoryRouter>);
it('edits the question in place and keeps it for regeneration and supplements, without rewriting dialogue', async () => {
  setup();
  await userEvent.click(await screen.findByRole('button', {name: '编辑问题'}));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.change(screen.getByRole('textbox', {name: '编辑本次问题'}), {target: {value: '请解释事务隔离级别'}});
  await userEvent.click(screen.getByRole('button', {name: '重新生成'}));
  await screen.findByText('新答案：请解释事务隔离级别');
  expect(screen.getByText('原始问题')).toBeTruthy();
  expect(screen.getByText('本次问题 · 已编辑')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', {name: '重新回答'}));
  await waitFor(() => expect(streamJSON).toHaveBeenCalledTimes(2));
  await userEvent.click(screen.getByRole('button', {name: '补充一个例子'}));
  await waitFor(() => expect(streamJSON).toHaveBeenCalledTimes(3));
  for (const call of vi.mocked(streamJSON).mock.calls) expect(call[1].question_text).toBe('请解释事务隔离级别');
  expect(vi.mocked(streamJSON).mock.calls[2]![1].context).toMatchObject({supplement_instruction: expect.any(String)});
  // Clicking the original bubble reopens its original answer rather than a paid request for the edited question.
  await userEvent.click(screen.getByText('原始问题'));
  await screen.findByText('原答案');
  expect(streamJSON).toHaveBeenCalledTimes(3);
});
it('completed interview remains read-only', async () => {
  vi.mocked(getWorkspaceInterview).mockResolvedValue({...session, status: 'completed', ended_at: 2});
  setup();
  await screen.findByText('原答案');
  expect(screen.queryByRole('button', {name: '编辑问题'})).toBeNull();
  expect(within(screen.getByRole('region', {name: '本次回答的问题'})).getByText('原始问题')).toBeTruthy();
});
