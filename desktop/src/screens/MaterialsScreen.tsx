import {IconButton} from '../components/IconButton';
import {Select, SelectOption} from '../components/Select';
import {useCallback, useEffect, useRef, useState, type FormEvent} from 'react';
import {
  ArrowUpRight,
  BriefcaseBusiness,
  FileText,
  Files,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {
  createJob,
  createResume,
  deleteJob,
  getJobs,
  getResumes,
  updateJob,
  uploadResumeVersion,
  type Job,
  type JobInput,
  type ResumeVersion,
} from '../api/workspace';
import {messageOf} from '../api/client';
import {dateLabel, EmptyState, ErrorState, Loading, Modal} from '../components/WorkspaceUI';
import {useToast} from '../components/Toast';
import {groupResumeVersions, normalizeJob, sameResumeContent} from '../utils/workspaceForms';
const blankJob: JobInput = {title: '', company: '', description: '', programming_language: ''};
export default function MaterialsScreen() {
  const navigate = useNavigate();
  const [resumes, setResumes] = useState<ResumeVersion[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [modal, setModal] = useState<'resume' | 'job' | null>(null),
    [resumeText, setResumeText] = useState(''),
    [filename, setFilename] = useState('个人简历'),
    [job, setJob] = useState<JobInput>(blankJob),
    [editingId, setEditingId] = useState<string | null>(null),
    [originalResume, setOriginalResume] = useState<ResumeVersion | null>(null),
    [originalJob, setOriginalJob] = useState<JobInput | null>(null),
    [query, setQuery] = useState(''),
    [deletingId, setDeletingId] = useState<string | null>(null);
  const [materialKind, setMaterialKind] = useState<NonNullable<ResumeVersion['kind']>>('resume');
  const [filterKind, setFilterKind] = useState('all');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const verifiedPromotion = useRef(false);
  const editorForm = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false),
    [formError, setFormError] = useState(''),
    [uploading, setUploading] = useState(false),
    [view, setView] = useState<ResumeVersion | null>(null);
  const input = useRef<HTMLInputElement>(null),
    {toast, confirm} = useToast();
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [r, j] = await Promise.all([getResumes(true), getJobs()]);
      setResumes(r);
      setJobs(j);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const editResume = (resume?: ResumeVersion) => {
    verifiedPromotion.current = false;
    setOriginalResume(resume || null);
    setMaterialKind(resume?.kind || 'resume');
    setResumeText(resume?.text || '');
    setFilename(resume?.filename || '个人简历');
    setFormError('');
    setFieldErrors({});
    setModal('resume');
  };
  const editJob = (value?: Job) => {
    setOriginalJob(value ? normalizeJob(value) : null);
    setJob(
      value
        ? {
            title: value.title,
            company: value.company,
            description: value.description,
            programming_language: value.programming_language,
          }
        : blankJob,
    );
    setEditingId(value?.id || null);
    setFormError('');
    setFieldErrors({});
    setModal('job');
  };
  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving || !modal) return;
    const invalid: Record<string, string> = {};
    if (modal === 'resume') {
      if (!filename.trim()) invalid.filename = '请填写资料名称';
      if (!resumeText.trim()) invalid.resumeText = '请填写简历正文';
    } else if (!job.title.trim()) invalid.title = '请填写岗位名称';
    setFieldErrors(invalid);
    const first = Object.keys(invalid)[0];
    if (first) {
      (editorForm.current?.elements.namedItem(first) as HTMLElement | null)?.focus();
      return;
    }
    if (unchanged) return;
    if (modal === 'resume' && originalResume?.kind === 'draft' && materialKind !== 'draft' && !verifiedPromotion.current) {
      confirm('确认这些经历真实？', '请确认正文中的任职、职责、技术选型和指标均有事实依据。原准备草稿会保留，另存为核实后的新版本。', () => {
        verifiedPromotion.current = true;
        editorForm.current?.requestSubmit();
      });
      return;
    }
    verifiedPromotion.current = false;
    setSaving(true);
    setFormError('');
    try {
      if (modal === 'resume') {
        const resume = await createResume(resumeText.trim(), filename.trim(), materialKind);
        setResumes(old => [resume, ...old]);
        toast('已保存为新的资料版本', 'success');
      } else {
        const normalized = normalizeJob(job);
        const result = editingId
          ? await updateJob(editingId, normalized)
          : await createJob(normalized);
        setJobs(old =>
          editingId
            ? old.map(value => (value.id === editingId ? result : value))
            : [result, ...old],
        );
        toast('岗位已保存', 'success');
      }
      setModal(null);
    } catch (e) {
      setFormError(messageOf(e));
    } finally {
      setSaving(false);
    }
  }
  async function upload(file?: File) {
    if (!file || uploading) return;
    if (!/\.(pdf|docx|txt)$/i.test(file.name)) {
      setError('支持 PDF、DOCX 和 TXT 简历，请选择对应文件。');
      if (input.current) input.current.value = '';
      return;
    }
    if (file.size === 0 || file.size > 10 * 1024 * 1024) {
      setError(file.size === 0 ? '文件为空，请选择包含文字的简历。' : '文件不能超过 10 MB。');
      if (input.current) input.current.value = '';
      return;
    }
    setUploading(true);
    setError('');
    try {
      const resume = await uploadResumeVersion(file);
      setResumes(old => [resume, ...old]);
      toast('简历已解析并保存，请检查提取内容', 'success');
      setView(resume);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  }
  const removeJob = (item: Job) =>
    confirm('删除岗位？', `删除“${item.title}”。历史面试中已保存的岗位信息仍会保留。`, () => {
      setDeletingId(item.id);
      return deleteJob(item.id)
        .then(() => {
          setJobs(old => old.filter(value => value.id !== item.id));
          toast('岗位已删除', 'success');
        })
        .finally(() => setDeletingId(null));
    });
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredResumes = resumes.filter(value =>
    (filterKind === 'all' || (value.kind || 'resume') === filterKind) && `${value.filename} ${value.text}`.toLocaleLowerCase().includes(normalizedQuery),
  );
  const filteredJobs = jobs.filter(value =>
    `${value.title} ${value.company} ${value.description}`
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );
  const unchanged =
    modal === 'resume'
      ? sameResumeContent(originalResume, filename, resumeText) && materialKind === (originalResume?.kind || 'resume')
      : !!originalJob && JSON.stringify(normalizeJob(job)) === JSON.stringify(originalJob);
  const formChanged =
    modal === 'resume'
      ? originalResume
        ? !unchanged
        : !!resumeText.trim() || filename !== '个人简历'
      : originalJob
        ? !unchanged
        : JSON.stringify(normalizeJob(job)) !== JSON.stringify(blankJob);
  const closeEditor = () => {
    if (saving) return;
    if (formChanged) confirm('放弃本次编辑？', '尚未保存的修改会被丢弃。', () => setModal(null));
    else setModal(null);
  };
  return (
    <section className="page collection-page">
      <div className="page-heading">
        <div>
          <h1>我的资料</h1>
          <p>让回答贴合你的真实经历，每场面试保留自己的资料版本。</p>
        </div>
        <div className="page-heading-actions">
          <input
            ref={input}
            type="file"
            accept=".pdf,.docx,.txt"
            hidden
            onChange={e => void upload(e.target.files?.[0])}
          />
          <button className="btn" disabled={uploading} onClick={() => input.current?.click()}>
            {uploading ? <LoaderCircle className="spin" /> : <Upload />}
            {uploading ? '正在解析…' : '上传简历'}
          </button>
          <button className="btn btn-primary" onClick={() => editResume()}>
            <Plus />
            粘贴简历
          </button>
        </div>
      </div>
      <div className="materials-toolbar">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="搜索简历或岗位"
            placeholder="搜索简历、公司或岗位内容…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && (
            <IconButton className="icon-btn" aria-label="清空搜索" onClick={() => setQuery('')}>
              <X size={14} />
            </IconButton>
          )}
        </label>
        <Select aria-label="资料类型" value={filterKind} onValueChange={setFilterKind}>
          <SelectOption value="all">全部资料</SelectOption><SelectOption value="resume">个人简历</SelectOption>
          <SelectOption value="experience">已核实经历</SelectOption><SelectOption value="draft">准备草稿</SelectOption>
        </Select>
      </div>
      {error && <ErrorState message={error} retry={() => void load()} />}{' '}
      <div className="collection-scroll">
      {loading ? (
        <Loading />
      ) : (
        <div className="materials-grid">
          <div>
            <div className="section-heading">
              <h2>个人资料与准备稿</h2>
              <span>{resumes.length} 个版本</span>
            </div>
            {!resumes.length ? (
              <EmptyState
                icon={<Files size={22} />}
                title="先添加你的经历"
                text="上传 PDF、DOCX、TXT 或粘贴文本，解析后可检查和更正。"
              />
            ) : !filteredResumes.length ? (
              <div className="search-empty">没有匹配的简历版本</div>
            ) : (
              groupResumeVersions(filteredResumes).map(([resume, ...older]) => (
                <article className="material-card" key={resume.id}>
                  <div className="material-card-head">
                    <FileText size={21} />
                    <div>
                      <h3>{resume.filename}</h3>
                      <small>{resume.kind === 'draft' ? '准备草稿 · 不作为简历事实' : resume.kind === 'experience' ? '已核实经历' : '个人简历'} · {dateLabel(resume.created_at)} 保存</small>
                    </div>
                    <span className="material-version">v{resume.version}</span>
                  </div>
                  <p>{resume.text}</p>
                  <footer>
                    <button className="btn btn-quiet" onClick={() => setView(resume)}>
                      查看内容
                    </button>
                    <button
                      className="btn btn-quiet"
                      onClick={() =>
                        navigate(resume.kind === 'draft' ? `/tools?tool=answer&input=${encodeURIComponent(resume.text.slice(0, 8000))}` : `/tools?tool=intro&resume=${encodeURIComponent(resume.id)}`)
                      }>
                      <ArrowUpRight />
                      用于准备
                    </button>
                    <button className="btn" onClick={() => editResume(resume)}>
                      <Pencil />
                      修改为新版本
                    </button>
                  </footer>
                  {!!older.length && (
                    <details className="material-versions">
                      <summary>查看 {older.length} 个同名旧版本</summary>
                      <div>
                        {older.map(version => (
                          <button key={version.id} onClick={() => setView(version)}>
                            <span>v{version.version}</span>
                            <span>{dateLabel(version.created_at)} 保存</span>
                            <span>查看</span>
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                </article>
              ))
            )}
          </div>
          <div>
            <div className="section-heading">
              <h2>目标岗位</h2>
              <button className="btn btn-quiet" onClick={() => editJob()}>
                <Plus />
                添加岗位
              </button>
            </div>
            {!jobs.length ? (
              <EmptyState
                icon={<BriefcaseBusiness size={23} />}
                title="保存目标岗位"
                text="关联岗位描述后，回答可以突出对应的技术要求和项目经历。"
                action={
                  <button className="btn" onClick={() => editJob()}>
                    添加岗位
                  </button>
                }
              />
            ) : !filteredJobs.length ? (
              <div className="search-empty">没有匹配的岗位</div>
            ) : (
              filteredJobs.map(item => (
                <article className="material-card" key={item.id}>
                  <div className="material-card-head">
                    <BriefcaseBusiness size={21} />
                    <div>
                      <h3>{item.title}</h3>
                      <small>{item.company || '未填写公司'}</small>
                    </div>
                  </div>
                  <p>{item.description || '尚未填写岗位描述'}</p>
                  <footer>
                    <IconButton
                      className="icon-btn"
                      aria-label={`删除${item.title}`}
                      disabled={!!deletingId}
                      onClick={() => removeJob(item)}>
                      {deletingId === item.id ? <LoaderCircle className="spin" /> : <Trash2 />}
                    </IconButton>
                    <button
                      className="btn btn-quiet"
                      onClick={() => navigate(`/tools?tool=jd&job=${encodeURIComponent(item.id)}`)}>
                      <ArrowUpRight />
                      用于准备
                    </button>
                    <button className="btn" onClick={() => editJob(item)}>
                      <Pencil />
                      编辑岗位
                    </button>
                  </footer>
                </article>
              ))
            )}
          </div>
        </div>
      )}
      </div>
      {modal && (
        <Modal
          title={modal === 'resume' ? '保存资料版本' : editingId ? '编辑岗位' : '添加岗位'}
          busy={saving}
          onClose={closeEditor}>
          <form ref={editorForm} onSubmit={save} noValidate>
            <fieldset disabled={saving} className="form-fields">
              {modal === 'resume' ? (
                <>
                  <label className="field">资料类型
                    <Select value={materialKind} onValueChange={value => setMaterialKind(value as typeof materialKind)}>
                      <SelectOption value="resume">个人简历</SelectOption><SelectOption value="experience">已核实经历</SelectOption><SelectOption value="draft">准备草稿</SelectOption>
                    </Select>
                    <small>{materialKind === 'draft' ? 'AI 准备内容单独保存，不会作为面试中的真实经历。' : '仅保存你确认真实的经历。请删除 AI 推测的职责、指标和结果。'}</small>
                  </label>
                  <label className="field">
                    资料名称
                    <input
                      required
                      maxLength={200}
                      name="filename"
                      aria-invalid={!!fieldErrors.filename}
                      aria-describedby={fieldErrors.filename ? "material-filename-error" : undefined}
                      value={filename}
                      onChange={e => {setFilename(e.target.value); setFieldErrors(old => ({...old, filename: ''}));}}
                    />
                    {fieldErrors.filename && <small className="field-error" id="material-filename-error" role="alert">{fieldErrors.filename}</small>}
                  </label>
                  <label className="field">
                    简历正文
                    <textarea
                      required
                      rows={12}
                      name="resumeText"
                      aria-invalid={!!fieldErrors.resumeText}
                      aria-describedby={fieldErrors.resumeText ? "material-resumeText-error" : undefined}
                      value={resumeText}
                      onChange={e => {setResumeText(e.target.value); setFieldErrors(old => ({...old, resumeText: ''}));}}
                      placeholder="粘贴教育背景、工作与项目经历…"
                    />
                    {fieldErrors.resumeText && <small className="field-error" id="material-resumeText-error" role="alert">{fieldErrors.resumeText}</small>}
                    <small>保存会创建新版本，不覆盖旧面试关联的内容。</small>
                  </label>
                </>
              ) : (
                <>
                  <label className="field">
                    岗位名称
                    <input
                      required
                      maxLength={200}
                      name="title"
                      aria-invalid={!!fieldErrors.title}
                      aria-describedby={fieldErrors.title ? "material-title-error" : undefined}
                      value={job.title}
                      onChange={e => {setJob({...job, title: e.target.value}); setFieldErrors(old => ({...old, title: ''}));}}
                    />
                    {fieldErrors.title && <small className="field-error" id="material-title-error" role="alert">{fieldErrors.title}</small>}
                  </label>
                  <label className="field">
                    公司
                    <input
                      maxLength={200}
                      value={job.company}
                      onChange={e => setJob({...job, company: e.target.value})}
                    />
                  </label>
                  <label className="field">
                    岗位描述
                    <textarea
                      rows={8}
                      value={job.description}
                      onChange={e => setJob({...job, description: e.target.value})}
                      placeholder="粘贴职责、技术要求和任职条件…"
                    />
                  </label>
                  <label className="field">
                    主要技术语言
                    <Select
                      value={job.programming_language || ''}
                      onValueChange={selectedValue => setJob({...job, programming_language: selectedValue})}>
                      <SelectOption value="">不指定</SelectOption>
                      {['Java', 'JavaScript', 'TypeScript', 'Python', 'Go', 'C++', 'C#'].map(
                        value => (
                          <SelectOption key={value}>{value}</SelectOption>
                        ),
                      )}
                    </Select>
                  </label>
                </>
              )}
            </fieldset>
            {formError && <ErrorState message={formError} />}
            {unchanged && <p className="muted small">内容尚未修改，无需重复保存。</p>}
            <div className="form-actions">
              <button type="button" className="btn" disabled={saving} onClick={closeEditor}>
                取消
              </button>
              <button className="btn btn-primary" disabled={saving || unchanged}>
                {saving && <LoaderCircle className="spin" />}
                {saving ? '正在保存…' : '保存'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {view && (
        <Modal title={`${view.filename} · v${view.version}`} onClose={() => setView(null)}>
          <p className="text-document">{view.text}</p>
          <div className="form-actions">
            <button
              className="btn"
              onClick={() => {
                editResume(view);
                setView(null);
              }}>
              更正为新版本
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
