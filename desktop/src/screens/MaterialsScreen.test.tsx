// @vitest-environment jsdom
import {cleanup, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import MaterialsScreen from './MaterialsScreen';
import {ToastProvider} from '../components/Toast';
import {createResume, deleteResumeVersion, getResumes} from '../api/workspace';
vi.mock('../config', () => ({API_BASE: ''}));
vi.mock('../api/workspace', async original => ({...await original<typeof import('../api/workspace')>(),
  createResume: vi.fn(), getResumes: vi.fn(), getJobs: vi.fn().mockResolvedValue([]), deleteResumeVersion: vi.fn()}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class {observe() {} unobserve() {} disconnect() {}});
  vi.mocked(getResumes).mockResolvedValue([2, 1].map(version => ({id: `resume-${version}`, version,
    filename: '我的经历', text: `内容 ${version}`, created_at: '2026-10-13T00:00:00Z', kind: 'experience'})));
});
afterEach(() => {cleanup(); vi.unstubAllGlobals();});
function setup() {render(<MemoryRouter><ToastProvider><MaterialsScreen /></ToastProvider></MemoryRouter>);}
it('requires confirmation and promotes the older version when the latest is deleted', async () => {
  vi.mocked(deleteResumeVersion).mockResolvedValue({ok: true});
  setup();
  await userEvent.click(await screen.findByRole('button', {name: '删除'}));
  expect(deleteResumeVersion).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog', {name: '删除资料版本？'});
  expect(dialog.textContent).toContain('面试记录中已保存的资料快照仍会保留');
  await userEvent.click(within(dialog).getByRole('button', {name: '取消'}));
  expect(deleteResumeVersion).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', {name: '删除'}));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name: '删除'}));
  await screen.findByText('资料版本已删除');
  expect(deleteResumeVersion).toHaveBeenCalledWith('resume-2');
  expect(screen.queryByText('内容 2')).toBeNull();
  expect(screen.getByText('内容 1')).toBeTruthy();
});
it('older versions are removable and a failed request keeps both versions available', async () => {
  vi.mocked(deleteResumeVersion).mockRejectedValue(new Error('网络暂时不可用'));
  setup();
  await userEvent.click(await screen.findByText('查看 1 个同名旧版本'));
  await userEvent.click(screen.getByRole('button', {name: '删除 我的经历 v1'}));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name: '删除'}));
  expect((await screen.findByRole('alert')).textContent).toContain('网络暂时不可用');
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name: '取消'}));
  expect(screen.getByText('内容 2')).toBeTruthy();
  expect(screen.getByRole('button', {name: '删除 我的经历 v1'})).toBeTruthy();
});

it('submits a long editor from its fixed footer and keeps field validation inside the editor', async () => {
  vi.mocked(createResume).mockResolvedValue({id: 'new', version: 1, filename: '个人简历', text: '真实项目经历', kind: 'resume', created_at: '2026-10-15T00:00:00Z'});
  setup();
  await userEvent.click(await screen.findByRole('button', {name: '粘贴简历'}));
  const dialog = screen.getByRole('dialog', {name: '保存资料版本'});
  await userEvent.click(within(dialog).getByRole('button', {name: '保存'}));
  expect(createResume).not.toHaveBeenCalled();
  expect(within(dialog).getByRole('alert').textContent).toContain('请填写简历正文');
  await userEvent.type(within(dialog).getByRole('textbox', {name: /简历正文/}), '真实项目经历');
  await userEvent.click(within(dialog).getByRole('button', {name: '保存'}));
  await screen.findByText('真实项目经历');
  expect(createResume).toHaveBeenCalledWith('真实项目经历', '个人简历', 'resume');
  expect(screen.queryByRole('dialog')).toBeNull();
});
