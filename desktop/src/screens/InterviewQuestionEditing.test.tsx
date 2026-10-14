// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import InterviewScreen from './InterviewScreen';
import {ToastProvider} from '../components/Toast';
import {DEFAULT_SETTINGS, getWorkspaceInterview, type WorkspaceSession} from '../api/workspace';
import {streamJSON} from '../api/stream';
vi.mock('../config', () => ({API_BASE: '', MAIN_STREAM_URL: '', STREAM_DIRECT_ADDRESS: ''}));
vi.mock('../api/workspace', async original => {
  const actual = await original<typeof import('../api/workspace')>();
  return {...actual, getJobs: vi.fn().mockResolvedValue([]), getResumes: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue(actual.DEFAULT_SETTINGS), getWorkspaceInterview: vi.fn(),
    saveWorkspaceInterview: vi.fn(async (value: WorkspaceSession) => value)};
});
vi.mock('../services/drafts', () => ({loadDrafts: vi.fn().mockResolvedValue([]), storeDraft: vi.fn(), removeDraft: vi.fn()}));
vi.mock('../api/stream', () => ({streamJSON: vi.fn()}));
const session: WorkspaceSession = {id: 'session', title: '测试面试', role: '后端', company: '', job_description: '',
  resume_id: null, resume_snapshot: null, capture_source: 'mic', status: 'interrupted', started_at: 1, ended_at: null,
  duration_seconds: 0, revision: 1, preferences: DEFAULT_SETTINGS,
  conversation: [{id: 'one', role: 'interviewer', text: '原始问题', revision: 1, timestamp: 1, status: 'done'}],
  answers: [{id: 'answer', request_id: 'request', question_text: '原始问题', source_message_ids: ['one'],
    source_revisions: [1], text: '原答案', status: 'done', context_version: 1, context_snapshot: {...DEFAULT_SETTINGS}, timestamp: 2}]};
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); delete window.electronAPI;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', class {observe() {} unobserve() {} disconnect() {}});
  vi.mocked(getWorkspaceInterview).mockResolvedValue(session);
  vi.mocked(streamJSON).mockImplementation(async (_path, body, receive) => {
    receive({type: 'delta', text: `新答案：${body.question_text}`});
    receive({type: 'done', text: '', status: 'completed'});
  });
});
afterEach(() => {cleanup(); vi.unstubAllGlobals();});
const setup = () => render(<MemoryRouter initialEntries={['/interview?session=session']}><ToastProvider><InterviewScreen /></ToastProvider></MemoryRouter>);
it('edits the question in place and keeps it for regeneration and supplements, without rewriting dialogue', async () => {
  setup();
  await userEvent.click(await screen.findByRole('button', {name: '编辑问题'}));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', {name: '重新回答'})).toBeNull();
  expect(screen.queryByRole('button', {name: '补充一个例子'})).toBeNull();
  fireEvent.change(screen.getByRole('textbox', {name: '编辑本次问题'}), {target: {value: '请解释事务隔离级别'}});
  await userEvent.click(screen.getByRole('button', {name: '重新生成'}));
  await screen.findByText('新答案：请解释事务隔离级别');
  expect(screen.getByText('原始问题')).toBeTruthy();
  expect(screen.getByText('本次问题 · 已编辑')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', {name: '重新回答'}));
  await waitFor(() => expect(streamJSON).toHaveBeenCalledTimes(2));
  await userEvent.click(screen.getByRole('button', {name: '补充一个例子'}));
  await waitFor(() => expect(streamJSON).toHaveBeenCalledTimes(3));
  for (const call of vi.mocked(streamJSON).mock.calls) expect(call[1].question_text).toBe('请解释事务隔离级别');
  expect(vi.mocked(streamJSON).mock.calls[2]![1].context).toMatchObject({supplement_instruction: expect.any(String)});
  // Clicking the original bubble reopens its original answer rather than a paid request for the edited question.
  await userEvent.click(screen.getByText('原始问题'));
  await screen.findByText('原答案');
  expect(streamJSON).toHaveBeenCalledTimes(3);
});
it('completed interview remains read-only', async () => {
  vi.mocked(getWorkspaceInterview).mockResolvedValue({...session, status: 'completed', ended_at: 2});
  setup();
  await screen.findByText('原答案');
  expect((screen.getByRole('radio', {name: '笔试机试'}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('button', {name: '编辑问题'})).toBeNull();
  expect((screen.getByRole('button', {name: '手动添加问题'}) as HTMLButtonElement).disabled).toBe(true);
  expect(within(screen.getByRole('region', {name: '本次回答的问题'})).getByText('原始问题')).toBeTruthy();
});

it('submits manual questions once, immediately answers them, and keeps previous context and answers', async () => {
  setup();
  await screen.findByText('原答案');
  await userEvent.click(screen.getByRole('radio', {name: '笔试机试'}));
  for (const question of ['补充问题一', '补充问题二']) {
    await userEvent.click(screen.getByRole('button', {name: '手动添加问题'}));
    const dialog = within(screen.getByRole('dialog'));
    expect((dialog.getByRole('button', {name: '提交并回答'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(dialog.getByRole('textbox'), {target: {value: `  ${question}  `}});
    // The second click on the old button must not create a duplicate question/request.
    const submit = dialog.getByRole('button', {name: '提交并回答'});
    act(() => {fireEvent.click(submit); fireEvent.click(submit);});
    await screen.findByText(`新答案：${question}`);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(screen.getByRole('region', {name: '本次回答的问题'})).getByText(question)).toBeTruthy();
  }
  expect(streamJSON).toHaveBeenCalledTimes(2);
  const bodies = vi.mocked(streamJSON).mock.calls.map(call => call[1]);
  expect(bodies[0]).toMatchObject({question_text: '补充问题一', source_message_ids: [expect.stringMatching(/^manual/)],
    source_revisions: [1], context: {answer_style: 'coding', recent_messages: [{role: 'interviewer', text: '原始问题'}], previous_reference_answer: '原答案'}});
  expect(bodies[1]).toMatchObject({question_text: '补充问题二', context: {recent_messages: [
    {role: 'interviewer', text: '原始问题'}, {role: 'interviewer', text: '补充问题一'},
  ]}});
  expect(bodies[0]!.source_message_ids).not.toEqual(bodies[1]!.source_message_ids);
  await userEvent.click(screen.getByRole('radio', {name: '自然口述'}));
  await userEvent.click(screen.getByText('原始问题'));
  await screen.findByText('原答案');
  expect(streamJSON).toHaveBeenCalledTimes(2);
});

it('lets users correct screenshot text before submitting it, then answers without clicking the conversation', async () => {
  let recognize!: (result: {status: 'success'; text: string; confidence: number; durationMs: number}) => void;
  window.electronAPI = {screenshot: {
    recognize: vi.fn(() => new Promise(resolve => {recognize = resolve;})), cancel: vi.fn().mockResolvedValue(undefined),
    onProgress: vi.fn(() => vi.fn()),
  }} as unknown as NonNullable<Window['electronAPI']>;
  setup();
  await userEvent.click(await screen.findByRole('button', {name: '手动添加问题'}));
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.change(dialog.getByRole('textbox'), {target: {value: '之前的草稿'}});
  await userEvent.click(dialog.getByRole('button', {name: '截图识别'}));
  expect((dialog.getByRole('button', {name: '提交并回答'}) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => recognize({status: 'success', text: '按订单 |D 分组', confidence: 90, durationMs: 500}));
  expect((dialog.getByRole('textbox') as HTMLTextAreaElement).value).toBe('按订单 |D 分组');
  expect(streamJSON).not.toHaveBeenCalled();
  fireEvent.change(dialog.getByRole('textbox'), {target: {value: '按订单 ID 分组'}});
  await userEvent.click(dialog.getByRole('button', {name: '提交并回答'}));
  await screen.findByText('新答案：按订单 ID 分组');
  expect(streamJSON).toHaveBeenCalledTimes(1);
  expect(vi.mocked(streamJSON).mock.calls[0]![1].question_text).toBe('按订单 ID 分组');
});

it('keeps a submitted question after a generation failure and retries without adding it again', async () => {
  vi.mocked(streamJSON).mockRejectedValueOnce(new Error('测试网络异常'));
  setup();
  await userEvent.click(await screen.findByRole('button', {name: '手动添加问题'}));
  fireEvent.change(within(screen.getByRole('dialog')).getByRole('textbox'), {target: {value: '需要重试的问题'}});
  await userEvent.click(screen.getByRole('button', {name: '提交并回答'}));
  await screen.findByText('测试网络异常');
  expect(screen.queryByRole('dialog')).toBeNull();
  await userEvent.click(screen.getByRole('button', {name: '重新回答'}));
  await screen.findByText('新答案：需要重试的问题');
  expect(streamJSON).toHaveBeenCalledTimes(2);
  const calls = vi.mocked(streamJSON).mock.calls;
  expect(calls[1]![1].source_message_ids).toEqual(calls[0]![1].source_message_ids);
  expect(screen.getAllByText('原始问题')).toHaveLength(1);
  expect(screen.getAllByText('需要重试的问题')).toHaveLength(2); // One bubble and one answer heading.
});

it('allows consecutive edits while streaming, after completion, cancellation and failure', async () => {
  const pending: {receive: Parameters<typeof streamJSON>[2]; signal: AbortSignal; resolve: () => void; reject: (error: Error) => void}[] = [];
  vi.mocked(streamJSON).mockImplementation((_path, _body, receive, signal) => new Promise<void>((resolve, reject) => {
    pending.push({receive, signal, resolve, reject});
  }));
  setup();
  await screen.findByText('原答案');
  let currentQuestion = '原始问题';
  const edit = async (question: string) => {
    const nextRequest = pending.length + 1;
    const button = screen.getByRole('button', {name: '编辑问题'}) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    await userEvent.click(button);
    expect((screen.getByRole('textbox', {name: '编辑本次问题'}) as HTMLTextAreaElement).value).toBe(currentQuestion);
    fireEvent.change(screen.getByRole('textbox', {name: '编辑本次问题'}), {target: {value: question}});
    await userEvent.click(screen.getByRole('button', {name: '重新生成'}));
    await waitFor(() => expect(pending).toHaveLength(nextRequest));
    expect(within(screen.getByRole('region', {name: '本次回答的问题'})).getByText(question)).toBeTruthy();
    currentQuestion = question;
  };
  await edit('第一次修改');
  act(() => pending[0]!.receive({type: 'delta', text: '第一次的部分回答'}));
  // Editing and cancelling the draft must not interrupt the existing stream.
  await userEvent.click(screen.getByRole('button', {name: '编辑问题'}));
  expect(pending[0]!.signal.aborted).toBe(false);
  fireEvent.change(screen.getByRole('textbox'), {target: {value: '不提交的修改'}});
  await userEvent.click(screen.getByRole('button', {name: '取消'}));
  expect(pending[0]!.signal.aborted).toBe(false);
  expect(streamJSON).toHaveBeenCalledTimes(1);

  await edit('第二次修改');
  expect(pending[0]!.signal.aborted).toBe(true);
  await act(async () => {
    // Late chunks from an aborted generation cannot replace the new question or answer.
    pending[0]!.receive({type: 'delta', text: '旧请求迟到的内容'});
    pending[0]!.receive({type: 'done', text: '', status: 'completed'});
    pending[0]!.resolve();
    pending[1]!.receive({type: 'delta', text: '第二次完整回答'});
    pending[1]!.receive({type: 'done', text: '', status: 'completed'});
    pending[1]!.resolve();
  });
  expect(screen.queryByText('旧请求迟到的内容')).toBeNull();
  await edit('第三次修改');
  await userEvent.click(screen.getByRole('button', {name: '编辑问题'}));
  fireEvent.change(screen.getByRole('textbox'), {target: {value: '第四次修改'}});
  await userEvent.click(screen.getByRole('button', {name: '停止生成'}));
  expect(pending[2]!.signal.aborted).toBe(true);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('第四次修改');
  await userEvent.click(screen.getByRole('button', {name: '重新生成'}));
  currentQuestion = '第四次修改';
  await act(async () => {pending[2]!.resolve(); pending[3]!.reject(new Error('测试连接中断'));});
  await screen.findByText('测试连接中断');
  await edit('第五次修改');
  await act(async () => {
    pending[4]!.receive({type: 'delta', text: '第五次完整回答'});
    pending[4]!.receive({type: 'done', text: '', status: 'completed'});
    pending[4]!.resolve();
  });
  // Reopening after every completed answer also has no one-edit limit.
  for (const question of ['第六次修改', '第七次修改']) {
    await edit(question);
    await act(async () => {
      pending.at(-1)!.receive({type: 'delta', text: `完整回答：${question}`});
      pending.at(-1)!.receive({type: 'done', text: '', status: 'completed'});
      pending.at(-1)!.resolve();
    });
  }
  expect(streamJSON).toHaveBeenCalledTimes(7);
  vi.mocked(streamJSON).mock.calls.forEach((call, index) => {
    expect(call[1]).toMatchObject({question_text: ['第一次修改', '第二次修改', '第三次修改', '第四次修改', '第五次修改', '第六次修改', '第七次修改'][index],
      source_message_ids: ['one'], source_revisions: [1], context: {question_edited: true}});
  });
  // Original transcript and its answer remain available after all edits.
  await userEvent.click(screen.getByText('原始问题'));
  await screen.findByText('原答案');
  expect(streamJSON).toHaveBeenCalledTimes(7);
});
