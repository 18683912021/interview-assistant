// @vitest-environment jsdom
import {act, cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import InterviewScreen from './InterviewScreen';
import {ToastProvider} from '../components/Toast';
import {saveWorkspaceInterview} from '../api/workspace';
import {checkAIReadiness} from '../api/diagnostics';
vi.mock('../config', () => ({API_BASE: '', MAIN_STREAM_URL: '', STREAM_DIRECT_ADDRESS: ''}));
vi.mock('../api/workspace', async original => {
  const actual = await original<typeof import('../api/workspace')>();
  return {...actual, getJobs: vi.fn().mockResolvedValue([]), getResumes: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue(actual.DEFAULT_SETTINGS), saveWorkspaceInterview: vi.fn()};
});
vi.mock('../services/drafts', () => ({loadDrafts: vi.fn().mockResolvedValue([]), storeDraft: vi.fn(), removeDraft: vi.fn()}));
vi.mock('../api/diagnostics', () => ({checkAIReadiness: vi.fn()}));
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const off = () => () => {};
  window.electronAPI = {audio: {
    onState: off, onTranscription: off, onLLMStart: off, onLLMChunk: off, onLLMDone: off,
    onStreamState: off, onLevels: off, onError: off,
    stopCapture: vi.fn().mockResolvedValue(undefined), cancelSystemAudioCheck: vi.fn().mockResolvedValue(undefined),
  }} as unknown as NonNullable<Window['electronAPI']>;
});
afterEach(() => {cleanup(); delete window.electronAPI; vi.unstubAllGlobals();});
async function setup() {
  render(<MemoryRouter><ToastProvider><InterviewScreen /></ToastProvider></MemoryRouter>);
  await userEvent.type(await screen.findByRole('textbox', {name: '面试岗位'}), '后端开发');
}
it('starting for the first time requests permission, keeps denial inline, and creates no session', async () => {
  const getUserMedia = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
  vi.stubGlobal('navigator', {userAgent: 'Mac', mediaDevices: {getUserMedia}});
  await setup();
  await userEvent.click(screen.getByRole('button', {name: '开始面试'}));
  await screen.findByRole('alert');
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(screen.getByRole('alert').closest('.audio-readiness-row')?.textContent).toContain('麦克风');
  expect(screen.getByRole('region', {name: '面试音频准备'})).toBe(document.activeElement);
  expect(saveWorkspaceInterview).not.toHaveBeenCalled();
  expect(checkAIReadiness).not.toHaveBeenCalled();
  expect((screen.getByRole('button', {name: '开始面试'}) as HTMLButtonElement).disabled).toBe(false);
});
it('cancelling a pending first start releases a late permission result without creating a session', async () => {
  let resolve!: (value: MediaStream) => void;
  const getUserMedia = vi.fn(() => new Promise<MediaStream>(done => {resolve = done;}));
  vi.stubGlobal('navigator', {userAgent: 'Mac', mediaDevices: {getUserMedia}});
  await setup();
  await userEvent.click(screen.getByRole('button', {name: '开始面试'}));
  await userEvent.click(await screen.findByRole('button', {name: '取消检查'}));
  const stop = vi.fn();
  await act(async () => {resolve({getAudioTracks: () => [{readyState: 'live', stop}], getTracks: () => [{stop}]} as unknown as MediaStream);});
  await waitFor(() => expect(stop).toHaveBeenCalled());
  expect(saveWorkspaceInterview).not.toHaveBeenCalled();
  expect(checkAIReadiness).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getAllByText('待检查')).toHaveLength(2);
});
