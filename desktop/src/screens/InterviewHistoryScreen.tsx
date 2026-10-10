import {useCallback, useContext, useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {FileClock, History, Plus, RefreshCw, Search, Trash2} from 'lucide-react';
import {
  deleteWorkspaceInterview,
  getWorkspaceInterviews,
  type SessionSummary,
  type WorkspaceSession,
} from '../api/workspace';
import {messageOf} from '../api/client';
import {dateLabel, durationLabel, EmptyState, ErrorState, Loading} from '../components/WorkspaceUI';
import {AuthContext} from '../utils/AuthContext';
import {loadDrafts, removeDraft} from '../services/drafts';
import {useToast} from '../components/Toast';
import './interview.css';
export default function InterviewHistoryScreen() {
  const [records, setRecords] = useState<SessionSummary[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState('all');
  const [drafts, setDrafts] = useState<WorkspaceSession[]>([]),
    [localError, setLocalError] = useState(''),
    [deleting, setDeleting] = useState<string[]>([]);
  const navigate = useNavigate(),
    {confirm, toast} = useToast(),
    {profile} = useContext(AuthContext);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setLocalError('');
    try {
      const [remote, local] = await Promise.allSettled([
        getWorkspaceInterviews(),
        profile?.email
          ? loadDrafts(profile.email, count =>
              setLocalError(`${count} 份本机副本无法读取，原文件已保留。`),
            )
          : Promise.resolve([]),
      ]);
      if (remote.status === 'fulfilled') setRecords(remote.value);
      else {
        setRecords([]);
        setError(messageOf(remote.reason));
      }
      if (local.status === 'fulfilled') setDrafts(local.value);
      else setLocalError(messageOf(local.reason));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, [profile?.email]);
  useEffect(() => {
    void load();
  }, [load]);
  const filtered = records.filter(
    record =>
      (status === 'all' || record.status === status) &&
      `${record.title} ${record.company} ${record.role}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const recoverable = drafts.filter(draft => {
    const remote = records.find(value => value.id === draft.id);
    return !remote || draft.revision > remote.revision;
  });
  const labels = {active: '待继续', completed: '已结束', interrupted: '待继续'};
  const remove = (record: SessionSummary) =>
    confirm('删除这场面试？', `“${record.title}”的对话与回答将删除，此操作无法撤销。`, () => {
      setDeleting(values => [...values, record.id]);
      void deleteWorkspaceInterview(record.id)
        .then(async () => {
          setRecords(old => old.filter(item => item.id !== record.id));
          try {
            if (profile?.email) await removeDraft(profile.email, record.id);
            setDrafts(values => values.filter(value => value.id !== record.id));
            toast('面试记录已删除', 'success');
          } catch {
            toast('服务器记录已删除，本机恢复副本清理失败，请重试清理', 'warning');
          }
        })
        .catch(e => toast(messageOf(e), 'error'))
        .finally(() => setDeleting(values => values.filter(value => value !== record.id)));
    });
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <h1>面试记录</h1>
          <p>每一场的对话、回答和准备资料。</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/interview')}>
          <Plus />
          新建面试
        </button>
      </div>
      {!loading && recoverable.length > 0 && (
        <div className="history-recovery">
          <div className="history-recovery-heading">
            <FileClock size={17} />
            <div>
              <strong>本机还有 {recoverable.length} 份恢复副本</strong>
              <p>有内容尚未确认同步，可以先恢复查看。</p>
            </div>
          </div>
          {recoverable.map(value => (
            <div className="history-recovery-row" key={value.id}>
              <span>
                <strong>{value.title}</strong>
                <small>
                  {value.conversation.length} 条对话 · {durationLabel(value.duration_seconds)}
                </small>
              </span>
              <button className="btn" onClick={() => navigate(`/interview?draft=${value.id}`)}>
                恢复查看
              </button>
            </div>
          ))}
        </div>
      )}
      {localError && <p className="notice">{localError}</p>}
      <div className="list-toolbar">
        <label className="search-input">
          <Search />
          <input
            aria-label="搜索面试记录"
            placeholder="搜索面试名称、公司或岗位"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </label>
        <span className="spacer" />
        <span className="muted small record-count">{filtered.length} 场</span>
        <select aria-label="按状态筛选" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">全部状态</option>
          <option value="active">未结束</option>
          <option value="completed">已结束</option>
          <option value="interrupted">已暂停</option>
        </select>
        <button
          className="icon-btn"
          title="刷新记录"
          aria-label="刷新记录"
          disabled={loading}
          onClick={() => void load()}>
          <RefreshCw size={15} />
        </button>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} retry={() => void load()} />
      ) : filtered.length ? (
        <table className="records">
          <thead>
            <tr>
              <th>面试</th>
              <th className="record-role">目标岗位</th>
              <th className="record-date">日期</th>
              <th className="record-duration">时长</th>
              <th>状态</th>
              <th aria-label="操作" />
            </tr>
          </thead>
          <tbody>
            {filtered.map(record => (
              <tr key={record.id}>
                <td>
                  <button className="record-name" onClick={() => navigate(`/history/${record.id}`)}>
                    <span className="record-icon">
                      {Array.from(record.company || record.title || '面试')[0]}
                    </span>
                    <span>
                      <strong>{record.title}</strong>
                      <small>
                        {record.company || '未填写公司'} · {record.message_count} 条对话 ·{' '}
                        {record.answer_count} 份回答
                      </small>
                    </span>
                  </button>
                </td>
                <td className="record-role">{record.role || '未关联岗位'}</td>
                <td className="record-date">{dateLabel(record.started_at)}</td>
                <td className="record-duration">{durationLabel(record.duration_seconds)}</td>
                <td>
                  <span className={`status-tag ${record.status}`}>
                    <i className="status-dot" />
                    {labels[record.status]}
                  </span>
                </td>
                <td className="row-actions">
                  <button
                    className="icon-btn"
                    disabled={deleting.includes(record.id)}
                    aria-label={`删除 ${record.title}`}
                    onClick={() => remove(record)}>
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState
          icon={<History size={24} />}
          title={records.length ? '没有匹配的面试' : '你的第一场面试，从这里开始'}
          text={records.length ? '试试其他关键词或状态。' : '选择岗位与简历，开始记录对话和回答。'}
          action={
            !records.length && (
              <button className="btn" onClick={() => navigate('/interview')}>
                准备一场面试
              </button>
            )
          }
        />
      )}
    </section>
  );
}
