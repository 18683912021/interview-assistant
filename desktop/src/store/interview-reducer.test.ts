import {describe, expect, it} from 'vitest';
import {INITIAL_STATE, interviewReducer, type Action} from './interview-reducer';
import type {ConversationAnswer} from './types';
const utterance = (
  overrides: Partial<Extract<Action, {type: 'transcription'}>> = {},
): Extract<Action, {type: 'transcription'}> => ({
  type: 'transcription',
  text: '请介绍项目',
  isFinal: false,
  source: 'system',
  timestamp: 100,
  utteranceId: 'stream:0',
  revision: 1,
  ...overrides,
});
const answer: ConversationAnswer = {
  id: 'a',
  request_id: 'request-a',
  source_message_ids: ['system:stream:0'],
  source_revisions: [1],
  question_text: '请介绍项目',
  text: '',
  status: 'loading',
  timestamp: 100,
  context_version: 1,
};
describe('speech bubbles', () => {
  it('splits a corrected utterance in place while preserving old answers and ignoring late ASR edits', () => {
    let state = interviewReducer(
      INITIAL_STATE,
      utterance({text: '项目用了 Node.js，为什么这样选型？'}),
    );
    state = interviewReducer(state, {type: 'answer_requested', answer});
    state = interviewReducer(state, {
      type: 'split_message',
      id: 'system:stream:0',
      parts: [
        {id: 'ignored', text: '项目用了 Node.js。'},
        {id: 'manual-part', text: '为什么这样选型？'},
      ],
    });
    state = interviewReducer(
      state,
      utterance({text: '后来的识别结果', revision: 9, isFinal: true}),
    );
    expect(state.conversation.map(message => [message.id, message.text])).toEqual([
      ['system:stream:0', '项目用了 Node.js。'],
      ['manual-part', '为什么这样选型？'],
    ]);
    expect(state.answers[0]).toEqual(answer);
    expect(state.conversation[1]?.utteranceId).toBeUndefined();
  });
  it('revises interim text in place, then finalizes the same bubble without changing order', () => {
    let state = interviewReducer(INITIAL_STATE, utterance());
    state = interviewReducer(
      state,
      utterance({utteranceId: 'stream:1', text: '具体负责什么？', revision: 1, timestamp: 300}),
    );
    state = interviewReducer(
      state,
      utterance({text: '请介绍一下 Node.js 项目。', revision: 2, isFinal: true, timestamp: 500}),
    );
    expect(state.conversation).toHaveLength(2);
    expect(state.conversation[0]).toMatchObject({
      id: 'system:stream:0',
      text: '请介绍一下 Node.js 项目。',
      timestamp: 100,
      status: 'done',
      revision: 2,
    });
    expect(interviewReducer(state, utterance({revision: 1}))).toBe(state);
  });
  it('does not merge microphone, system, or reconnect namespaces', () => {
    let state = interviewReducer(INITIAL_STATE, utterance());
    state = interviewReducer(state, utterance({source: 'mic', text: '我负责后端。'}));
    state = interviewReducer(state, utterance({utteranceId: 'new-stream:0'}));
    expect(new Set(state.conversation.map(message => message.id)).size).toBe(3);
  });
  it('keeps manually corrected text and the answered question frozen across final revisions', () => {
    let state = interviewReducer(INITIAL_STATE, utterance());
    state = interviewReducer(state, {type: 'answer_requested', answer});
    state = interviewReducer(state, {
      type: 'edit_message',
      id: 'system:stream:0',
      text: '请介绍缓存项目。',
    });
    state = interviewReducer(state, utterance({text: '识别后来修订', revision: 8, isFinal: true}));
    expect(state.conversation[0]?.text).toBe('请介绍缓存项目。');
    expect(state.answers[0]?.question_text).toBe('请介绍项目');
    expect(state.answers[0]?.source_revisions).toEqual([1]);
  });
  it('retains all records past the old 60-message limit', () => {
    let state = INITIAL_STATE;
    for (let i = 0; i < 120; i++)
      state = interviewReducer(state, utterance({utteranceId: `s:${i}`, isFinal: true}));
    expect(state.conversation).toHaveLength(120);
  });
  it('keeps unconfirmed tail text pending after capture stops or a draft is restored', () => {
    let state = interviewReducer(INITIAL_STATE, utterance());
    state = interviewReducer(
      state,
      utterance({utteranceId: 'stream:1', text: '已经说完。', isFinal: true}),
    );
    const stopped = interviewReducer(state, {type: 'settle'});
    const restored = interviewReducer(INITIAL_STATE, {
      type: 'hydrate',
      conversation: state.conversation,
      answers: [],
    });
    for (const result of [stopped, restored]) {
      expect(result.conversation[0]).toMatchObject({text: '请介绍项目', status: 'interrupted'});
      expect(result.conversation[1]).toMatchObject({text: '已经说完。', status: 'done'});
      const confirmed = interviewReducer(
        result,
        utterance({text: '请介绍项目。', isFinal: true, revision: 2}),
      );
      expect(confirmed.conversation).toHaveLength(2);
      expect(confirmed.conversation[0]).toMatchObject({text: '请介绍项目。', status: 'done'});
    }
  });
});
describe('answer request isolation', () => {
  it('does not duplicate replayed stream chunks or append an older chunk out of order', () => {
    let state = interviewReducer(INITIAL_STATE, {type: 'answer_requested', answer});
    for (const [chunkIndex, delta] of [
      [0, '第一句。'],
      [0, '第一句。'],
      [1, '第二句。'],
      [0, '迟到重复'],
    ] as const)
      state = interviewReducer(state, {
        type: 'llm_chunk',
        requestId: answer.request_id,
        delta,
        chunkIndex,
        timestamp: 150,
      });
    expect(state.answers[0]?.text).toBe('第一句。第二句。');
    expect(state.answers[0]?.first_token_at).toBe(150);
  });
  it('ignores unknown and cancelled request chunks even while another answer streams', () => {
    let state = interviewReducer(INITIAL_STATE, {type: 'answer_requested', answer});
    state = interviewReducer(state, {
      type: 'llm_chunk',
      requestId: 'request-a',
      delta: '结论',
      timestamp: 150,
    });
    state = interviewReducer(state, {type: 'cancel_answer', requestId: 'request-a'});
    state = interviewReducer(state, {
      type: 'answer_requested',
      answer: {...answer, id: 'b', request_id: 'request-b'},
    });
    state = interviewReducer(state, {
      type: 'llm_chunk',
      requestId: 'request-a',
      delta: '迟到片段',
      timestamp: 200,
    });
    state = interviewReducer(state, {
      type: 'llm_chunk',
      requestId: 'unknown',
      delta: '错误',
      timestamp: 200,
    });
    state = interviewReducer(state, {
      type: 'llm_chunk',
      requestId: 'request-b',
      delta: '新的回答',
      timestamp: 210,
    });
    expect(state.answers.map(value => value.text)).toEqual(['结论', '新的回答']);
    expect(state.conversation).toEqual([]);
  });
  it('preserves partial answers on failure and cancels unfinished work when restored', () => {
    let state = interviewReducer(INITIAL_STATE, {
      type: 'answer_requested',
      answer: {...answer, text: '已完成的部分', status: 'streaming'},
    });
    state = interviewReducer(state, {
      type: 'llm_done',
      requestId: 'request-a',
      full_answer: '',
      status: 'failed',
      error: '断线',
      timestamp: 200,
    });
    expect(state.answers[0]).toMatchObject({text: '已完成的部分', status: 'error'});
    state = interviewReducer(state, {
      type: 'hydrate',
      conversation: [],
      answers: [{...answer, status: 'streaming', text: '可恢复的部分'}],
    });
    expect(state.answers[0]).toMatchObject({status: 'cancelled', text: '可恢复的部分'});
  });
});

it('pausing only settles ASR while finishing cancels an in-flight answer', () => {
  let state = interviewReducer(INITIAL_STATE, utterance());
  state = interviewReducer(state, {type: 'answer_requested', answer});
  const paused = interviewReducer(state, {type: 'settle', keepAnswers: true});
  expect(paused.conversation[0]?.status).toBe('interrupted');
  expect(paused.answers[0]?.status).toBe('loading');
  expect(interviewReducer(state, {type: 'settle'}).answers[0]?.status).toBe('cancelled');
});
