// @vitest-environment jsdom
import {createRef} from 'react';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, expect, it, vi} from 'vitest';
import {ScreenReadiness, type ScreenReadinessHandle} from './ScreenReadiness';
afterEach(() => {cleanup(); delete window.electronAPI;});
it('checks without prompting, repairs only on explicit preparation action, and refreshes after returning from settings', async () => {
  const getPermissions = vi.fn().mockResolvedValue({platform: 'darwin', screen: 'denied', canRepairScreenPermission: true});
  const requestPermission = vi.fn(), repairScreenPermission = vi.fn().mockResolvedValue({screen: 'denied'});
  window.electronAPI = {audio: {getPermissions, requestPermission, repairScreenPermission}} as unknown as NonNullable<Window['electronAPI']>;
  const ref = createRef<ScreenReadinessHandle>(), ready = vi.fn(), busy = vi.fn();
  render(<ScreenReadiness ref={ref} enabled requiredForAudio busy={false} onEnabled={vi.fn()} onReady={ready} onBusy={busy} />);
  await act(async () => {expect(await ref.current!.ensure(false)).toBe(false);});
  expect(requestPermission).not.toHaveBeenCalled(); expect(repairScreenPermission).not.toHaveBeenCalled();
  await userEvent.click(screen.getByText('已开启权限，仍显示未就绪？'));
  await userEvent.click(screen.getByRole('button', {name: '重新申请录屏权限'}));
  expect(repairScreenPermission).toHaveBeenCalledOnce(); expect(busy.mock.calls.map(c => c[0])).toEqual([true, false]);
  getPermissions.mockResolvedValue({platform: 'darwin', screen: 'granted'});
  await act(async () => {fireEvent.focus(window);});
  expect(screen.getByText('录屏权限已就绪')).toBeTruthy();
  await act(async () => {expect(await ref.current!.ensure(false)).toBe(true);});
  expect(requestPermission).not.toHaveBeenCalled();
});
