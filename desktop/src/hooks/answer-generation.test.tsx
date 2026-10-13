// @vitest-environment jsdom
import {act, cleanup, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {useAudioCapture, type AnswerContext} from './useAudioCapture';
import {streamJSON} from '../api/stream';
vi.mock('../config', () => ({MAIN_STREAM_URL: '', STREAM_DIRECT_ADDRESS: '', API_BASE: ''}));
vi.mock('../api/stream', () => ({streamJSON: vi.fn()}));
const context: AnswerContext = {role: '后端开发', job_description: '', resume_text: '真实简历', language: 'zh',
  answer_length: 'standard', answer_style: 'written', context_version: 1};
const message = {id: 'm1', text: '原始识别问题', role: 'interviewer' as const, revision: 2, status: 'done' as const, timestamp: 1};
beforeEach(() => {vi.clearAllMocks(); delete window.electronAPI; vi.mocked(streamJSON).mockResolvedValue(undefined);});
afterEach(cleanup);
it('sends the edited question and streams into a new answer while preserving source and previous answers', async () => {
  vi.mocked(streamJSON).mockImplementation(async (_url, _body, receive) => {
    receive({type: 'delta', text: '新答案'}); receive({type: 'done', text: '', status: 'completed'});
  });
  const {result} = renderHook(() => useAudioCapture());
  const oldAnswer = {id: 'old', request_id: 'old-request', source_message_ids: ['m1'], source_revisions: [2],
    question_text: message.text, text: '旧答案', status: 'done' as const, timestamp: 2, context_version: 1};
  act(() => result.current.dispatch({type: 'hydrate', conversation: [message], answers: [oldAnswer]}));
  await act(async () => {result.current.sendLLMQuery('session', ['m1'], context, undefined, '  请解释并发控制  ');});
  const body = vi.mocked(streamJSON).mock.calls[0]![1];
  expect(body).toMatchObject({question_text: '请解释并发控制', source_message_ids: ['m1'], source_revisions: [2], context: {question_edited: true}});
  expect(result.current.state.conversation).toEqual([message]);
  expect(result.current.state.answers[0]).toEqual(oldAnswer);
  expect(result.current.state.answers[1]).toMatchObject({question_text: '请解释并发控制', text: '新答案', status: 'done'});
  await act(async () => {result.current.sendLLMQuery('session', ['m1'], context,
    {text: '新答案', instruction: '补充例子'}, '请解释并发控制');});
  expect(vi.mocked(streamJSON).mock.calls[1]![1]).toMatchObject({question_text: '请解释并发控制',
    context: {question_edited: true, previous_answer: '新答案', supplement_instruction: '补充例子'}});
});
it('never requests an answer for empty/oversized overrides or a completed interview', () => {
  const {result} = renderHook(() => useAudioCapture());
  act(() => result.current.dispatch({type: 'hydrate', conversation: [message], answers: []}));
  act(() => {
    expect(result.current.sendLLMQuery('session', ['m1'], context, undefined, '  ')).toBeNull();
    expect(result.current.sendLLMQuery('session', ['m1'], context, undefined, '问'.repeat(16001))).toBeNull();
  });
  act(() => result.current.dispatch({type: 'captureState', value: 'completed'}));
  act(() => expect(result.current.sendLLMQuery('session', ['m1'], context, undefined, '新问题')).toBeNull());
  expect(streamJSON).not.toHaveBeenCalled();
});
