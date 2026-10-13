// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router-dom';
import {DesktopFrame} from './DesktopFrame';
import {setInterviewActive} from '../utils/interviewState';
import {ToastProvider} from './Toast';

afterEach(() => {cleanup(); setInterviewActive(false); delete window.electronAPI;});
describe('desktop window actions', () => {
  it('offers hide and quit even on the login screen, with truthful Mac protection details', async () => {
    const hideAll = vi.fn().mockResolvedValue(undefined), quitApp = vi.fn().mockResolvedValue(undefined);
    window.electronAPI = {window: {
      hideAll, quitApp,
      getMode: async () => ({compact: false, pinned: false, alwaysOnTop: false}),
      onModeChanged: () => () => {},
      getPrivacy: async () => ({platform: 'darwin', protectionRequested: true, shortcut: '⌘⇧H'}),
      onPrepareQuit: () => () => {}, onQuitCancelled: () => () => {},
    }} as unknown as NonNullable<Window['electronAPI']>;
    const user = userEvent.setup();
    render(<ToastProvider><MemoryRouter><DesktopFrame><p>登录</p></DesktopFrame></MemoryRouter></ToastProvider>);
    await user.click(screen.getByRole('button', {name: /共享保护/}));
    expect(screen.getByText(/ScreenCaptureKit/).textContent).toContain('仍可能录到窗口');
    await user.click(screen.getByRole('button', {name: '知道了'}));
    await user.click(screen.getByRole('button', {name: /隐藏窗口/}));
    expect(hideAll).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', {name: '退出程序'}));
    expect(quitApp).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', {name: '正在保存并退出…'}).hasAttribute('disabled')).toBe(true);
  });

  it('locks pinning in compact mode and restores the original pin choice without remounting content', async () => {
    const setCompact = vi.fn(async (compact: boolean) => ({compact, pinned: false, alwaysOnTop: compact}));
    window.electronAPI = {window: {
      getMode: async () => ({compact: false, pinned: false, alwaysOnTop: false}),
      onModeChanged: () => () => {}, setCompact,
      getPrivacy: async () => ({platform: 'win32', protectionRequested: true, shortcut: 'Ctrl+Shift+H'}),
      onPrepareQuit: () => () => {}, onQuitCancelled: () => () => {},
    }} as unknown as NonNullable<Window['electronAPI']>;
    setInterviewActive(true);
    const user = userEvent.setup();
    render(<ToastProvider><MemoryRouter initialEntries={['/interview']}><DesktopFrame><textarea aria-label="当前笔记" defaultValue="保留当前内容" /></DesktopFrame></MemoryRouter></ToastProvider>);
    const content = screen.getByRole('textbox');
    await user.click(screen.getByRole('button', {name: '小窗口模式'}));
    expect(screen.getByRole('button', {name: '小窗口自动置顶'}).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('textbox')).toBe(content);
    await user.click(screen.getByRole('button', {name: '恢复大窗口'}));
    expect(screen.getByRole('button', {name: '窗口置顶'}).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('textbox')).toBe(content);
    expect(setCompact.mock.calls).toEqual([[true], [false]]);
  });

  it('does not expose native controls in the web preview', () => {
    render(<ToastProvider><MemoryRouter><DesktopFrame><p>登录</p></DesktopFrame></MemoryRouter></ToastProvider>);
    expect(screen.queryByRole('button', {name: '退出程序'})).toBeNull();
    expect(screen.getByText('登录')).toBeTruthy();
  });
});
