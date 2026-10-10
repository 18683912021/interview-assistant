import {useEffect, useRef, useState} from 'react';
import {FileText, X} from 'lucide-react';
import {AnswerBody} from '../components/AnswerBody';
import {Loading} from '../components/WorkspaceUI';
import './interview.css';
export default function OverlayScreen() {
  const [text, setText] = useState(''),
    [question, setQuestion] = useState(''),
    [status, setStatus] = useState('等待选择问题');
  const request = useRef<string | null>(null);
  useEffect(() => {
    const api = window.electronAPI?.audio;
    if (!api) return;
    type AnswerEvent = {
      request_id: string;
      question_text?: string;
      delta?: string;
      chunk_index?: number;
      full_answer?: string;
      status?: string;
      error?: string;
    };
    type Queued = {kind: 'start' | 'chunk' | 'done'; event: AnswerEvent};
    let disposed = false,
      hydrating = true,
      lastChunk = -1,
      terminal = false;
    const queued: Queued[] = [];
    const label = (value: string) =>
      ({
        loading: '正在生成',
        streaming: '正在生成',
        done: '已完成',
        completed: '已完成',
        error: '生成失败',
        failed: '生成失败',
        cancelled: '已停止',
        truncated: '回答未完整',
      })[value] || '等待选择问题';
    const consume = ({kind, event}: Queued) => {
      if (kind === 'start') {
        request.current = event.request_id;
        lastChunk = -1;
        terminal = false;
        setText('');
        setQuestion(event.question_text || '');
        setStatus('正在生成');
        return;
      }
      if (event.request_id !== request.current || terminal) return;
      if (kind === 'chunk') {
        const index = event.chunk_index ?? lastChunk + 1;
        if (index <= lastChunk) return;
        lastChunk = index;
        setText(value => value + (event.delta || ''));
      } else {
        if (event.full_answer) setText(event.full_answer);
        terminal = true;
        setStatus(label(event.error ? 'failed' : event.status || 'completed'));
      }
    };
    const receive = (kind: Queued['kind'], raw: unknown) => {
      const event = {kind, event: raw as AnswerEvent};
      if (hydrating) queued.push(event);
      else consume(event);
    };
    const offs = [
      api.onLLMStart(event => receive('start', event)),
      api.onLLMChunk(event => receive('chunk', event)),
      api.onLLMDone(event => receive('done', event)),
    ];
    void api
      .getSnapshot()
      .then(raw => {
        if (disposed) return;
        const snapshot = raw as {
          currentAnswer?: {
            request_id: string;
            question_text: string;
            text: string;
            status: string;
            chunk_index?: number;
          } | null;
        };
        const current = snapshot.currentAnswer;
        if (current) {
          request.current = current.request_id;
          lastChunk = current.chunk_index ?? -1;
          terminal = !['loading', 'streaming'].includes(current.status);
          setText(current.text);
          setQuestion(current.question_text);
          setStatus(label(current.status));
        }
        hydrating = false;
        const includedStart = current
          ? queued
              .map(value => (value.kind === 'start' ? value.event.request_id : ''))
              .lastIndexOf(current.request_id)
          : -1;
        queued.slice(includedStart + 1).forEach(consume);
      })
      .catch(() => {
        if (disposed) return;
        hydrating = false;
        queued.forEach(consume);
        if (!queued.length) setStatus('暂时无法恢复回答，请在主窗口重新选择问题');
      });
    return () => {
      disposed = true;
      offs.forEach(off => off());
    };
  }, []);
  return (
    <div className="overlay-page">
      <div className="overlay-card">
        <header className="overlay-header">
          <FileText size={14} />
          回答参考
          <button
            className="icon-btn"
            aria-label="关闭浮窗"
            onClick={() => void window.electronAPI?.window.closeOverlay()}>
            <X size={14} />
          </button>
        </header>
        <div className="overlay-body">
          {question && <div className="overlay-question">{question}</div>}
          {text ? (
            <AnswerBody text={text} />
          ) : status === '正在生成' ? (
            <Loading text="正在整理回答…" />
          ) : (
            <span className="overlay-placeholder muted small">
              在主窗口点击一句对话，回答将在这里显示。
            </span>
          )}
        </div>
        <footer className="overlay-footer">{status}</footer>
      </div>
    </div>
  );
}
