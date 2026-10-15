import {Select, SelectOption} from '../components/Select';
import AnswerBody from '../components/AnswerBody';
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Copy,
  Download,
  FolderPlus,
  ListTree,
  LoaderCircle,
  MessageSquareText,
  Mic,
  RotateCcw,
} from 'lucide-react';
import {
  createResume,
  getJobs,
  getResumes,
  runTool,
  type Job,
  type ResumeVersion,
  type ToolKind,
} from '../api/workspace';
import {messageOf} from '../api/client';
import {ErrorState, Loading} from '../components/WorkspaceUI';
import {useToast} from '../components/Toast';
import {useWorkspaceDraft} from '../utils/WorkspaceDraftContext';

const tools = {
  intro: {
    name: '自我介绍',
    description: '把真实经历整理成适合开场的表达。',
    icon: Mic,
    placeholder: '例如：准备一段 60 秒的自我介绍，突出服务端项目经验。',
  },
  project: {
    name: '项目经历梳理',
    description: '理清职责、技术决策、行动与结果。',
    icon: ListTree,
    placeholder: '描述你参与的项目、亲自负责的工作，以及遇到的具体问题…',
  },
  jd: {
    name: '岗位准备清单',
    description: '从岗位要求找到准备重点与资料缺口。',
    icon: BriefcaseBusiness,
    placeholder: '补充面试轮次、准备时间或希望重点覆盖的方向…',
  },
  answer: {
    name: '回答精炼',
    description: '保留事实，让结论与表达更清楚。',
    icon: MessageSquareText,
    placeholder: '粘贴你原本的回答，或写下想讲清楚的内容…',
  },
};
type ToolDraft = {
  input: string;
  result: string;
  jobId: string;
  resumeId: string;
  error: string;
  busy: boolean;
  saving: boolean;
  saved: boolean;
  generatedFrom: string;
  resultLabel: string;
};
const emptyDraft = (): ToolDraft => ({
  input: '',
  result: '',
  jobId: '',
  resumeId: '',
  error: '',
  busy: false,
  saving: false,
  saved: false,
  generatedFrom: '',
  resultLabel: '',
});
const initialDrafts = (): Record<ToolKind, ToolDraft> => ({
  intro: emptyDraft(),
  project: emptyDraft(),
  jd: emptyDraft(),
  answer: emptyDraft(),
});
const initialKind = () => null as ToolKind | null;
export default function ToolsScreen() {
  const requests = useRef(new Map<ToolKind, AbortController>());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  const [following, setFollowing] = useState(true);
  const [pane, setPane] = useState<'input' | 'output'>('input');
  const scrollToLatest = () => {
    followOutput.current = true;
    setFollowing(true);
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  };
  const [inputError, setInputError] = useState('');
  const [params, setParams] = useSearchParams();
  const [kind, setKind] = useWorkspaceDraft<ToolKind | null>('tools:kind', initialKind);
  const [drafts, setDrafts] = useWorkspaceDraft('tools:drafts', initialDrafts);
  useEffect(() => {
    const active = requests.current;
    setDrafts(old => Object.fromEntries(Object.entries(old).map(([key, value]) => [key, {...value, busy: false, saving: false}])) as typeof old);
    return () => {active.forEach(controller => controller.abort()); active.clear();};
  }, [setDrafts]);
  const [jobs, setJobs] = useState<Job[]>([]),
    [resumes, setResumes] = useState<ResumeVersion[]>([]),
    [sourceError, setSourceError] = useState(''),
    [loadingSources, setLoadingSources] = useState(true),
    [editingResult, setEditingResult] = useState(false);
  const {toast, confirm} = useToast();
  const draft = drafts[kind || 'intro'];
  const {input, result, jobId, resumeId, error, busy, saving, saved} = draft;
  useLayoutEffect(() => {
    if (followOutput.current && outputRef.current && busy) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [result, busy, pane]);
  useEffect(() => {
    setPane('input');
    followOutput.current = true;
    setFollowing(true);
  }, [kind]);
  const update = (patch: Partial<ToolDraft>, key = kind) => {
    if (key) setDrafts(old => ({...old, [key]: {...old[key], ...patch}}));
  };
  const loadSources = useCallback(async () => {
    setSourceError('');
    setLoadingSources(true);
    try {
      const [j, r] = await Promise.all([getJobs(), getResumes()]);
      setJobs(j);
      setResumes(r);
    } catch (e) {
      setSourceError(messageOf(e));
    } finally {
      setLoadingSources(false);
    }
  }, []);
  useEffect(() => {
    void loadSources();
  }, [loadSources]);
  useEffect(() => {
    const requested = params.get('tool') as ToolKind | null;
    if (!requested || !(requested in tools)) return;
    const requestedJob = params.get('job'),
      requestedResume = params.get('resume');
    setKind(requested);
    setEditingResult(false);
    setDrafts(old => ({
      ...old,
      [requested]: {
        ...old[requested],
        ...(requestedJob !== null ? {jobId: requestedJob} : {}),
        ...(requestedResume !== null ? {resumeId: requestedResume} : {}),
        ...(params.get('input') ? {input: params.get('input')!.slice(0, 100000)} : {}),
      },
    }));
    // Consume the entry link once: returning to this tool keeps subsequent edits.
    setParams({}, {replace: true});
  }, [params, setParams, setKind, setDrafts]);
  const selectedJob = jobs.find(value => value.id === jobId),
    selectedResume = resumes.find(value => value.id === resumeId),
    tool = kind ? tools[kind] : null;
  const missingSource = !!((jobId && !selectedJob) || (resumeId && !selectedResume));
  const contextKey = JSON.stringify([
    input.trim(),
    selectedJob?.id || '',
    selectedJob?.title || '',
    selectedJob?.description || '',
    selectedResume?.id || '',
  ]);
  const contextChanged = !!result && !!draft.generatedFrom && draft.generatedFrom !== contextKey;
  const generate = async () => {
    if (!kind || busy || saving || loadingSources) return;
    if (missingSource) {
      update({error: '所选资料已不可用，请重新选择后生成'});
      return;
    }
    if (!input.trim() && !selectedResume && !selectedJob) {
      setInputError('请填写内容，或在上方选择简历或岗位');
      setPane('input');
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    setInputError('');
    const resultLabel = [selectedJob?.title, selectedResume ? `${selectedResume.filename} · v${selectedResume.version}` : ''].filter(Boolean).join(' · ');
    const requestKind = kind;
    let received = false;
    setPane('output');
    followOutput.current = true;
    setFollowing(true);
    const controller = new AbortController();
    requests.current.set(requestKind, controller);
    update({busy: true, error: ''}, requestKind);
    setEditingResult(false);
    try {
      const value = await runTool(requestKind, {
        input: input.trim(),
        role: selectedJob?.title || '',
        job_description: selectedJob?.description || '',
        resume_text: selectedResume?.text || '',
      }, text => {
        if (!controller.signal.aborted && text.trim()) {
          received = true;
          update({result: text, saved: false, generatedFrom: contextKey, resultLabel}, requestKind);
        }
      }, controller.signal);
      if (!value.text.trim()) throw new Error('未收到有效内容，请重试');
      update(
        {
          result: value.text,
          saved: false,
          generatedFrom: contextKey,
          resultLabel,
        },
        requestKind,
      );
    } catch (e) {
      if (requests.current.get(requestKind) === controller) update({error: controller.signal.aborted ? (received ? '已停止生成，已收到的内容已保留。' : '已停止生成，尚未收到新内容。') : messageOf(e)}, requestKind);
    } finally {
      if (requests.current.get(requestKind) === controller) {
        requests.current.delete(requestKind);
        update({busy: false}, requestKind);
      }
    }
  };
  const save = async () => {
    if (!kind || !tool || !result.trim() || busy || saving || saved) return;
    const requestKind = kind;
    update({saving: true, error: ''}, requestKind);
    try {
      const value = await createResume(result, `准备草稿 · ${tool.name}`, 'draft');
      void value;
      update({saved: true}, requestKind);
      toast('已保存到准备草稿，不会混入个人简历', 'success');
    } catch (e) {
      update({error: messageOf(e)}, requestKind);
    } finally {
      update({saving: false}, requestKind);
    }
  };
  const resetDraft = () => {
    if (!kind || busy || saving) return;
    const target = kind;
    confirm(
      '清空这份准备稿？',
      '已保存到“我的资料”的版本会保留。当前输入、选择和未保存的内容会被清空。',
      () => {
        setDrafts(old => ({...old, [target]: emptyDraft()}));
        setEditingResult(false);
        setInputError('');
        setPane('input');
      },
    );
  };
  return (
    <section className="page tools-page">
      <div className="page-heading">
        <div>
          {kind && (
            <button
              className="btn btn-quiet tool-back"
              onClick={() => {
                setKind(null);
                setEditingResult(false);
              }}>
              <ArrowLeft />
              所有工具
            </button>
          )}
          <h1>{tool?.name || '小工具'}</h1>
          <p>{tool?.description || '围绕真实经历准备，留下下次也能用的材料。'}</p>
        </div>
        {kind && (input || result || jobId || resumeId) && (
          <button className="btn btn-quiet" disabled={busy || saving} onClick={resetDraft}>
            <RotateCcw />
            清空
          </button>
        )}
      </div>
      {sourceError && (
        <ErrorState message={`资料加载失败：${sourceError}`} retry={() => void loadSources()} />
      )}
      {kind && error && <ErrorState message={error} />}
      {!kind ? (
        <div className="tools-catalog" role="region" aria-label="小工具列表" tabIndex={0}>
          <div className="tools-grid">
            {(Object.keys(tools) as ToolKind[]).map(key => {
              const value = tools[key],
                previous = drafts[key];
              return (
                <button
                  className="tool-card"
                  key={key}
                  onClick={() => {
                    setKind(key);
                    setInputError('');
                    setEditingResult(false);
                  }}>
                  <span className="tool-card-icon">
                    <value.icon />
                  </span>
                  <div>
                    <h2>{value.name}</h2>
                    <p>{value.description}</p>
                    {(previous.busy || previous.input || previous.result) && (
                      <small className="tool-draft-label">
                        {previous.busy
                          ? '正在整理…'
                          : previous.saved
                            ? '已有准备稿'
                            : '继续未完成的准备稿'}
                      </small>
                    )}
                  </div>
                  <ArrowRight size={15} className="tool-card-arrow" />
                </button>
              );
            })}
          </div>
          <p className="notice tool-draft-note">
            切换页面时保留本次草稿。退出账号或关闭窗口前，请将需要的内容保存到资料。
          </p>
        </div>
      ) : (
        <>
        <div className="pane-switch" role="group" aria-label="显示工具区域">
          <button className="btn" aria-pressed={pane === 'input'} onClick={() => setPane('input')}>填写资料</button>
          <button className="btn" aria-pressed={pane === 'output'} onClick={() => setPane('output')}>准备稿{busy && <LoaderCircle size={14} className="spin" />}</button>
        </div>
        <div className="tool-layout" data-pane={pane}>
          <div className="tool-input">
            <div className="tool-input-scroll" role="region" aria-label="工具输入资料" tabIndex={0}>
            <fieldset className="form-fields" disabled={busy || saving}>
              <label className="field">
                目标岗位
                <Select
                  value={jobId}
                  onValueChange={selectedValue => {update({jobId: selectedValue, error: ''}); setInputError('');}}
                  disabled={loadingSources}>
                  <SelectOption value="">不关联岗位</SelectOption>
                  {jobId && !selectedJob && (
                    <SelectOption value={jobId}>
                      {loadingSources ? '正在加载…' : '所选岗位已不可用，请重新选择'}
                    </SelectOption>
                  )}
                  {jobs.map(value => (
                    <SelectOption key={value.id} value={value.id}>
                      {value.title}
                      {value.company ? ` · ${value.company}` : ''}
                    </SelectOption>
                  ))}
                </Select>
              </label>
              <label className="field">
                参考简历
                <Select
                  value={resumeId}
                  onValueChange={selectedValue => {update({resumeId: selectedValue, error: ''}); setInputError('');}}
                  disabled={loadingSources}>
                  <SelectOption value="">不关联简历</SelectOption>
                  {resumeId && !selectedResume && (
                    <SelectOption value={resumeId}>
                      {loadingSources ? '正在加载…' : '所选简历已不可用，请重新选择'}
                    </SelectOption>
                  )}
                  {resumes.map(value => (
                    <SelectOption key={value.id} value={value.id}>
                      {value.filename} · v{value.version}
                    </SelectOption>
                  ))}
                </Select>
              </label>
              <label className="field">
                {kind === 'answer' ? '原始回答' : '补充内容'}
                <textarea
                  ref={inputRef}
                  aria-invalid={!!inputError}
                  aria-describedby={inputError ? 'tool-input-error' : undefined}
                  rows={9}
                  value={input}
                  onChange={e => {update({input: e.target.value}); setInputError('');}}
                  placeholder={tool?.placeholder}
                />
                {inputError && <small id="tool-input-error" className="field-error" role="alert">{inputError}</small>}
              </label>
            </fieldset>
            </div>
            <div className="tool-input-actions">
            <button
              className="btn btn-primary"
              disabled={busy || saving || loadingSources || !!sourceError}
              onClick={() => void generate()}>
              {busy ? <LoaderCircle className="spin" /> : <ArrowRight />}
              {busy ? '正在整理…' : result ? '重新生成' : '生成内容'}
            </button>
            {busy && (
              <p className="muted small tool-busy-note" role="status">
                内容正在逐步显示。离开此页会停止生成，已收到的内容会保留。
              </p>
            )}
            </div>
          </div>
          <div className="tool-output" aria-busy={busy}>
            <div className="tool-output-heading">
              <h2>准备稿</h2>
              {busy ? <button className="btn btn-quiet" onClick={() => kind && requests.current.get(kind)?.abort()}>停止生成</button> : result && (
                <button
                  className="btn btn-quiet"
                  disabled={busy || saving}
                  onClick={() => setEditingResult(value => !value)}>
                  {editingResult ? '完成编辑' : '编辑'}
                </button>
              )}
            </div>
            <div className="tool-output-scroll" ref={outputRef} role="region" aria-label="准备稿内容" tabIndex={0}
              onScroll={event => {
                const target = event.currentTarget;
                const nearBottom = target.scrollHeight - target.clientHeight - target.scrollTop < 64;
                followOutput.current = nearBottom;
                setFollowing(nearBottom);
              }}>
            {result ? (
              <>
                {draft.resultLabel && (
                  <p className="tool-result-context">依据：{draft.resultLabel}</p>
                )}
                {contextChanged && (
                  <p className="notice tool-context-change">
                    输入或参考资料已修改。下方仍是上一次准备稿，重新生成后更新。
                  </p>
                )}
                {busy && (
                  <p className="notice" role="status">
                    正在生成，内容持续更新…
                  </p>
                )}
                {editingResult ? (
                  <textarea
                    autoFocus
                    className="tool-result-editor"
                    aria-label="编辑准备稿"
                    value={result}
                    disabled={busy || saving}
                    onChange={e => update({result: e.target.value, saved: false})}
                  />
                ) : (
                  <div className="tool-result">
                    <AnswerBody text={result} />
                  </div>
                )}
                <p className="notice">
                  检查并补充真实经历后再保存。保存会创建独立文本资料版本，不覆盖现有简历，也不自动关联当前面试。
                </p>

              </>
            ) : busy ? (
              <Loading text="正在根据所选资料生成内容…" />
            ) : (
              <div className="empty-state">
                <p>生成后可以编辑、复制，或保存到我的资料。</p>
              </div>
            )}
            </div>
            {busy && !following && <button className="btn tool-latest" onClick={scrollToLatest}>回到最新内容 ↓</button>}
            {result && (
                <footer>
                  <button
                    className="btn"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(result)
                        .then(() => toast('已复制', 'success'))
                        .catch(() => toast('复制失败，请直接选中文字复制', 'error'))
                    }>
                    <Copy />
                    复制
                  </button>
                  <button
                    className="btn"
                    disabled={!result.trim()}
                    onClick={() => {
                      if (!tool || !result.trim()) return;
                      const content = [
                        tool.name,
                        draft.resultLabel ? `参考资料：${draft.resultLabel}` : '',
                        result,
                      ]
                        .filter(Boolean)
                        .join('\n\n');
                      const url = URL.createObjectURL(
                        new Blob([content], {type: 'text/plain;charset=utf-8'}),
                      );
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = `${tool.name}-准备稿.txt`;
                      link.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }}>
                    <Download />
                    下载文本
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={busy || saving || saved || !result.trim()}
                    onClick={() => void save()}>
                    {saving ? <LoaderCircle className="spin" /> : <FolderPlus />}
                    {saving ? '正在保存…' : saved ? '已保存到资料' : '保存为文本资料'}
                  </button>
                </footer>
            )}
          </div>
        </div>
        </>
      )}
    </section>
  );
}
