import {LineStream} from '../src/api/stream';
import {canAnswer, settle, transcribe} from '../src/workspace/model';
import {questionContext} from '../src/workspace/answer-context';
import type {WorkspaceSession} from '../src/api/workspace';
jest.mock('../src/utils/token', () => ({getToken: jest.fn()}));
test('updates one utterance through revisions and preserves separate sentences', () => {
  let m = transcribe(
    [],
    {text: '你', is_final: false, utterance_id: 'one', revision: 1},
    'capture1',
    'interviewer',
  );
  m = transcribe(
    m,
    {text: '你负责什么？', is_final: true, utterance_id: 'one', revision: 3},
    'capture1',
    'interviewer',
  );
  m = transcribe(
    m,
    {text: '旧结果', is_final: false, utterance_id: 'one', revision: 2},
    'capture1',
    'interviewer',
  );
  m = transcribe(
    m,
    {text: '讲个例子', is_final: true, utterance_id: 'two', revision: 1},
    'capture1',
    'interviewer',
  );
  expect(m.map(v => v.text)).toEqual(['你负责什么？', '讲个例子']);
  expect(m[0]?.status).toBe('done');
  m = transcribe(
    m,
    {text: '重新开始', is_final: false, utterance_id: 'one', revision: 1},
    'capture2',
    'user',
  );
  expect(m).toHaveLength(3);
  expect(m[2]?.role).toBe('user');
});
test('does not overwrite user corrections with late ASR results', () => {
  const m = transcribe(
    [],
    {text: '错误', is_final: false, utterance_id: 'one'},
    'capture',
    'user',
  );
  m[0] = {...m[0]!, edited: true, text: '已修正'};
  expect(
    transcribe(
      m,
      {text: '后到结果', is_final: true, utterance_id: 'one', revision: 9},
      'capture',
      'user',
    )[0]?.text,
  ).toBe('已修正');
});
test('completed interview forbids generation; interrupted streams remain reviewable', () => {
  const session = {
    status: 'completed',
    conversation: [{status: 'streaming', text: '部分句子'}],
    answers: [{status: 'streaming', text: '部分回答'}],
  } as WorkspaceSession;
  expect(canAnswer(session)).toBe(false);
  expect(canAnswer({...session, status: 'active'})).toBe(true);
  expect(settle(session).answers[0]?.status).toBe('cancelled');
  expect(settle(session).conversation[0]?.status).toBe('interrupted');
});
test('NDJSON survives transport boundaries and refuses a missing terminal event', () => {
  const events: unknown[] = [];
  const parser = new LineStream(e => events.push(e));
  parser.push('{"type":"delta","text":"你好');
  parser.push('"}\n{"type":"delta","text":"世界"}\n');
  parser.push('{"type":"done","text":"","status":"completed"}', true);
  expect(events).toHaveLength(3);
  expect(parser.done).toBe(true);
  expect(() =>
    new LineStream(() => {}).push('{"type":"delta","text":"partial"}', true),
  ).toThrow('连接中断');
  expect(() =>
    new LineStream(() => {}).push('{"type":"error","text":"服务不可用"}\n'),
  ).toThrow('服务不可用');
});
test('retrospective question context excludes later dialogue', () => {
  const messages = ['前文', '问题', '后文'].map((text, i) => ({
    id: String(i),
    role: 'interviewer',
    text,
  }));
  expect(questionContext(messages, ['1'])).toEqual([
    {role: 'interviewer', text: '前文'},
  ]);
});
