// @vitest-environment jsdom
import {afterEach, beforeAll, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {IconButton} from './IconButton';
beforeAll(() => vi.stubGlobal('ResizeObserver', class {observe() {} unobserve() {} disconnect() {}}));
afterEach(cleanup);
it('renders a hint inside the window, never as a native title, and clears it on blur', async () => {
  render(<IconButton title="窗口置顶">置顶</IconButton>);
  const button = screen.getByRole('button', {name: '窗口置顶'});
  expect(button.hasAttribute('title')).toBe(false);
  fireEvent.focus(button);
  await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy());
  fireEvent(window, new Event('blur'));
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
});
