// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router-dom';
import {DesktopFrame} from './DesktopFrame';
import {ToastProvider} from './Toast';

afterEach(() => {cleanup(); delete window.electronAPI;});
describe('desktop window actions', () => {
  it('offers hide and quit even on the login screen, with truthful Mac protection details', async () => {
    const hideAll = vi.fn().mockResolvedValue(undefined), quitApp = vi.fn().mockResolvedValue(undefined);
    window.electronAPI = {window: {
      hideAll, quitApp,
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

  it('does not expose native controls in the web preview', () => {
    render(<ToastProvider><MemoryRouter><DesktopFrame><p>登录</p></DesktopFrame></MemoryRouter></ToastProvider>);
    expect(screen.queryByRole('button', {name: '退出程序'})).toBeNull();
    expect(screen.getByText('登录')).toBeTruthy();
  });
});
