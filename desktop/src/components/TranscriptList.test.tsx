// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {TranscriptList} from './TranscriptList';
import {INITIAL_STATE, interviewReducer} from '../store/interview-reducer';
import type {ConversationMessage} from '../store/types';

afterEach(cleanup);
it('keeps long dual-channel history intact while revising drafts and selecting older questions', () => {
  const messages: ConversationMessage[] = Array.from({length: 800}, (_, index) => ({
    id: String(index), utteranceId: String(index), revision: 1, timestamp: index * 1000,
    source: index % 2 ? 'mic' : 'system', role: index % 2 ? 'user' : 'interviewer',
    status: 'done', text: `保留问题 ${index}`,
  }));
  let state = {...INITIAL_STATE, conversation: messages};
  const onSelect = vi.fn(), onEdit = vi.fn();
  const view = (selected: string[] = []) => <TranscriptList messages={state.conversation} selected={selected}
    multi={true} answeredIds='["0"]' onSelect={onSelect} onEdit={onEdit} />;
  const rendered = render(view());
  const original = screen.getByRole('button', {name: '保留问题 0'});
  act(() => {
    for (let revision = 2; revision <= 100; revision++) {
      for (const index of [798, 799]) state = interviewReducer(state, {type: 'transcription',
        utteranceId: String(index), source: index % 2 ? 'mic' : 'system', revision,
        text: `双通道 ${index} 第 ${revision} 次更新`, isFinal: revision === 100, timestamp: 100000});
    }
    rendered.rerender(view(['0']));
  });
  expect(rendered.container.querySelectorAll('.chat-message').length).toBe(800);
  expect(screen.getByRole('button', {name: '保留问题 0'})).toBe(original);
  expect(original.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('双通道 798 第 100 次更新')).toBeTruthy();
  expect(screen.getByText('双通道 799 第 100 次更新')).toBeTruthy();
  fireEvent.click(original);
  expect(onSelect).toHaveBeenCalledWith('0');
});
