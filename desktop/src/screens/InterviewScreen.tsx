import {useCallback, useContext, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {useNavigate, useSearchParams} from 'react-router-dom';
import {
  ArrowLeft,
  ArrowDown,
  ArrowUpRight,
  AudioLines,
  BriefcaseBusiness,
  Check,
  CheckCheck,
  Copy,
  FileText,
  Headphones,
  MessageSquare,
  Mic,
  Monitor,
  Pause,
  Pencil,
  Play,
  Plus,
  Square,
  X,
} from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  getJobs,
  getResumes,
  getSettings,
  getWorkspaceInterview,
  saveWorkspaceInterview,
  type Job,
  type ResumeVersion,
  type Settings,
  type WorkspaceSession,
} from '../api/workspace';
import {ApiError, messageOf} from '../api/client';
import {AuthContext} from '../utils/AuthContext';
import {setInterviewActive} from '../utils/interviewState';
import {useAudioCapture} from '../hooks/useAudioCapture';
import {useToast} from '../components/Toast';
import {EmptyState, ErrorState, Loading, Modal} from '../components/WorkspaceUI';
import {SessionJournal} from '../services/session-journal';
import {loadDrafts, removeDraft, storeDraft} from '../services/drafts';
import {genId, interviewReducer} from '../store/interview-reducer';
import type {ConversationMessage} from '../store/types';
import {AnswerBody} from '../components/AnswerBody';
import {AudioPermissions} from '../components/AudioPermissions';
import {findReusableAnswer, hasRevisedSources} from '../services/conversation';
import {sessionContentSignature as signature} from '../services/session-content';
import {checkAIReadiness} from '../api/diagnostics';
import {enumerateAudioInputs, type AudioInputDevice} from '../utils/audioDevices';
import {microphoneEchoMessage} from '../services/microphone-capture';
import {
  desktopPlatform,
  listSystemOutputs,
  withLocalAudioDevices,
  type SystemOutputDevice,
} from '../services/audio-device-settings';
import './interview.css';

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
const messageStatus = (value: string): ConversationMessage['status'] =>
  ['loading', 'streaming', 'done', 'error', 'interrupted'].includes(value)
    ? (value as ConversationMessage['status'])
    : 'done';
export default function InterviewScreen() {
  const navigate = useNavigate(),
    [params] = useSearchParams();
  const {profile} = useContext(AuthContext),
    {toast, confirm} = useToast();
  const email = profile?.email || '';
  const isWindows = desktopPlatform() === 'windows';
  const {
    state,
    settling,
    echoMode,
    dispatch,
    prepare,
    assertPrepared,
    discardPreparation,
    start,
    stop,
    sendLLMQuery,
    cancelAnswer,
  } = useAudioCapture();
  const stateRef = useRef(state);
  stateRef.current = state;
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [jobs, setJobs] = useState<Job[]>([]),
    [resumes, setResumes] = useState<ResumeVersion[]>([]);
  const [drafts, setDrafts] = useState<WorkspaceSession[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [working, setBusy] = useState(false);
  const busy = working || settling;
  const [startStage, setStartStage] = useState(''),
    [deviceModal, setDeviceModal] = useState(false),
    [audioDevices, setAudioDevices] = useState<AudioInputDevice[]>([]);
  const [systemOutputs, setSystemOutputs] = useState<SystemOutputDevice[]>([]);
  const [outputError, setOutputError] = useState('');
  const [session, setSession] = useState<WorkspaceSession | null>(null);
  const [role, setRole] = useState(''),
    [company, setCompany] = useState(''),
    [jd, setJd] = useState('');
  const [resumeId, setResumeId] = useState(''),
    [jobId, setJobId] = useState('');
  const [source, setSource] = useState<'both' | 'mic'>('both');
  const [duration, setDuration] = useState(0);
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'offline'>('saved'),
    [saveError, setSaveError] = useState('');
  const [selected, setSelected] = useState<string[]>([]),
    [multi, setMulti] = useState(false),
    [answerId, setAnswerId] = useState<string | null>(null);
  const [pane, setPane] = useState<'chat' | 'answer'>('chat');
  const [editing, setEditing] = useState<{id: string; text: string} | null>(null),
    [splitEditing, setSplitEditing] = useState(false),
    [manual, setManual] = useState(false),
    [manualText, setManualText] = useState('');
  const chatScroll = useRef<HTMLDivElement>(null),
    following = useRef(true);
  const answerScroll = useRef<HTMLDivElement>(null),
    answerPositions = useRef<Record<string, number>>({});
  const [newMessages, setNewMessages] = useState(false);
  const journal = useRef<SessionJournal | null>(null);
  const lastContent = useRef('');

  useEffect(() => {
    if (!deviceModal) return;
    let active = true;
    let request = 0;
    const refresh = () => {
      const current = ++request;
      void enumerateAudioInputs().then(devices => {
        if (active && current === request) setAudioDevices(devices);
      });
      if (isWindows) {
        void listSystemOutputs()
          .then(devices => {
            if (!active || current !== request) return;
            setSystemOutputs(devices);
            setOutputError('');
          })
          .catch(e => {
            if (!active || current !== request) return;
            setSystemOutputs([]);
            setOutputError(messageOf(e));
          });
      }
    };
    refresh();
    // Reconnects and changes in Windows Sound settings should be visible while
    // the recovery dialog remains open. A late result must not replace a newer list.
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener('devicechange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [deviceModal, isWindows]);

  const restore = useCallback(
    (value: WorkspaceSession) => {
      setSession(value);
      setDuration(value.duration_seconds);
      setSource(value.capture_source || 'both');
      setRole(value.role);
      setCompany(value.company);
      setJd(value.job_description);
      dispatch({
        type: 'hydrate',
        conversation: value.conversation.map(message => ({
          ...message,
          status: messageStatus(message.status),
          source:
            message.source === 'mic' || message.source === 'system' ? message.source : undefined,
        })),
        answers: value.answers,
      });
      dispatch({
        type: 'captureState',
        value: value.status === 'completed' ? 'completed' : 'paused',
      });
      setAnswerId(value.answers.at(-1)?.id || null);
      setSelected(value.answers.at(-1)?.source_message_ids || []);
    },
    [dispatch],
  );
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let local: WorkspaceSession[] = [];
      try {
        local = await loadDrafts(email, count =>
          setError(`${count} 份本机副本无法读取，已保留原文件；其他记录可正常恢复。`),
        );
      } catch {
        setError('本机草稿暂时无法读取，仍可使用服务器上的资料与记录。');
      }
      setDrafts(
        local.filter(
          value => value.status !== 'completed' || value.revision > (value.sync_base_revision ?? 0),
        ),
      );
      const results = await Promise.allSettled([getJobs(), getResumes(), getSettings()]);
      const [jobResult, resumeResult, settingResult] = results;
      if (jobResult.status === 'fulfilled') setJobs(jobResult.value);
      if (resumeResult.status === 'fulfilled') setResumes(resumeResult.value);
      if (settingResult.status === 'fulfilled') {
        setSettings(withLocalAudioDevices(settingResult.value));
      }
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') setError(messageOf(failed.reason));
      const requestedDraft = params.get('draft');
      if (requestedDraft) {
        const localValue = local.find(value => value.id === requestedDraft);
        if (!localValue) throw new Error('未找到这份本机副本，请返回面试记录刷新。');
        restore(localValue);
        return;
      }
      const requested = params.get('session');
      if (requested) {
        const localValue = local.find(value => value.id === requested);
        try {
          const serverValue = await getWorkspaceInterview(requested);
          restore(
            localValue && localValue.revision > serverValue.revision ? localValue : serverValue,
          );
        } catch (e) {
          if (localValue && (!(e instanceof ApiError) || ![403, 404].includes(e.status)))
            restore(localValue);
          else throw e;
        }
      }
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, [email, params, restore]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!session) return;
    const writer = new SessionJournal(
      session.revision,
      value => storeDraft(email, value),
      saveWorkspaceInterview,
      (value, err) => {
        if (journal.current !== writer) return;
        setSaveState(value);
        setSaveError(err ? messageOf(err) : '');
      },
      1200,
      session.sync_base_revision ?? session.revision,
    );
    journal.current = writer;
    lastContent.current = signature(session);
    writer.recover(session);
    return () => {
      writer.dispose();
      void writer.flush().catch(() => {});
      if (journal.current === writer) journal.current = null;
    };
    // A writer belongs to a session, not to every metadata update.
  }, [session?.id, email]);
  useEffect(() => {
    if (!session || !journal.current) return;
    const value = {
      ...session,
      duration_seconds: duration,
      conversation: state.conversation,
      answers: state.answers,
    };
    const content = signature(value);
    if (content === lastContent.current) return;
    lastContent.current = content;
    journal.current.push(value);
  }, [session, state.conversation, state.answers, duration]);
  useEffect(() => {
    const active = !!session && session.status !== 'completed';
    setInterviewActive(active);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      // Electron stops capture and drains atomic storage on close; blocking its
      // before-quit cycle here would leave a stopped session in an unclosable window.
      if (active && !window.electronAPI) {
        event.preventDefault();
        event.returnValue = '';
      }
      if (active) void journal.current?.flush().catch(() => {});
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      setInterviewActive(false);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [session?.id, session?.status]);
  useEffect(() => {
    if (state.captureState !== 'capturing') return;
    const started = performance.now(),
      base = duration;
    const timer = setInterval(
      () => setDuration(base + Math.floor((performance.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [state.captureState]);
  useEffect(() => {
    if (state.captureState === 'paused' && session?.status === 'active')
      setSession(value => (value ? {...value, status: 'interrupted'} : value));
  }, [state.captureState, session?.status]);
  useEffect(() => {
    const el = chatScroll.current;
    if (!el) return;
    if (following.current) el.scrollTop = el.scrollHeight;
    else setNewMessages(true);
  }, [state.conversation]);
  const answer = state.answers.find(value => value.id === answerId);
  useLayoutEffect(() => {
    if (answerScroll.current)
      answerScroll.current.scrollTop = answerPositions.current[answerId || ''] || 0;
  }, [answerId]);
  const chooseAnswer = (id: string) => {
    const saved = state.answers.find(value => value.id === id);
    if (!saved) return;
    setAnswerId(id);
    setSelected(saved.source_message_ids);
    setPane('answer');
  };
  const live = state.captureState === 'capturing';
  const generating = answer?.status === 'loading' || answer?.status === 'streaming';
  const request = (ids: string[]) => {
    if (!session) return;
    const id = sendLLMQuery(ids, {
      role: session.role,
      job_description: session.job_description,
      resume_text: session.resume_snapshot?.text || '',
      ...session.preferences,
      context_version: 1,
      resume_version: session.resume_snapshot?.version,
    });
    if (id) {
      setAnswerId(id);
      setSelected(ids);
      setPane('answer');
    } else if (state.streamState !== 'ready')
      toast('请先恢复采集，连接成功后再生成回答', 'warning');
  };
  const clickMessage = (id: string) => {
    if (multi) {
      if (!selected.includes(id) && selected.length >= 30) {
        toast('一次最多合并 30 句话', 'warning');
        return;
      }
      setSelected(values =>
        values.includes(id) ? values.filter(value => value !== id) : [...values, id],
      );
      return;
    }
    const saved = findReusableAnswer(state.answers, state.conversation, id);
    if (saved) {
      chooseAnswer(saved.id);
      return;
    }
    request([id]);
  };
  const begin = async () => {
    if (!role.trim()) {
      setError('请填写本次面试岗位。');
      return;
    }
    if (!window.electronAPI) {
      setError('请在桌面客户端中开始面试。浏览器可查看资料和历史，无法采集桌面音频。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      setStartStage('正在准备音频设备…');
      await prepare(settings, source);
      setStartStage('正在检查 AI 连接…');
      const readiness = await checkAIReadiness();
      if (!readiness.ready) throw new Error(readiness.message);
      assertPrepared(settings, source);
      setStartStage('正在建立面试连接…');
      const resume = resumes.find(value => value.id === resumeId);
      const value: WorkspaceSession = {
        id: crypto.randomUUID(),
        title: company.trim() ? `${company.trim()} · ${role.trim()}` : role.trim(),
        company: company.trim(),
        role: role.trim(),
        job_description: jd.trim(),
        resume_id: resume?.id || null,
        resume_snapshot: resume
          ? {id: resume.id, version: resume.version, filename: resume.filename, text: resume.text}
          : null,
        status: 'active',
        started_at: Date.now(),
        ended_at: null,
        duration_seconds: 0,
        conversation: [],
        answers: [],
        preferences: {
          language: settings.language,
          answer_length: settings.answer_length,
          answer_style: settings.answer_style,
        },
        revision: 1,
        capture_source: source,
      };
      const saved = await saveWorkspaceInterview(value);
      setSession(saved);
      dispatch({type: 'reset'});
      setDuration(0);
      setInterviewActive(true);
      await storeDraft(email, {...saved, sync_base_revision: saved.revision});
      await start(saved.id, settings, source);
    } catch (e) {
      discardPreparation();
      setError(messageOf(e));
    } finally {
      setBusy(false);
      setStartStage('');
    }
  };
  const resumeCapture = async () => {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      setStartStage('正在准备音频设备…');
      await prepare(settings, source);
      setStartStage('正在检查 AI 连接…');
      const readiness = await checkAIReadiness();
      if (!readiness.ready) throw new Error(readiness.message);
      assertPrepared(settings, source);
      setStartStage('正在恢复面试连接…');
      await journal.current?.flush();
      await start(session.id, settings, source);
      setSession(value => (value ? {...value, status: 'active', ended_at: null} : value));
    } catch (e) {
      discardPreparation();
      setError(messageOf(e));
    } finally {
      setBusy(false);
      setStartStage('');
    }
  };
  const pause = async () => {
    setBusy(true);
    try {
      await stop(true);
      setSession(value => (value ? {...value, status: 'interrupted'} : value));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const finish = async (returnToHistory = false) => {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      await stop();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const settled = interviewReducer(stateRef.current, {type: 'settle'});
      const value: WorkspaceSession = {
        ...session,
        status: 'completed',
        ended_at: Date.now(),
        duration_seconds: duration,
        conversation: settled.conversation,
        answers: settled.answers,
      };
      lastContent.current = signature(value);
      setSession(value);
      setInterviewActive(false);
      journal.current?.push(value);
      await journal.current?.flush();
      await removeDraft(email, value.id);
      toast('面试已保存，可以在记录中查看完整对话', 'success');
      if (returnToHistory) navigate('/history');
    } catch (e) {
      setError(`面试已停止，保存尚未完成：${messageOf(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const retrySave = async () => {
    try {
      await journal.current?.flush();
      setSaveError('');
    } catch (e) {
      setSaveError(messageOf(e));
    }
  };
  const saveCopy = async () => {
    if (!session) return;
    setBusy(true);
    try {
      await stop();
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const settled = interviewReducer(stateRef.current, {type: 'settle'});
      const value: WorkspaceSession = {
        ...session,
        id: crypto.randomUUID(),
        title: `${session.title} · 恢复副本`,
        status: 'completed',
        ended_at: Date.now(),
        duration_seconds: duration,
        conversation: settled.conversation,
        answers: settled.answers,
        revision: 1,
        sync_base_revision: undefined,
      };
      const saved = await saveWorkspaceInterview(value, 0);
      journal.current?.dispose();
      setSession(saved);
      setSaveState('saved');
      setSaveError('');
      setInterviewActive(false);
      await removeDraft(email, session.id);
      toast('已另存为新记录', 'success');
    } catch (e) {
      setSaveError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const exportRecovery = () => {
    const value = journal.current?.snapshot() || session;
    if (!value) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'}),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `面试备份-${value.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  if (loading) return <Loading text="正在准备面试资料…" />;
  if (!session)
    return (
      <section className="page setup-page">
        <button className="btn btn-quiet" onClick={() => navigate('/history')}>
          <ArrowLeft />
          面试记录
        </button>
        <div className="page-heading">
          <div>
            <h1>准备好，开始这场面试</h1>
            <p>选定岗位与简历，回答会围绕这一次的经历和目标展开。</p>
          </div>
        </div>
        {error && <ErrorState message={error} retry={() => void load()} />}
        <AudioPermissions onlyBlocked systemRequired={source === 'both' && !settings.system_device_id} />
        {drafts.length > 0 && (
          <div className="recovery-list">
            {drafts.map(value => (
              <div className="notice" key={value.id}>
                <FileText size={16} />
                <span>
                  <strong>{value.title}</strong>
                  <small>本机保留了一份记录 · {value.conversation.length} 条对话</small>
                </span>
                <button className="btn" onClick={() => restore(value)}>
                  恢复查看
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="setup-grid">
          <div className="setup-form">
            <div className="section-heading">
              <h2>本次面试</h2>
              <span>01 / 面试背景</span>
            </div>
            <label className="field">
              已保存的岗位
              <select
                value={jobId}
                onChange={e => {
                  setJobId(e.target.value);
                  const job = jobs.find(value => value.id === e.target.value);
                  if (job) {
                    setRole(job.title);
                    setCompany(job.company);
                    setJd(job.description);
                  }
                }}>
                <option value="">手动填写岗位</option>
                {jobs.map(job => (
                  <option key={job.id} value={job.id}>
                    {job.company ? `${job.company} · ` : ''}
                    {job.title}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-grid">
              <label className="field">
                面试岗位
                <input
                  value={role}
                  onChange={e => setRole(e.target.value)}
                  placeholder="例如：Java 后端工程师"
                  maxLength={100}
                />
              </label>
              <label className="field">
                <span>
                  公司 <span className="muted">（选填）</span>
                </span>
                <input
                  value={company}
                  onChange={e => setCompany(e.target.value)}
                  placeholder="公司名称"
                  maxLength={100}
                />
              </label>
            </div>
            <label className="field">
              <span>
                岗位要求 <span className="muted">（选填）</span>
              </span>
              <textarea
                rows={4}
                value={jd}
                onChange={e => setJd(e.target.value)}
                placeholder="粘贴岗位描述，帮助回答匹配岗位关注点"
                maxLength={30000}
              />
            </label>
            <label className="field">
              关联简历
              <select value={resumeId} onChange={e => setResumeId(e.target.value)}>
                <option value="">暂不关联，仅提供通用思路</option>
                {resumes.map(resume => (
                  <option key={resume.id} value={resume.id}>
                    {resume.filename} · v{resume.version}
                  </option>
                ))}
              </select>
              <small>本场面试保存该版本快照；以后修改简历不会改变这场记录。</small>
            </label>
            <button className="link-button small" onClick={() => navigate('/materials')}>
              管理岗位和简历 <ArrowUpRight size={12} style={{display: 'inline'}} />
            </button>
          </div>
          <aside className="setup-preview">
            <div className="setup-preview-top">
              <span className="setup-symbol">
                <Headphones size={26} />
              </span>
              <span>
                <strong>{role || '你的下一场面试'}</strong>
                <small>{company || '从容准备，专注对话'}</small>
              </span>
            </div>
            <div className="setup-context">
              <BriefcaseBusiness size={17} />
              <div>
                <strong>{role || '尚未选择岗位'}</strong>
                <small>{jd ? '已补充岗位要求' : '可补充岗位要求，让回答更有针对性'}</small>
              </div>
            </div>
            <div className="setup-context">
              <FileText size={17} />
              <div>
                <strong>
                  {resumes.find(value => value.id === resumeId)?.filename || '尚未关联简历'}
                </strong>
                <small>
                  {resumeId ? '回答优先使用你的真实经历' : '涉及个人经历时将提示补充，不编造事实'}
                </small>
              </div>
            </div>
            <div className="setup-audio">
              <h2>02 / 音频来源</h2>
              <label>
                <input
                  type="radio"
                  name="source"
                  checked={source === 'both'}
                  onChange={() => setSource('both')}
                />
                <span>
                  系统音频 + 麦克风<small>远程面试，对话双方分别记录</small>
                </span>
                <Monitor size={18} />
              </label>
              <label>
                <input
                  type="radio"
                  name="source"
                  checked={source === 'mic'}
                  onChange={() => setSource('mic')}
                />
                <span>
                  仅麦克风<small>练习或手动补充问题</small>
                </span>
                <Mic size={18} />
              </label>
            </div>
            <div className="setup-preview-foot">
              <CheckCheck size={15} />
              <span>点击气泡后才生成回答 · 对话持续记录</span>
            </div>
            <button
              className="btn btn-primary setup-start"
              disabled={busy || !role.trim()}
              onClick={() => void begin()}>
              <Play />
              {busy ? startStage || '正在连接…' : '开始面试'}
            </button>
            <button className="btn btn-quiet" onClick={() => navigate('/settings?tab=audio')}>
              检查音频设备
            </button>
          </aside>
        </div>
      </section>
    );

  return (
    <section className="session-page">
      <header className="session-toolbar">
        <button
          className="icon-btn"
          aria-label="返回面试记录"
          disabled={busy}
          onClick={() => {
            if (session.status === 'completed') navigate('/history');
            else
              confirm(
                '结束并返回记录',
                '将停止采集，并保存本次完整对话与回答。',
                () => void finish(true),
              );
          }}>
          <ArrowLeft />
        </button>
        <span className="session-heading-icon">
          <BriefcaseBusiness size={17} />
        </span>
        <h1>{session.title}</h1>
        <span className="session-context">
          {session.resume_snapshot
            ? `${session.resume_snapshot.filename} · v${session.resume_snapshot.version}`
            : '未关联简历'}
        </span>
        <span className="spacer" />
        <span className={`live-indicator ${live ? 'on' : ''}`}>
          <i />
          {state.captureState === 'preparing'
            ? '连接中'
            : live
              ? '面试中'
              : session.status === 'completed'
                ? '已结束'
                : '已暂停'}
        </span>
        <time className="session-clock">{clock(duration)}</time>
        {session.status !== 'completed' && (
          <>
            {!live && (
              <select
                aria-label="恢复采集的音频来源"
                disabled={busy}
                value={source}
                onChange={event => {
                  const value = event.target.value as 'mic' | 'both';
                  setSource(value);
                  setSession(current => (current ? {...current, capture_source: value} : current));
                }}>
                <option value="both">系统音频 + 麦克风</option>
                <option value="mic">仅麦克风</option>
              </select>
            )}
            {!live && (
              <button
                className="btn btn-quiet"
                disabled={busy}
                onClick={() => {
                  setDeviceModal(true);
                }}>
                调整设备
              </button>
            )}
            <button
              className="btn"
              disabled={busy}
              onClick={() => void (live ? pause() : resumeCapture())}>
              {live ? <Pause /> : <Play />}
              {settling ? '正在停止采集…' : busy ? startStage || '处理中…' : live ? '暂停' : '继续'}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                confirm('结束这场面试', '完整对话与回答会保留在面试记录中。', () => void finish())
              }>
              <Square />
              结束
            </button>
          </>
        )}
        {session.status === 'completed' && (
          <button
            className="btn"
            disabled={saveState !== 'saved'}
            onClick={() => navigate(`/history/${session.id}`)}>
            查看记录 <ArrowUpRight />
          </button>
        )}
      </header>
      {(error || state.error) && (
        <div className="session-alert">
          <span>{error || state.error?.message}</span>
          <button
            className="icon-btn"
            aria-label="关闭错误提示"
            onClick={() => {
              setError('');
              dispatch({type: 'error', value: null});
            }}>
            <X size={15} />
          </button>
        </div>
      )}
      {(error || state.error?.stage === 'devices' || state.error?.stage === 'capture') && (
        <AudioPermissions onlyBlocked systemRequired={source === 'both' && !settings.system_device_id} />
      )}
      {saveState === 'offline' && (
        <div className="session-alert">
          <span>同步未完成，已尝试保留本机副本。{saveError}</span>
          <button className="link-button" onClick={() => void retrySave()}>
            重试保存
          </button>
          <button className="link-button" disabled={busy} onClick={() => void saveCopy()}>
            另存新记录
          </button>
          <button className="link-button" onClick={exportRecovery}>
            导出备份
          </button>
        </div>
      )}
      <div className="split-tabs">
        <button
          className={`btn ${pane === 'chat' ? 'active' : ''}`}
          onClick={() => setPane('chat')}>
          对话
        </button>
        <button
          className={`btn ${pane === 'answer' ? 'active' : ''}`}
          onClick={() => setPane('answer')}>
          回答
        </button>
      </div>
      <div className="session-grid" data-pane={pane}>
        <div className="chat-column">
          <header className="panel-header">
            <MessageSquare size={15} />
            <strong>现场对话</strong>
            <span className="muted small">{state.conversation.length} 条</span>
            <span className="spacer" />
            <button
              className="btn btn-quiet"
              onClick={() => {
                setMulti(value => !value);
                setSelected([]);
              }}>
              {multi ? '退出多选' : '合并提问'}
            </button>
            <button className="icon-btn" aria-label="手动添加问题" onClick={() => setManual(true)}>
              <Plus />
            </button>
          </header>
          <div
            className="chat-scroll"
            ref={chatScroll}
            onScroll={() => {
              const el = chatScroll.current;
              if (el) {
                following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 55;
                if (following.current) setNewMessages(false);
              }
            }}>
            {!state.conversation.length && (
              <EmptyState
                icon={<AudioLines size={24} />}
                title={live ? '正在聆听对话' : '对话会保留在这里'}
                text="语音将逐句显示。点击想回答的那句话，右侧展开回答；也可以手动添加问题。"
              />
            )}
            {state.conversation.map(message => (
              <article
                className={`chat-message ${message.role}`}
                key={message.id}
                data-message={message.id}>
                <div className="chat-speaker">
                  <span className="speaker-avatar">
                    {message.role === 'interviewer' ? '面' : '我'}
                  </span>
                  <span>
                    {message.role === 'interviewer' ? '面试官' : '我'} ·{' '}
                    {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {message.status === 'streaming'
                      ? ' · 正在说…'
                      : message.status === 'interrupted'
                        ? ' · 待确认'
                        : message.edited
                          ? ' · 已修正'
                          : ''}
                  </span>
                </div>
                <button
                  className={`chat-bubble ${selected.includes(message.id) ? 'selected' : ''}`}
                  aria-pressed={selected.includes(message.id)}
                  onClick={() => clickMessage(message.id)}>
                  {message.text}
                </button>
                <div className="bubble-actions">
                  {state.answers.some(value => value.source_message_ids.includes(message.id)) && (
                    <span className="bubble-answer-count">
                      <FileText size={11} /> 有回答
                    </span>
                  )}
                  <button
                    className="bubble-edit"
                    aria-label="修正或拆分这句话"
                    onClick={() => {
                      setSplitEditing(false);
                      setEditing({id: message.id, text: message.text});
                    }}>
                    <Pencil size={12} /> 修正 / 拆句
                  </button>
                </div>
              </article>
            ))}
          </div>
          {newMessages && (
            <button
              className="new-messages"
              onClick={() => {
                following.current = true;
                setNewMessages(false);
                if (chatScroll.current)
                  chatScroll.current.scrollTop = chatScroll.current.scrollHeight;
              }}>
              <ArrowDown size={13} />
              有新对话，回到最新
            </button>
          )}
          <footer className="panel-footer">
            {multi ? (
              <>
                <span>已选 {selected.length} 句</span>
                <button
                  className="btn btn-primary"
                  disabled={!selected.length || !live || state.streamState !== 'ready'}
                  onClick={() => request(selected)}>
                  合并回答
                </button>
              </>
            ) : (
              <>
                <span>点击提问 · 已回答原句可直接查看</span>
                <span>
                  {live
                    ? '对话持续更新'
                    : session.status === 'completed'
                      ? '已结束采集'
                      : '已暂停采集'}
                </span>
              </>
            )}
          </footer>
        </div>
        <div className="answer-column">
          <header className="panel-header">
            <FileText size={15} />
            <strong>回答参考</strong>
            <span className="spacer" />
            {state.answers.length > 0 && (
              <select
                aria-label="选择已生成的回答"
                value={answerId || ''}
                onChange={e => chooseAnswer(e.target.value)}>
                {state.answers.map((value, index) => (
                  <option key={value.id} value={value.id}>
                    {index + 1}. {value.question_text.slice(0, 20)}
                  </option>
                ))}
              </select>
            )}
            {answer?.text && (
              <button
                className="icon-btn"
                aria-label="复制回答"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(answer.text)
                    .then(() => toast('已复制', 'success'))
                    .catch(() => toast('复制失败，请手动选择文本', 'error'))
                }>
                <Copy />
              </button>
            )}
          </header>
          <div
            className="answer-scroll"
            ref={answerScroll}
            onScroll={event => {
              if (answerId) answerPositions.current[answerId] = event.currentTarget.scrollTop;
            }}>
            {!answer ? (
              <EmptyState
                icon={<FileText size={24} />}
                title="选一句，展开思路"
                text="回答在这一侧独立显示。左侧继续记录，你可以安心查看当前回答。"
              />
            ) : (
              <div
                className={`answer-document${generating && !answer.text ? ' answer-document-waiting' : ''}`}>
                <div className="answer-question">{answer.question_text}</div>
                {hasRevisedSources(answer, state.conversation) && (
                  <p className="notice">
                    原句已有修正，这里保留的是当时选中的问题与回答。需要时可重新回答。
                  </p>
                )}
                {generating && !answer.text ? (
                  <Loading text="正在整理回答，内容生成后立即显示" />
                ) : (
                  <AnswerBody text={answer.text} />
                )}
                {answer.status === 'error' && (
                  <ErrorState message={answer.error || '生成失败，请重试。'} />
                )}
                <details>
                  <summary>本次回答依据</summary>
                  <p>
                    岗位：{session.role}
                    {session.company ? ` · ${session.company}` : ''}
                    <br />
                    简历：
                    {session.resume_snapshot
                      ? `${session.resume_snapshot.filename} · v${session.resume_snapshot.version}`
                      : '未关联；仅提供通用思路'}
                    <br />
                    问题版本：{answer.source_revisions.join(' / ') || '手动输入'}
                  </p>
                  {session.resume_snapshot && (
                    <p>
                      {typeof answer.context_snapshot?.resume_text === 'string'
                        ? answer.context_snapshot.resume_text
                        : session.resume_snapshot.text}
                    </p>
                  )}
                  <p>回答为参考草稿，请按真实经历表达。简历未提供的细节需自行补充。</p>
                </details>
              </div>
            )}
          </div>
          <footer className="panel-footer">
            <span>
              {answer
                ? {
                    loading: '准备中',
                    streaming: '正在生成',
                    done: '已完成',
                    error: '生成失败',
                    cancelled: '已停止',
                    truncated: '回答未完整',
                  }[answer.status]
                : '等待选择问题'}
              {answer?.first_token_at
                ? ` · 首字 ${((answer.first_token_at - answer.timestamp) / 1000).toFixed(1)}s`
                : ''}
            </span>
            {answer &&
              (generating ? (
                <button className="link-button" onClick={() => cancelAnswer(answer.request_id)}>
                  停止生成
                </button>
              ) : (
                <button
                  className="link-button"
                  disabled={!live || state.streamState !== 'ready'}
                  onClick={() => request(answer.source_message_ids)}>
                  重新回答
                </button>
              ))}
          </footer>
        </div>
      </div>
      <footer className="session-status">
        <div className="audio-status">
          <Mic size={13} />
          <span className="mini-meter">
            <i style={{width: `${Math.min(100, state.levels.mic * 100)}%`}} />
          </span>
          {source === 'both' && (
            <>
              <Monitor size={13} />
              <span className="mini-meter">
                <i style={{width: `${Math.min(100, state.levels.system * 100)}%`}} />
              </span>
            </>
          )}
          <span>
            {state.asrError
              ? '转写异常，请暂停后重试'
              : state.streamState === 'ready'
                ? '音频通道已连接'
                : state.streamState === 'reconnecting'
                  ? '连接恢复中'
                  : live
                    ? '连接异常，请暂停后重试'
                    : '采集已停止'}
          </span>
          {live && echoMode && <span>{microphoneEchoMessage(echoMode)}</span>}
        </div>
        <span className="save-status">
          {saveState === 'saved' ? <Check size={12} /> : null}
          {saveState === 'saved' ? '已同步' : saveState === 'saving' ? '正在保存…' : '等待同步'}
        </span>
      </footer>
      {editing && (
        <Modal title="修正与拆句" onClose={() => setEditing(null)}>
          <div className="segmented sentence-edit-modes" aria-label="编辑方式">
            <button
              className={!splitEditing ? 'active' : ''}
              onClick={() => setSplitEditing(false)}>
              修正文字
            </button>
            <button className={splitEditing ? 'active' : ''} onClick={() => setSplitEditing(true)}>
              按行拆成多句
            </button>
          </div>
          <label className="field">
            {splitEditing ? '每行一句，按回车分开' : '这句话的内容'}
            <textarea
              autoFocus
              rows={6}
              maxLength={16000}
              value={editing.text}
              onChange={e => setEditing({...editing, text: e.target.value})}
            />
            <small>
              {splitEditing
                ? '只按你输入的换行拆分，不会误拆 Node.js、版本号或代码。每一句都可以单独选择。'
                : '保留原有段落。修正后的文字不再被识别结果覆盖。'}{' '}
              已生成的回答保持原样。
            </small>
          </label>
          <div className="form-actions">
            <button className="btn" onClick={() => setEditing(null)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              disabled={
                !editing.text.trim() ||
                (splitEditing &&
                  (editing.text.split(/\n+/).filter(value => value.trim()).length < 2 ||
                    editing.text.split(/\n+/).filter(value => value.trim()).length > 30))
              }
              onClick={() => {
                if (splitEditing)
                  dispatch({
                    type: 'split_message',
                    id: editing.id,
                    parts: editing.text
                      .split(/\n+/)
                      .filter(value => value.trim())
                      .map(text => ({id: genId('split'), text})),
                  });
                else dispatch({type: 'edit_message', id: editing.id, text: editing.text.trim()});
                setEditing(null);
              }}>
              {splitEditing ? '保存并拆分' : '保存修正'}
            </button>
          </div>
        </Modal>
      )}
      {deviceModal && (
        <Modal title="调整本场音频设备" onClose={() => setDeviceModal(false)}>
          <p className="muted small">
            采集已暂停。修改只应用于本场，点击“继续”后重新获取音频权限。
          </p>
          <label className="field">
            麦克风
            <select
              value={settings.microphone_id}
              onChange={event =>
                setSettings(value => ({...value, microphone_id: event.target.value}))
              }>
              <option value="">系统默认麦克风</option>
              {settings.microphone_id &&
                !audioDevices.some(device => device.deviceId === settings.microphone_id) && (
                  <option value={settings.microphone_id}>之前选择的麦克风（暂不可用）</option>
                )}
              {audioDevices.map(device => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                  {device.isVirtual ? ' · 虚拟音频' : ''}
                </option>
              ))}
            </select>
          </label>
          {/Mac/i.test(navigator.userAgent) && (
            <label className="field">
              系统音频
              <select
                value={settings.system_device_id}
                onChange={event =>
                  setSettings(value => ({...value, system_device_id: event.target.value}))
                }>
                <option value="">系统播放声音（屏幕与系统音频权限）</option>
                {settings.system_device_id &&
                  !audioDevices.some(device => device.deviceId === settings.system_device_id) && (
                    <option value={settings.system_device_id}>之前选择的输入（暂不可用）</option>
                  )}
                {audioDevices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                    {device.isVirtual ? ' · 虚拟音频' : ''}
                  </option>
                ))}
              </select>
              <small>已配置虚拟声卡时可选择对应输入；普通麦克风不能代替系统播放声音。</small>
            </label>
          )}
          {isWindows && (
            <label className="field">
              系统音频输出
              <select
                value={settings.system_device_id}
                onChange={event =>
                  setSettings(value => ({...value, system_device_id: event.target.value}))
                }>
                <option value="">系统默认输出</option>
                {settings.system_device_id &&
                  !systemOutputs.some(device => device.id === settings.system_device_id) && (
                    <option value={settings.system_device_id}>之前选择的输出（暂不可用）</option>
                  )}
                {systemOutputs.map(device => (
                  <option key={device.id} value={device.id}>
                    {device.name}
                    {device.isDefault ? ' · 当前默认' : ''}
                  </option>
                ))}
              </select>
              <small>与会议软件使用的扬声器或耳机保持一致；点击“继续”后重新连接。</small>
            </label>
          )}
          {isWindows && outputError && <ErrorState message={outputError} />}
          <div className="form-actions">
            <button className="btn btn-primary" onClick={() => setDeviceModal(false)}>
              完成
            </button>
          </div>
        </Modal>
      )}
      {manual && (
        <Modal title="补充一个问题" onClose={() => setManual(false)}>
          <label className="field">
            面试官的问题
            <textarea
              autoFocus
              rows={5}
              value={manualText}
              onChange={e => setManualText(e.target.value)}
              placeholder="输入或粘贴问题"
              maxLength={10000}
            />
          </label>
          <div className="form-actions">
            <button className="btn" onClick={() => setManual(false)}>
              取消
            </button>
            <button
              className="btn btn-primary"
              disabled={!manualText.trim()}
              onClick={() => {
                dispatch({
                  type: 'add_message',
                  message: {
                    id: genId('manual'),
                    role: 'interviewer',
                    text: manualText.trim(),
                    status: 'done',
                    timestamp: Date.now(),
                    revision: 1,
                  },
                });
                setManualText('');
                setManual(false);
              }}>
              添加到对话
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
