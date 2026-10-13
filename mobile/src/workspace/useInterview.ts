import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, Share} from 'react-native';
import {AudioCapture} from '../native';
import {getEmail} from '../utils/token';
import {
  saveWorkspaceInterview,
  getWorkspaceInterview,
  type WorkspaceSession,
  type WorkspaceAnswer,
  type WorkspaceMessage,
} from '../api/workspace';
import {streamJSON} from '../api/stream';
import {microphone} from './microphone';
import {canAnswer, settle, transcribe, uuid} from './model';
import {questionContext, previousReference} from './answer-context';

export function useInterview() {
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const current = useRef(session);
  const [capture, setCapture] = useState('idle');
  const captureRef = useRef('idle');
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const clock = useRef<{at: number; seconds: number} | null>(null);
  const [error, setError] = useState('');
  const [sync, setSync] = useState('已同步');
  const [level, setLevel] = useState(0);
  const [selected, setSelected] = useState('');
  const [speaker, setSpeaker] = useState<'interviewer' | 'user'>('interviewer');
  const speakerRef = useRef(speaker);
  speakerRef.current = speaker;
  const segment = useRef(uuid());
  const key = useRef('');
  const changes = useRef(0);
  const saved = useRef(0);
  const syncing = useRef<Promise<void> | null>(null);
  const answerAbort = useRef<AbortController | null>(null);
  const answerTask = useRef<Promise<void> | null>(null);
  const actionLock = useRef(false);
  const update = useCallback((value: WorkspaceSession | null) => {
    current.current = value;
    changes.current++;
    setSession(value);
  }, []);
  const change = useCallback(
    (fn: (s: WorkspaceSession) => WorkspaceSession) => {
      if (current.current) {
        update(fn(current.current));
      }
    },
    [update],
  );
  const flush = useCallback(async () => {
    while (syncing.current) {
      await syncing.current;
    }
    if (!current.current || changes.current === saved.current) {
      return;
    }
    const task = (async () => {
      const version = changes.current;
      const snapshot = current.current!;
      setSync('正在同步');
      // Write locally first; errors remain visible and do not discard the draft.
      if (key.current) {
        await AudioCapture.storePreference(
          key.current,
          JSON.stringify(snapshot),
        );
      }
      try {
        const result = await saveWorkspaceInterview(
          {...snapshot, revision: snapshot.revision + 1},
          snapshot.revision,
        );
        if (current.current?.id === snapshot.id) {
          current.current = {...current.current, revision: result.revision};
          setSession(current.current);
        }
        saved.current = version;
        if (key.current && current.current) {
          await AudioCapture.storePreference(
            key.current,
            JSON.stringify(current.current),
          );
        }
        setSync(changes.current === saved.current ? '已同步' : '等待同步');
      } catch (e) {
        setSync('保存在本机，待同步');
        throw e;
      }
    })();
    syncing.current = task;
    try {
      await task;
    } finally {
      syncing.current = null;
    }
  }, []);
  useEffect(() => {
    let alive = true;
    (async () => {
      await microphone.reconcile();
      const email = await getEmail();
      if (!email) {
        throw new Error('请重新登录以恢复面试记录');
      }
      key.current = `workspace_draft:${email}`;
      const raw = await AudioCapture.getPreference(key.current);
      if (!raw || !alive) {
        return;
      }
      const draft = settle(JSON.parse(raw) as WorkspaceSession);
      try {
        const remote = await getWorkspaceInterview(draft.id);
        if (remote.revision > draft.revision) {
          if (alive) {
            update(draft);
            setError(
              '云端已有更新，本机记录已保留。请导出本机备份后，在其他设备核对，避免覆盖不同版本。',
            );
          }
        } else if (
          remote.status !== 'completed' ||
          draft.status !== 'completed'
        ) {
          if (alive) {
            update(draft);
          }
        }
      } catch {
        if (alive) {
          update(draft);
        }
      }
      if (alive) {
        setSync('已恢复上次记录，麦克风已暂停');
      }
    })()
      .catch(() => setError('本机记录读取失败，请勿清除应用数据'))
      .finally(() => {
        if (alive) {
          setRestoring(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [update]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!syncing.current) {
        flush().catch(e => setError(e.message));
      }
    }, 2200);
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        flush().catch(e => setError(e.message));
      }
    });
    return () => {
      clearInterval(timer);
      listener.remove();
      answerAbort.current?.abort();
    };
  }, [flush]);
  useEffect(
    () =>
      microphone.subscribe(
        e => {
          change(s =>
            s.status === 'completed'
              ? s
              : {
                  ...s,
                  conversation: transcribe(
                    s.conversation,
                    e,
                    segment.current,
                    speakerRef.current,
                  ),
                },
          );
        },
        state => {
          captureRef.current = state;
          setCapture(state);
          if (state === 'capturing') {
            clock.current = {
              at: Date.now(),
              seconds: current.current?.duration_seconds || 0,
            };
          } else if (clock.current) {
            const elapsed = clock.current;
            clock.current = null;
            change(s => ({
              ...s,
              duration_seconds:
                elapsed.seconds + Math.floor((Date.now() - elapsed.at) / 1000),
            }));
          }
        },
        message => setError(message),
        setLevel,
      ),
    [change],
  );
  useEffect(() => {
    if (capture !== 'capturing') {
      return;
    }
    const interval = setInterval(() => {
      const elapsed = clock.current;
      if (elapsed) {
        change(s => ({
          ...s,
          duration_seconds:
            elapsed.seconds + Math.floor((Date.now() - elapsed.at) / 1000),
        }));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [capture, change]);
  const create = async (value: WorkspaceSession) => {
    if (restoring) {
      throw new Error('正在恢复记录，请稍后再试');
    }
    if (current.current && current.current.status !== 'completed') {
      throw new Error('请先结束当前面试');
    }
    update(value);
    saved.current = -1;
    await flush();
  };
  const resume = async () => {
    if (!canAnswer(current.current) || actionLock.current) {
      return;
    }
    actionLock.current = true;
    setBusy(true);
    setError('');
    segment.current = uuid();
    try {
      await flush();
      await microphone.start(current.current!.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };
  const pause = async () => {
    if (['capturing', 'preparing'].includes(captureRef.current)) {
      await microphone.stop();
    }
    change(s => ({...s, conversation: settle(s).conversation}));
  };
  const stop = async (end: boolean) => {
    if (actionLock.current) {
      return;
    }
    actionLock.current = true;
    setBusy(true);
    setError('');
    try {
      if (end) {
        answerAbort.current?.abort();
        await answerTask.current;
      }
      await pause();
      if (end) {
        change(s => ({
          ...settle(s),
          status: 'completed',
          ended_at: Date.now(),
        }));
      }
      await flush();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };
  const answer = async (ids: string[], supplement?: string) => {
    const s = current.current;
    if (!canAnswer(s) || !s || actionLock.current) {
      return;
    }
    if (answerTask.current) {
      const existing = s.answers.find(
        a => a.source_message_ids.join() === ids.join(),
      );
      if (existing) {
        setSelected(existing.id);
      } else {
        setError('当前回答正在生成，请先停止生成再选择新问题');
      }
      return;
    }
    const sources = s.conversation.filter(
      m => ids.includes(m.id) && m.text.trim(),
    );
    if (!sources.length || sources.some(m => m.status === 'streaming')) {
      setError('请等待当前句子完成，或长按修正后提问');
      return;
    }
    const reuse =
      !supplement &&
      [...s.answers]
        .reverse()
        .find(
          a =>
            a.source_message_ids.join() === ids.join() &&
            a.source_revisions.every(
              (r, i) => r === (sources[i]?.revision ?? 0),
            ) &&
            a.context_snapshot?.answer_style === s.preferences.answer_style &&
            !a.context_snapshot?.supplement_instruction &&
            a.status === 'done',
        );
    if (reuse) {
      setSelected(reuse.id);
      return;
    }
    const previous = s.answers.find(a => a.id === selected);
    const context = {
      ...s.preferences,
      recent_messages: questionContext(s.conversation, ids),
      previous_reference_answer: previousReference(
        s.conversation,
        s.answers,
        ids,
      ),
      ...(supplement
        ? {
            supplement_instruction: supplement,
            previous_answer: previous?.text || '',
          }
        : {}),
    };
    const request: WorkspaceAnswer = {
      id: uuid(),
      request_id: uuid(),
      source_message_ids: sources.map(m => m.id),
      source_revisions: sources.map(m => m.revision ?? 0),
      question_text: sources.map(m => m.text).join('\n'),
      text: '',
      status: 'loading',
      timestamp: Date.now(),
      context_version: 1,
      context_snapshot: context,
    };
    setSelected(request.id);
    setError('');
    change(v => ({...v, answers: [...v.answers, request]}));
    const controller = new AbortController();
    answerAbort.current = controller;
    const patch = (value: Partial<WorkspaceAnswer>) =>
      change(v => ({
        ...v,
        answers: v.answers.map(a =>
          a.id === request.id ? {...a, ...value} : a,
        ),
      }));
    let text = '';
    let repaint: ReturnType<typeof setTimeout> | undefined;
    const publish = () => {
      if (repaint) {
        clearTimeout(repaint);
        repaint = undefined;
      }
      patch({text, status: 'streaming'});
    };
    const task = (async () => {
      try {
        await flush();
        await streamJSON(
          `/api/workspace/interviews/${s.id}/answer`,
          {
            request_id: request.request_id,
            question_text: request.question_text,
            source_message_ids: request.source_message_ids,
            source_revisions: request.source_revisions,
            context,
            context_version: 1,
            language: s.preferences.language,
          },
          e => {
            if (e.type === 'delta') {
              text += e.text;
              if (!repaint) {
                repaint = setTimeout(publish, 40);
              }
            }
            if (e.type === 'done') {
              publish();
              patch({status: e.status === 'truncated' ? 'truncated' : 'done'});
            }
          },
          controller.signal,
        );
      } catch (e) {
        publish();
        patch({status: controller.signal.aborted ? 'cancelled' : 'error'});
        if (!controller.signal.aborted) {
          setError((e as Error).message);
        }
      } finally {
        if (repaint) {
          clearTimeout(repaint);
        }
        answerAbort.current = null;
        await flush().catch(e => setError(e.message));
      }
    })();
    answerTask.current = task;
    try {
      await task;
    } finally {
      answerTask.current = null;
    }
  };
  const edit = (id: string, text: string, role: 'interviewer' | 'user') =>
    change(s =>
      s.status === 'completed'
        ? s
        : {
            ...s,
            conversation: s.conversation.map(m =>
              m.id === id
                ? {
                    ...m,
                    text: text.trim(),
                    role,
                    edited: true,
                    status: 'done',
                    revision: (m.revision ?? 0) + 1,
                  }
                : m,
            ),
          },
    );
  const add = (text: string) => {
    if (!text.trim() || !canAnswer(current.current)) {
      return;
    }
    const message: WorkspaceMessage = {
      id: uuid(),
      role: 'interviewer',
      text: text.trim(),
      timestamp: Date.now(),
      status: 'done',
      revision: 1,
      edited: true,
    };
    change(s => ({...s, conversation: [...s.conversation, message]}));
  };
  return {
    session,
    capture,
    busy,
    restoring,
    error,
    setError,
    sync,
    level,
    selected,
    setSelected,
    speaker,
    setSpeaker,
    create,
    openSaved: (value: WorkspaceSession) => {
      if (current.current && current.current.status !== 'completed') {
        return;
      }
      update({...settle(value), capture_source: 'mic'});
      saved.current = changes.current;
      setCapture('idle');
      captureRef.current = 'idle';
      setSelected('');
      setError('');
    },
    resume,
    stop,
    answer,
    edit,
    add,
    flush,
    cancel: () => answerAbort.current?.abort(),
    exportLocal: async () => {
      if (current.current) {
        await Share.share({
          message: JSON.stringify(current.current, null, 2),
          title: '面试本机备份',
        });
      }
    },
    close: async () => {
      try {
        await flush();
      } catch (e) {
        setError((e as Error).message);
        return;
      }
      update(null);
      if (key.current) {
        AudioCapture.removePreference(key.current).catch(() => {});
      }
    },
  };
}
export type InterviewController = ReturnType<typeof useInterview>;
