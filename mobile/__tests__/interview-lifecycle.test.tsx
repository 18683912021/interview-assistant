import React from 'react';
import Renderer, {act} from 'react-test-renderer';
import {
  useInterview,
  type InterviewController,
} from '../src/workspace/useInterview';
import {DEFAULT_SETTINGS, saveWorkspaceInterview} from '../src/api/workspace';
import {streamJSON} from '../src/api/stream';
import {microphone} from '../src/workspace/microphone';
import type {WorkspaceSession} from '../src/api/workspace';
jest.mock('../src/native', () => ({
  AudioCapture: {
    getPreference: jest.fn(async () => null),
    storePreference: jest.fn(async () => {}),
    removePreference: jest.fn(async () => {}),
  },
}));
jest.mock('../src/utils/token', () => ({
  getEmail: jest.fn(async () => 'unit@example.com'),
  getToken: jest.fn(async () => 'unit-token'),
}));
jest.mock('../src/api/workspace', () => ({
  ...jest.requireActual('../src/api/workspace'),
  getWorkspaceInterview: jest.fn(),
  saveWorkspaceInterview: jest.fn(async s => s),
}));
jest.mock('../src/api/stream', () => ({
  streamJSON: jest.fn(async (_path, _body, emit) => {
    emit({type: 'delta', text: '完整'});
    emit({type: 'delta', text: '回答'});
    emit({type: 'done', text: '', status: 'completed'});
  }),
}));
jest.mock('../src/workspace/microphone', () => ({
  microphone: {
    reconcile: jest.fn(async () => {}),
    subscribe: jest.fn(() => () => {}),
    start: jest.fn(async () => {}),
    stop: jest.fn(async () => {}),
  },
}));
let controller: InterviewController;
function Harness() {
  controller = useInterview();
  return null;
}
function initial(): WorkspaceSession {
  return {
    id: '756bff25-ef46-4c14-acd4-9bf6edaf22f5',
    title: '测试岗位',
    role: '测试岗位',
    company: '',
    job_description: '',
    resume_id: null,
    resume_snapshot: null,
    status: 'active',
    started_at: Date.now(),
    ended_at: null,
    duration_seconds: 0,
    conversation: [],
    answers: [],
    preferences: DEFAULT_SETTINGS,
    revision: 0,
    capture_source: 'mic',
  };
}
let renderer: Renderer.ReactTestRenderer;
beforeEach(async () => {
  jest.clearAllMocks();
  await act(async () => {
    renderer = Renderer.create(<Harness />);
  });
});
afterEach(async () => {
  await act(async () => renderer.unmount());
});
test('creates server-owned session before opening the microphone', async () => {
  await act(async () => {
    await controller.create(initial());
    await controller.resume();
  });
  expect(saveWorkspaceInterview).toHaveBeenCalled();
  expect(microphone.start).toHaveBeenCalledWith(initial().id);
  expect(
    (saveWorkspaceInterview as jest.Mock).mock.invocationCallOrder[0],
  ).toBeLessThan((microphone.start as jest.Mock).mock.invocationCallOrder[0]!);
});
test('paused capture permits answers; repeated clicks reuse an answer; ended sessions cannot generate', async () => {
  await act(async () => {
    await controller.create(initial());
    controller.add('介绍一下缓存一致性');
  });
  const id = controller.session!.conversation[0]!.id;
  await act(async () => controller.answer([id]));
  expect(controller.session!.answers[0]?.text).toBe('完整回答');
  expect(controller.session!.answers[0]?.status).toBe('done');
  await act(async () => controller.answer([id]));
  expect(streamJSON).toHaveBeenCalledTimes(1);
  await act(async () => controller.stop(true));
  expect(controller.session?.status).toBe('completed');
  await act(async () => controller.answer([id], '补充例子'));
  expect(streamJSON).toHaveBeenCalledTimes(1);
});
test('failed sync retains an ended local record on close', async () => {
  await act(async () => controller.create(initial()));
  (saveWorkspaceInterview as jest.Mock).mockRejectedValueOnce(
    new Error('网络断开'),
  );
  await act(async () => controller.stop(true));
  expect(controller.session?.status).toBe('completed');
  expect(controller.sync).toContain('本机');
  (saveWorkspaceInterview as jest.Mock).mockRejectedValueOnce(
    new Error('网络断开'),
  );
  await act(async () => controller.close());
  expect(controller.session).not.toBeNull();
});
