// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {AnswerQuestion} from './AnswerQuestion';
import {ScreenshotQuestion} from './ScreenshotQuestion';

type ElectronAPI = NonNullable<Window['electronAPI']>;
type Result = Awaited<ReturnType<ElectronAPI['screenshot']['recognize']>>;
let pending: ((result: Result) => void)[];
let progress: (value: {id: string; stage: string; percent?: number}) => void;
const recognize = vi.fn(), cancel = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  pending = []; vi.clearAllMocks();
  recognize.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  window.electronAPI = {screenshot: {recognize, cancel, onProgress: vi.fn(cb => {progress = cb; return vi.fn();})},
    audio: {openPrivacySettings: vi.fn().mockResolvedValue(undefined)}} as unknown as ElectronAPI;
});
afterEach(() => {cleanup(); delete window.electronAPI;});
it('fills an editable question without sending it, supports correction and repeated screenshots', async () => {
  const generate = vi.fn(() => true);
  render(<AnswerQuestion question="原题" editable generating onGenerate={generate} />);
  await userEvent.click(screen.getByRole('button', {name: '截图识别'}));
  const id = recognize.mock.calls[0]![0];
  act(() => progress({id, stage: 'recognizing', percent: 70}));
  expect(screen.getByRole('status').textContent).toContain('70%');
  await act(async () => pending[0]!({status: 'success', text: '截图题目', confidence: 90, durationMs: 800}));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('截图题目');
  expect(document.activeElement).toBe(screen.getByRole('textbox'));
  expect(generate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox'), {target: {value: '修正代码符号后的问题'}});
  await userEvent.click(screen.getByRole('button', {name: '截图识别'}));
  await act(async () => pending[1]!({status: 'cancelled'}));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('修正代码符号后的问题');
  await userEvent.click(screen.getByRole('button', {name: '重新生成'}));
  expect(generate).toHaveBeenCalledExactlyOnceWith('修正代码符号后的问题');
});
it('cancels work, ignores late recognition, and preserves drafts on failure', async () => {
  const text = vi.fn();
  render(<ScreenshotQuestion onText={text} />);
  await userEvent.click(screen.getByRole('button', {name: '截图识别'}));
  const first = recognize.mock.calls[0]![0];
  await userEvent.click(screen.getByRole('button', {name: '取消识别'}));
  expect(cancel).toHaveBeenCalledWith(first);
  await userEvent.click(screen.getByRole('button', {name: '截图识别'}));
  await act(async () => pending[0]!({status: 'success', text: '迟到的旧结果', confidence: 90, durationMs: 1000}));
  expect(text).not.toHaveBeenCalled();
  await act(async () => pending[1]!({status: 'error', message: '没有识别到文字'}));
  expect(screen.getByRole('alert').textContent).toBe('没有识别到文字');
  expect(text).not.toHaveBeenCalled();
  expect((screen.getByRole('button', {name: '截图识别'}) as HTMLButtonElement).disabled).toBe(false);
});
it('offers a targeted permission action and cancels when the interview ends or editor unmounts', async () => {
  const {rerender, unmount} = render(<ScreenshotQuestion onText={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', {name: '截图识别'}));
  await act(async () => pending[0]!({status: 'error', message: '请允许录屏权限', permission: true}));
  await userEvent.click(screen.getByRole('button', {name: '打开录屏权限设置'}));
  expect(window.electronAPI!.audio.openPrivacySettings).toHaveBeenCalledWith('screen');
  await userEvent.click(screen.getByRole('button', {name: '截图识别'}));
  rerender(<ScreenshotQuestion onText={vi.fn()} disabled />);
  expect(cancel).toHaveBeenCalledWith(recognize.mock.calls[1]![0]);
  rerender(<ScreenshotQuestion onText={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', {name: '截图识别'}));
  unmount();
  expect(cancel).toHaveBeenCalledWith(recognize.mock.calls[2]![0]);
});
