import AnswerBody from '../components/AnswerBody';
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {useNavigate, useParams} from 'react-router-dom';
import {ArrowLeft, Copy, Download, FileText, LocateFixed, Play, Search, X} from 'lucide-react';
import {generateReview, getWorkspaceInterview, type WorkspaceSession} from '../api/workspace';
import {messageOf} from '../api/client';
import {
  dateLabel,
  durationLabel,
  EmptyState,
  ErrorState,
  Loading,
  Modal,
} from '../components/WorkspaceUI';
import {useToast} from '../components/Toast';
import {hasRevisedSources, sentenceLabel} from '../services/conversation';
import './interview.css';
export default function InterviewDetailScreen() {
  const {id} = useParams(),
    navigate = useNavigate(),
    {toast} = useToast();
  const [session, setSession] = useState<WorkspaceSession | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [selected, setSelected] = useState(''),
    [tab, setTab] = useState<'answer' | 'review'>('answer'),
    [pane, setPane] = useState<'chat' | 'answer'>('chat');
  const [review, setReview] = useState(''),
    [reviewing, setReviewing] = useState(false),
    [context, setContext] = useState(false);
  const [query, setQuery] = useState(''),
    [answeredOnly, setAnsweredOnly] = useState(false);
  const answerScroll = useRef<HTMLDivElement>(null),
    chatScroll = useRef<HTMLDivElement>(null),
    loadEpoch = useRef(0),
    locatePending = useRef(false),
    positions = useRef<Record<string, number>>({});
  const load = useCallback(async () => {
    if (!id) return;
    const epoch = ++loadEpoch.current;
    setLoading(true);
    setError('');
    try {
      const value = await getWorkspaceInterview(id);
      if (epoch !== loadEpoch.current) return;
      setSession(value);
      setSelected(value.answers[0]?.id || '');
      setReview(value.review?.text || '');
      positions.current = {};
      setQuery('');
      setAnsweredOnly(false);
      setTab('answer');
      setReviewing(false);
    } catch (e) {
      if (epoch === loadEpoch.current) setError(messageOf(e));
    } finally {
      if (epoch === loadEpoch.current) setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
    return () => {
      loadEpoch.current++;
    };
  }, [load]);
  const answer = session?.answers.find(value => value.id === selected);
  const positionKey = tab === 'review' ? 'review' : selected;
  useLayoutEffect(() => {
    if (answerScroll.current) answerScroll.current.scrollTop = positions.current[positionKey] || 0;
  }, [positionKey]);
  useLayoutEffect(() => {
    if (!locatePending.current || !answer) return;
    locatePending.current = false;
    const first = Array.from(
      chatScroll.current?.querySelectorAll<HTMLElement>('[data-message]') || [],
    ).find(element => answer.source_message_ids.includes(element.dataset.message || ''));
    first?.scrollIntoView({block: 'nearest'});
  }, [selected, query, answeredOnly, pane, answer]);
  const locate = () => {
    locatePending.current = true;
    setQuery('');
    setAnsweredOnly(false);
    setPane('chat');
    requestAnimationFrame(() => {
      if (!locatePending.current || !answer) return;
      locatePending.current = false;
      Array.from(chatScroll.current?.querySelectorAll<HTMLElement>('[data-message]') || [])
        .find(element => answer.source_message_ids.includes(element.dataset.message || ''))
        ?.scrollIntoView({block: 'nearest'});
    });
  };
  const choose = (answerId: string) => {
    setSelected(answerId);
    setTab('answer');
    setPane('answer');
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制', 'success');
    } catch {
      toast('无法访问剪贴板，可以直接选中文字复制', 'error');
    }
  };
  async function makeReview() {
    if (!id) return;
    const epoch = loadEpoch.current;
    setReviewing(true);
    try {
      const result = await generateReview(id);
      if (epoch === loadEpoch.current) setReview(result.text);
    } catch (e) {
      if (epoch === loadEpoch.current) toast(messageOf(e), 'error');
    } finally {
      if (epoch === loadEpoch.current) setReviewing(false);
    }
  }
  const exportText = () => {
    if (!session) return;
    const text = [
      session.title,
      `${session.role} · ${new Date(session.started_at).toLocaleString()}`,
      '\n对话',
      ...session.conversation.map(
        value =>
          `${value.role === 'interviewer' ? '对方' : value.role === 'user' ? '我' : '历史建议'}${sentenceLabel(value.status) ? '（' + sentenceLabel(value.status) + '）' : ''}：${value.text}`,
      ),
      '\n回答',
      ...session.answers.map(
        value =>
          `问题：${value.question_text}${value.status !== 'done' ? '\n（回答未完整结束）' : ''}\n${value.text}`,
      ),
      review ? `\n复盘\n${review}` : '',
    ].join('\n\n');
    const url = URL.createObjectURL(new Blob([text], {type: 'text/plain;charset=utf-8'}));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.title.replace(/[\\/:*?"<>|]/g, '_')}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (loading) return <Loading />;
  if (error)
    return (
      <section className="page">
        <button className="btn" onClick={() => navigate('/history')}>
          <ArrowLeft />
          返回记录
        </button>
        <ErrorState message={error} retry={() => void load()} />
      </section>
    );
  if (!session) return null;
  const messages = session.conversation.filter(message => message.role !== 'ai');
  const filteredMessages = messages.filter(
    message =>
      message.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
      (!answeredOnly ||
        session.answers.some(value => value.source_message_ids.includes(message.id))),
  );
  const contextText = (key: string, fallback: string) =>
    typeof answer?.context_snapshot?.[key] === 'string'
      ? (answer.context_snapshot[key] as string)
      : fallback;
  return (
    <section className="session-page">
      <header className="session-toolbar">
        <button className="btn btn-quiet" onClick={() => navigate('/history')}>
          <ArrowLeft />
          面试记录
        </button>
        <h1>{session.title}</h1>
        <span className="muted small">
          {dateLabel(session.started_at)} · {durationLabel(session.duration_seconds)}
        </span>
        <span className="spacer" />
        <button className="btn btn-quiet" onClick={() => setContext(true)}>
          <FileText />
          {session.role || '本场资料'}
          {session.resume_snapshot ? ` · v${session.resume_snapshot.version}` : ''}
        </button>
        <button className="icon-btn" aria-label="导出文本" onClick={exportText}>
          <Download />
        </button>
        {session.status !== 'completed' && (
          <button
            className="btn btn-primary"
            onClick={() => navigate(`/interview?session=${session.id}`)}>
            <Play />
            继续面试
          </button>
        )}
      </header>
      <div className="split-tabs">
        <button
          className={`btn ${pane === 'chat' ? 'active' : ''}`}
          onClick={() => setPane('chat')}>
          对话
        </button>
        <button
          className={`btn ${pane === 'answer' ? 'active' : ''}`}
          onClick={() => setPane('answer')}>
          回答与复盘
        </button>
      </div>
      <div className="session-grid" data-pane={pane}>
        <div className="chat-column">
          <header className="panel-header">
            <strong>完整对话</strong>
            <span className="spacer" />
            <span className="muted small">
              {filteredMessages.length} / {messages.length} 条
            </span>
          </header>
          <div className="transcript-tools">
            <label className="search-input">
              <Search size={14} />
              <input
                aria-label="搜索本场对话"
                placeholder="查找问题或关键词"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
              {query && (
                <button className="icon-btn" aria-label="清除对话搜索" onClick={() => setQuery('')}>
                  <X size={13} />
                </button>
              )}
            </label>
            <button
              className={`transcript-filter ${answeredOnly ? 'active' : ''}`}
              aria-pressed={answeredOnly}
              onClick={() => setAnsweredOnly(value => !value)}>
              有回答
            </button>
          </div>
          <div className="chat-scroll" ref={chatScroll}>
            {filteredMessages.length ? (
              filteredMessages.map(message => {
                const related = session.answers.filter(value =>
                  value.source_message_ids.includes(message.id),
                );
                return (
                  <article
                    key={message.id}
                    data-message={message.id}
                    className={`chat-message ${message.role === 'user' ? 'user' : ''}`}>
                    <small>
                      {message.role === 'user' ? '我' : '对方'} ·{' '}
                      {new Date(message.timestamp).toLocaleTimeString('zh-CN', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {sentenceLabel(message.status, message.edited) &&
                        ` · ${sentenceLabel(message.status, message.edited)}`}
                    </small>
                    <button
                      className={`chat-bubble ${answer?.source_message_ids.includes(message.id) ? 'selected' : ''}`}
                      aria-pressed={!!answer?.source_message_ids.includes(message.id)}
                      onClick={() => {
                        if (related[0]) choose(related.at(-1)!.id);
                        else toast('这句话没有保存的回答');
                      }}>
                      {message.text}
                    </button>
                    {related.length > 0 && (
                      <button
                        className="bubble-answer-count"
                        onClick={() => choose(related.at(-1)!.id)}>
                        <FileText size={11} />
                        {related.length} 份回答
                      </button>
                    )}
                  </article>
                );
              })
            ) : (
              <EmptyState
                title={messages.length ? '没有匹配的对话' : '本场还没有对话记录'}
                text={messages.length ? '换一个关键词，或取消“有回答”筛选。' : undefined}
              />
            )}
          </div>
          <footer className="panel-footer">点击有回答的原句，查看当时保存的建议。</footer>
        </div>
        <div className="answer-column">
          <header className="panel-header">
            <button
              className={`tab-button ${tab === 'answer' ? 'active' : ''}`}
              onClick={() => setTab('answer')}>
              回答
            </button>
            <button
              className={`tab-button ${tab === 'review' ? 'active' : ''}`}
              onClick={() => setTab('review')}>
              复盘
            </button>
            <span className="spacer" />
            {tab === 'answer' && !!session.answers.length && (
              <select
                value={selected}
                onChange={e => choose(e.target.value)}
                aria-label="已保存的回答">
                {session.answers.map((value, i) => (
                  <option key={value.id} value={value.id}>
                    {i + 1}. {value.question_text.slice(0, 20)}
                  </option>
                ))}
              </select>
            )}
          </header>
          {tab === 'answer' ? (
            <div
              className="answer-scroll"
              ref={answerScroll}
              onScroll={event => {
                positions.current[positionKey] = event.currentTarget.scrollTop;
              }}>
              {answer ? (
                <article className="answer-document">
                  <div className="answer-question">{answer.question_text}</div>
                  <div className="answer-source-line">
                    <span>{answer.source_message_ids.length} 句来源 · 当时选择的问题</span>
                    <button className="link-button" onClick={locate}>
                      <LocateFixed size={12} />
                      定位原句
                    </button>
                  </div>
                  {hasRevisedSources(answer, session.conversation) && (
                    <p className="notice">原句后来有过修正；以上为生成这份回答时的问题原文。</p>
                  )}
                  {answer.status !== 'done' && (
                    <p className="notice">这份回答未完整结束，以下为已保存内容。</p>
                  )}
                  <div className="answer-text">
                    <AnswerBody text={answer.text || '未收到回答内容'} />
                  </div>
                  <details>
                    <summary>回答依据与本场资料</summary>
                    <p>
                      岗位：{contextText('role', session.role) || '未关联'}
                      <br />
                      简历：
                      {session.resume_snapshot
                        ? `${session.resume_snapshot.filename} · v${session.resume_snapshot.version}`
                        : '未关联'}
                    </p>
                    <p>
                      岗位要求：
                      {contextText('job_description', session.job_description) || '未提供'}
                    </p>
                    <p>
                      {contextText('resume_text', session.resume_snapshot?.text || '') ||
                        '没有保存简历快照。'}
                    </p>
                    {answer.context_snapshot && (
                      <p>此处展示这次生成实际使用的资料片段，完整简历可在“本场资料”中查看。</p>
                    )}
                  </details>
                </article>
              ) : (
                <EmptyState
                  icon={<FileText size={22} />}
                  title="没有保存的回答"
                  text="完整对话仍可在左侧查看。"
                />
              )}
            </div>
          ) : (
            <div
              className="review-content"
              ref={answerScroll}
              onScroll={event => {
                positions.current[positionKey] = event.currentTarget.scrollTop;
              }}>
              <p className="notice">
                根据本场已记录的对话整理。缺少本人发言时，仅整理问题与准备方向。
              </p>
              {!review && (
                <button
                  className="btn"
                  disabled={reviewing || session.conversation.length === 0}
                  onClick={() => void makeReview()}>
                  {reviewing ? '正在生成复盘…' : '生成本场复盘'}
                </button>
              )}
              {review && <AnswerBody text={review} />}
            </div>
          )}
          <footer className="panel-footer">
            <span>{tab === 'answer' ? `${session.answers.length} 份已保存回答` : '本场复盘'}</span>
            <button
              className="btn btn-quiet"
              disabled={!(tab === 'review' ? review : answer?.text)}
              onClick={() => void copy(tab === 'review' ? review : answer?.text || '')}>
              <Copy />
              复制
            </button>
          </footer>
        </div>
      </div>
      {context && (
        <Modal title="本场资料快照" onClose={() => setContext(false)}>
          <div className="text-document">
            <strong>{session.role || '未关联岗位'}</strong>
            <p>{session.job_description || '没有岗位描述'}</p>
            <br />
            <strong>
              {session.resume_snapshot
                ? `${session.resume_snapshot.filename} · v${session.resume_snapshot.version}`
                : '未关联简历'}
            </strong>
            <p>{session.resume_snapshot?.text}</p>
          </div>
        </Modal>
      )}
    </section>
  );
}
