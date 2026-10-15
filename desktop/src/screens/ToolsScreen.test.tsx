// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import ToolsScreen from './ToolsScreen';
import {ToastProvider} from '../components/Toast';
import {runTool} from '../api/workspace';
vi.mock('../config', () => ({API_BASE: ''}));
vi.mock('../api/workspace', async original => ({...await original<typeof import('../api/workspace')>(),
  getJobs: vi.fn().mockResolvedValue([]), getResumes: vi.fn().mockResolvedValue([]), runTool: vi.fn()}));
beforeEach(() => {vi.clearAllMocks();});
afterEach(cleanup);
async function setup() {
  render(<MemoryRouter><ToastProvider><ToolsScreen /></ToastProvider></MemoryRouter>);
  await userEvent.click(await screen.findByRole('button', {name: /自我介绍 把真实经历/}));
  await waitFor(() => expect((screen.getByRole('button', {name: '生成内容'}) as HTMLButtonElement).disabled).toBe(false));
}
it('keeps validation at the input and switches to the result only for a valid generation', async () => {
  vi.mocked(runTool).mockResolvedValue({text: '生成完成'});
  await setup();
  await userEvent.click(screen.getByRole('button', {name: '生成内容'}));
  expect(screen.getByRole('alert').textContent).toContain('请填写内容');
  expect(runTool).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', {name: /补充内容/})));
  await userEvent.type(screen.getByRole('textbox', {name: /补充内容/}), '真实经历');
  await userEvent.click(screen.getByRole('button', {name: '生成内容'}));
  await screen.findByText('生成完成');
  expect(screen.getByRole('button', {name: '准备稿'}).getAttribute('aria-pressed')).toBe('true');
});
it('stops following when reading earlier text, then resumes explicitly and retains partial output on stop', async () => {
  let receive!: (text: string) => void;
  vi.mocked(runTool).mockImplementation((_kind, _input, onText, signal) => {
    receive = onText;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
  });
  await setup();
  await userEvent.type(screen.getByRole('textbox', {name: /补充内容/}), '真实经历');
  await userEvent.click(screen.getByRole('button', {name: '生成内容'}));
  const output = screen.getByRole('region', {name: '准备稿内容'});
  Object.defineProperties(output, {scrollHeight: {configurable: true, value: 1600}, clientHeight: {configurable: true, value: 400}});
  await act(async () => receive('第一段'));
  expect(output.scrollTop).toBe(1600);
  output.scrollTop = 200; fireEvent.scroll(output);
  await act(async () => receive('第一段\n\n新的内容'));
  expect(output.scrollTop).toBe(200);
  await userEvent.click(screen.getByRole('button', {name: /回到最新内容/}));
  expect(output.scrollTop).toBe(1600);
  await userEvent.click(screen.getByRole('button', {name: '停止生成'}));
  expect((await screen.findByRole('alert')).textContent).toContain('已收到的内容已保留');
  expect(screen.getByText('新的内容')).toBeTruthy();
});
it('does not describe the previous draft as newly received after stopping before the first token', async () => {
  vi.mocked(runTool).mockResolvedValueOnce({text: '上一份准备稿'}).mockImplementationOnce((_kind, _input, _receive, signal) =>
    new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
  await setup();
  await userEvent.type(screen.getByRole('textbox', {name: /补充内容/}), '真实经历');
  await userEvent.click(screen.getByRole('button', {name: '生成内容'}));
  await screen.findByText('上一份准备稿');
  await userEvent.click(screen.getByRole('button', {name: '重新生成'}));
  await userEvent.click(screen.getByRole('button', {name: '停止生成'}));
  expect((await screen.findByRole('alert')).textContent).toContain('尚未收到新内容');
  expect(screen.getByText('上一份准备稿')).toBeTruthy();
});
