import type {WorkspaceSession} from '../api/workspace';

/** API null and renderer undefined both mean a manually supplied sentence with no audio source. */
export function sessionContentSignature(value: WorkspaceSession) {
  return JSON.stringify({
    status: value.status,
    capture_source: value.capture_source,
    ended_at: value.ended_at,
    duration_seconds: value.duration_seconds,
    preferences: value.preferences,
    conversation: value.conversation.map(message => ({...message, source: message.source ?? null})),
    answers: value.answers,
  });
}
