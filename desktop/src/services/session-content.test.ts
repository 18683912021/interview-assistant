import {expect, it} from 'vitest';
import {sessionContentSignature} from './session-content';
import {interviewReducer, INITIAL_STATE} from '../store/interview-reducer';
import type {WorkspaceSession} from '../api/workspace';

it('does not save or invalidate a review merely by restoring a manual question with an API null source', () => {
  const session: WorkspaceSession = {
    id: 'manual-session',
    title: '测试',
    company: '',
    role: '后端',
    job_description: '',
    resume_id: null,
    resume_snapshot: null,
    status: 'completed',
    started_at: 1,
    ended_at: 2,
    duration_seconds: 1,
    revision: 4,
    capture_source: 'mic',
    preferences: {language: 'zh', answer_length: 'brief', answer_style: 'conversational'},
    conversation: [
      {
        id: 'manual',
        role: 'interviewer',
        text: '手动问题',
        status: 'done',
        source: null,
        timestamp: 1,
        revision: 1,
      },
    ],
    answers: [],
    review: {text: '已有复盘', created_at: '2026-10-09', revision: 4},
  };
  const hydrated = interviewReducer(INITIAL_STATE, {
    type: 'hydrate',
    conversation: session.conversation.map(message => ({
      ...message,
      source: undefined,
      status: 'done',
    })),
    answers: [],
  });
  expect(sessionContentSignature({...session, conversation: hydrated.conversation})).toBe(
    sessionContentSignature(session),
  );
  const edited = interviewReducer(hydrated, {type: 'edit_message', id: 'manual', text: '修正问题'});
  expect(sessionContentSignature({...session, conversation: edited.conversation})).not.toBe(
    sessionContentSignature(session),
  );
  expect(sessionContentSignature({...session, preferences: {...session.preferences, answer_style: 'written'}})).not.toBe(
    sessionContentSignature(session),
  );
});
