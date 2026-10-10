// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuthScreen from './AuthScreen';
import {sendCode, register, login} from '../api/auth';
vi.mock('../api/auth', () => ({sendCode: vi.fn(), register: vi.fn(), login: vi.fn(), loginPassword: vi.fn(), resetPassword: vi.fn()}));
vi.mock('../utils/token', () => ({saveToken: vi.fn()}));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe('authentication feedback', () => {
  it('puts invalid email below its field, focuses it and never sends a code', async () => {
    const user = userEvent.setup();
    render(<AuthScreen onLogin={() => {}} />);
    const email = screen.getByRole('textbox', {name: '邮箱'});
    await user.type(email, 'invalid');
    await user.click(screen.getByRole('button', {name: '获取验证码'}));
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(email.closest('.field')?.textContent).toContain('请输入有效的邮箱地址');
    expect(document.activeElement).toBe(email);
    expect(sendCode).not.toHaveBeenCalled();
    await user.type(email, '@example.com');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('validates registration fields individually without sending malformed data', async () => {
    const user = userEvent.setup();
    render(<AuthScreen onLogin={() => {}} />);
    await user.click(screen.getByRole('button', {name: '创建账号'}));
    await user.click(screen.getByRole('button', {name: '创建账号'}));
    expect(screen.getAllByRole('alert')).toHaveLength(3);
    expect(screen.getByText('密码至少需要 8 个字符').closest('.field')?.textContent).toContain('密码');
    expect(register).not.toHaveBeenCalled();
  });
  it('shows delivery beside the code, prevents resending and clears stale code on email change', async () => {
    vi.mocked(sendCode).mockResolvedValue({ok: true, message: '验证码已发送', cooldown: 60});
    const user = userEvent.setup();
    render(<AuthScreen onLogin={() => {}} />);
    await user.type(screen.getByRole('textbox', {name: '邮箱'}), 'test@example.com');
    await user.click(screen.getByRole('button', {name: '获取验证码'}));
    await screen.findByRole('status');
    const code = screen.getByPlaceholderText('6 位验证码');
    await waitFor(() => expect(document.activeElement).toBe(code));
    expect(screen.getByRole('status').closest('.field')?.contains(code)).toBe(true);
    expect((screen.getByRole('button', {name: /秒后重发/}) as HTMLButtonElement).disabled).toBe(true);
    await user.type(code, '123456');
    await user.type(screen.getByRole('textbox', {name: '邮箱'}), 'x');
    expect((code as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('attaches an expired server code error to the code field and preserves email', async () => {
    vi.mocked(login).mockRejectedValue(new Error('验证码无效或已过期，请重新获取'));
    const user = userEvent.setup();
    render(<AuthScreen onLogin={() => {}} />);
    await user.type(screen.getByRole('textbox', {name: '邮箱'}), 'test@example.com');
    const code = screen.getByPlaceholderText('6 位验证码');
    await user.type(code, '123456');
    await user.click(screen.getByRole('button', {name: '登录'}));
    await screen.findByRole('alert');
    expect(code.closest('.field')?.textContent).toContain('已过期');
    await waitFor(() => expect(document.activeElement).toBe(code));
    expect((screen.getByRole('textbox', {name: '邮箱'}) as HTMLInputElement).value).toBe('test@example.com');
  });
});
