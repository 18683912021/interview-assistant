// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {AudioReadiness} from './AudioReadiness';
afterEach(cleanup);
const props = () => ({source: 'both' as const, steps: {}, busy: false, isMac: true,
  onCheck: vi.fn(), onCancel: vi.fn(), onSettings: vi.fn(), onSource: vi.fn()});
it('switch controls the source without claiming OS permission or silently starting capture', async () => {
  const p = props(); render(<AudioReadiness {...p} />);
  expect(screen.getAllByText('待检查')).toHaveLength(2);
  await userEvent.click(screen.getByRole('switch', {name: '采集系统音频'}));
  expect(p.onSource).toHaveBeenCalledWith('mic');
  expect(p.onCheck).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', {name: '授权并检查音频'}));
  expect(p.onCheck).toHaveBeenCalledOnce();
});
it('places failure and recovery alongside the correct input, with microphone-only fallback', async () => {
  const p = props(); render(<AudioReadiness {...p} steps={{system: {source: 'system', status: 'error', message: '系统音频未允许'}}} />);
  const row = screen.getByRole('alert').closest('.audio-readiness-row');
  expect(row?.textContent).toContain('系统音频未允许');
  await userEvent.click(screen.getByRole('button', {name: '打开系统权限设置'}));
  expect(p.onSettings).toHaveBeenCalledWith('system');
  await userEvent.click(screen.getByRole('button', {name: '先用麦克风'}));
  expect(p.onSource).toHaveBeenCalledWith('mic');
});
it('permits cancelling a pending permission check while preventing source changes', async () => {
  const p = props(); render(<AudioReadiness {...p} busy steps={{mic: {source: 'mic', status: 'checking', message: '请允许麦克风'}}} />);
  expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole('button', {name: '取消检查'}));
  expect(p.onCancel).toHaveBeenCalledOnce();
});
it('does not label quiet system audio as granted or failed', () => {
  render(<AudioReadiness {...props()} steps={{system: {source: 'system', status: 'quiet', message: '设备已响应，但未检测到测试音'}}} />);
  expect(screen.getByText('设备已响应')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
