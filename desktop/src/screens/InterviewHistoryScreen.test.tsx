// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {MemoryRouter, Route, Routes, useNavigate} from 'react-router-dom';
import InterviewHistoryScreen from './InterviewHistoryScreen';
import {ToastProvider} from '../components/Toast';
import {WorkspaceDraftProvider} from '../utils/WorkspaceDraftContext';
import {getInterviewPage} from '../api/workspace';
vi.mock('../config', () => ({API_BASE: ''}));
vi.mock('../api/workspace', async original => ({...await original<typeof import('../api/workspace')>(),
  getInterviewPage: vi.fn(), getInterviewRevisions: vi.fn().mockResolvedValue({})}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getInterviewPage).mockImplementation(async (page, query) => ({page, size: 30, total: query ? 1 : 60,
    items: [{id: `session-${page}`, title: `第${page}页面试`, role: '工程师', company: '测试', status: 'completed',
      started_at: 1792022400000, ended_at: 1792022460000, duration_seconds: 60,
      job_description: '', resume_id: null, resume_snapshot: null, preferences: {language: 'zh', answer_length: 'detailed', answer_style: 'written'},
      message_count: 2, answer_count: 1, revision: 1}]}));
});
afterEach(cleanup);
function Detail() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/history')}>返回列表</button>;
}
function setup() {
  render(<MemoryRouter initialEntries={['/history']}><WorkspaceDraftProvider><ToastProvider><Routes>
    <Route path="/history" element={<InterviewHistoryScreen />} /><Route path="/history/:id" element={<Detail />} />
  </Routes></ToastProvider></WorkspaceDraftProvider></MemoryRouter>);
}
it('returns from details to the same page and scroll position', async () => {
  setup();
  await screen.findByText('第1页面试');
  await userEvent.click(screen.getByRole('button', {name: '下一页'}));
  const record = await screen.findByText('第2页面试');
  const viewport = screen.getByRole('region', {name: '面试记录列表'});
  viewport.scrollTop = 180;
  fireEvent.scroll(viewport);
  await userEvent.click(record);
  await userEvent.click(screen.getByRole('button', {name: '返回列表'}));
  await screen.findByText('第2页面试');
  expect(getInterviewPage).toHaveBeenLastCalledWith(2, '', 'all');
  expect(screen.getByRole('region', {name: '面试记录列表'}).scrollTop).toBe(180);
});
it('search and clearing search both reset the page and list position', async () => {
  setup();
  await screen.findByText('第1页面试');
  await userEvent.click(screen.getByRole('button', {name: '下一页'}));
  await screen.findByText('第2页面试');
  const viewport = screen.getByRole('region', {name: '面试记录列表'});
  viewport.scrollTop = 220;
  fireEvent.scroll(viewport);
  fireEvent.change(screen.getByRole('textbox', {name: '搜索面试记录'}), {target: {value: '前端'}});
  expect(viewport.scrollTop).toBe(0);
  expect(screen.queryByText('第2页面试')).toBeNull();
  await waitFor(() => expect(getInterviewPage).toHaveBeenLastCalledWith(1, '前端', 'all'));
  await userEvent.click(screen.getByRole('button', {name: '清空搜索'}));
  await waitFor(() => expect(getInterviewPage).toHaveBeenLastCalledWith(1, '', 'all'));
});
it('ignores an older request completing after a new search', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof getInterviewPage>>) => void;
  vi.mocked(getInterviewPage).mockImplementationOnce(() => new Promise(done => {resolve = done;}));
  setup();
  await waitFor(() => expect(getInterviewPage).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByRole('textbox', {name: '搜索面试记录'}), {target: {value: '最新'}});
  await screen.findByText('第1页面试');
  await act(async () => resolve({page: 1, size: 30, total: 999, items: []}));
  expect(screen.getByText('第1页面试')).toBeTruthy();
  expect(screen.queryByText('999 场')).toBeNull();
});
