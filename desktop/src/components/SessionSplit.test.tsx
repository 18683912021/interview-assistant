// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {cleanup, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {SessionSplit} from './SessionSplit';
afterEach(() => {cleanup(); localStorage.clear();});
describe('interview panel width', () => {
  it('defaults to a wider answer and supports bounded keyboard resizing and reset', async () => {
    const user = userEvent.setup();
    render(<SessionSplit pane="chat"><div>对话</div><div>回答</div></SessionSplit>);
    const divider = screen.getByRole('separator');
    expect(divider.getAttribute('aria-valuenow')).toBe('38');
    divider.focus();
    await user.keyboard('{Home}{ArrowLeft}');
    expect(divider.getAttribute('aria-valuenow')).toBe('30');
    await user.keyboard('{End}{ArrowRight}');
    expect(divider.getAttribute('aria-valuenow')).toBe('48');
    await user.keyboard('{Enter}');
    expect(localStorage.getItem('interview:conversation-width')).toBe('38');
  });
  it('bounds a saved width before rendering', () => {
    localStorage.setItem('interview:conversation-width', '95');
    render(<SessionSplit pane="answer"><div>对话</div><div>回答</div></SessionSplit>);
    expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('48');
  });
});
