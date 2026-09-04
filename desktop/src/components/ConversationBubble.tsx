/**
 * ConversationBubble —— 对话气泡
 *
 * loading / streaming / done / error 四种状态。
 * 流式打字动画 + Markdown 渲染 + 点击触发 LLM。
 */
import { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { ConversationMessage } from '../store/types';

interface Props {
  message: ConversationMessage;
  onTriggerLLM?: (bubbleId: string) => void;
  onRetryLLM?: (bubbleId: string) => void;
}

function fmtTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return '刚刚';
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return '刚刚';
  if (sec < 60) return `${sec}秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分钟前`;
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function ConversationBubble({ message, onTriggerLLM, onRetryLLM }: Props) {
  const { id, role, text, status, timestamp } = message;
  const isAI = role === 'ai';
  const isInterviewer = role === 'interviewer';
  const clickable = !isAI && onTriggerLLM != null && status === 'done';

  const [visibleLen, setVisibleLen] = useState(status === 'done' || status === 'error' ? text.length : 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (status === 'done' || status === 'error') { setVisibleLen(text.length); return; }
    if (status === 'loading') { setVisibleLen(0); return; }
    let active = true;
    const step = () => {
      if (!active) return;
      setVisibleLen(prev => {
        if (prev >= text.length) return prev;
        const backlog = text.length - prev;
        const speed = backlog <= 20 ? 5 : Math.min(15, 5 + Math.ceil((backlog - 20) / 8));
        return Math.min(prev + speed, text.length);
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { active = false; if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [status, text.length]);

  const visibleText = text.slice(0, visibleLen);
  const isTyping = isAI && status === 'streaming' && visibleLen < text.length;
  const isRight = !isInterviewer;
  const roleLabel = isInterviewer ? '面试官' : isAI ? 'AI' : '你';
  const avatar = isInterviewer ? '🎙️' : isAI ? '🤖' : '👤';

  const handleClick = useCallback(() => {
    if (clickable && onTriggerLLM) onTriggerLLM(id);
  }, [clickable, onTriggerLLM, id]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex items-end gap-2.5 mb-4 ${isRight ? 'flex-row-reverse' : ''}`}
    >
      {/* Avatar */}
      <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-sm border ${
        isAI ? 'bg-gradient-to-br from-indigo-500 to-violet-600 border-transparent text-white shadow-sm shadow-indigo-500/25' :
        isInterviewer ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700' :
        'bg-zinc-800 dark:bg-zinc-200 border-transparent text-white dark:text-zinc-900'
      }`}>
        {avatar}
      </div>

      <div className={`flex flex-col ${isRight ? 'items-end' : 'items-start'} min-w-0 max-w-[80%]`}>
        {/* 角色行：标签 + 徽章 + 分隔点 + 时间 */}
        <div className={`flex items-center gap-2 px-1 mb-1.5 ${isRight ? 'flex-row-reverse' : ''}`}>
          <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">{roleLabel}</span>
          {isAI && (
            <span className="px-1.5 py-px rounded-full bg-indigo-50 dark:bg-indigo-500/10 text-[10px] font-semibold text-indigo-500 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/20">AI 建议</span>
          )}
          <span className="w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-600" />
          <span className="text-[11px] text-zinc-400">{fmtTime(timestamp)}</span>
        </div>

        <div
          onClick={handleClick}
          className={`relative max-w-full px-4 py-3 rounded-2xl text-sm leading-relaxed transition-all duration-200 overflow-hidden
          ${isAI
            ? 'bg-gradient-to-br from-white to-indigo-50/70 dark:from-[#1A1D28] dark:to-indigo-950/40 border border-indigo-200/70 dark:border-indigo-500/20 shadow-md shadow-indigo-500/[0.06] dark:shadow-indigo-950/50'
            : isInterviewer
              ? 'bg-white dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60 shadow-sm text-zinc-900 dark:text-zinc-100'
              : 'bg-zinc-900 dark:bg-white border border-transparent text-white dark:text-zinc-900 shadow-sm'
          }
          ${isAI ? 'rounded-tr-md' : (isInterviewer ? 'rounded-tl-md' : 'rounded-tr-md')}
          ${isTyping ? 'ai-glow' : ''}
          ${clickable ? 'cursor-pointer hover:shadow-md active:scale-[0.99]' : ''}
          ${status === 'error' ? 'border-red-200 dark:border-red-800/50' : ''}
        `}
        >
          {/* 面试官问题源指示条 */}
          {isInterviewer && <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full bg-indigo-400/70 dark:bg-indigo-500/70" />}
        {status === 'loading' ? (
          <LoadingDots />
        ) : (
          <div className={`whitespace-pre-wrap break-words ${isInterviewer ? 'pl-1.5' : ''}`}>
            <RichText text={visibleText} />
            {isTyping && <span className="inline-block w-[3px] h-4 bg-indigo-500 animate-pulse ml-0.5 align-middle rounded-sm" />}
          </div>
        )}

        {status === 'error' && onRetryLLM && (
          <button
            onClick={(e) => { e.stopPropagation(); onRetryLLM(id); }}
            className="mt-2 text-xs text-red-500 font-medium hover:underline"
          >
            重新生成 →
          </button>
        )}

        {clickable && (
          <div className="mt-2 text-[11px] text-zinc-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
            点击获取 AI 回答
          </div>
        )}
        </div>
      </div>
    </motion.div>
  );
}

// memo：LLM 流式 chunk 期间只有当前 AI 气泡的 message 引用变化，其余气泡不再重渲染
export default memo(ConversationBubble);

function LoadingDots() {
  const [frame, setFrame] = useState(0);
  useEffect(() => { const id = setInterval(() => setFrame(f => (f + 1) % 3), 300); return () => clearInterval(id); }, []);
  return (
    <div className="flex gap-1.5 py-1">
      {[0, 1, 2].map(i => (
        <span key={i} className={`inline-block w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-600 transition-all duration-200 ${
          frame === i ? 'scale-110 opacity-100' : 'scale-75 opacity-40'
        }`} />
      ))}
    </div>
  );
}

function RichText({ text }: { text: string }) {
  // 解析结果按文本缓存：LLM 流式期间同文本只解析一次，避免每条气泡每次渲染都切分
  const blocks = useMemo(() => text.split(/(```[\s\S]*?```)/g), [text]);
  return (
    <>
      {blocks.map((block, bi) => {
        if (block.startsWith('```') && block.endsWith('```')) {
          const code = block.slice(3, -3).replace(/^\n/, '');
          return (
            <pre key={bi} className="my-2 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 text-xs font-mono overflow-x-auto whitespace-pre-wrap text-zinc-700 dark:text-zinc-300 border border-zinc-100 dark:border-zinc-800">
              {code}
            </pre>
          );
        }
        const parts = block.split(/(\*\*.*?\*\*|`.*?`)/g);
        return (
          <span key={bi}>
            {parts.map((part, pi) => {
              if (part.startsWith('**') && part.endsWith('**')) return <strong key={pi}>{part.slice(2, -2)}</strong>;
              if (part.startsWith('`') && part.endsWith('`')) return <code key={pi} className="px-1 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-xs font-mono text-indigo-600 dark:text-indigo-400">{part.slice(1, -1)}</code>;
              return <span key={pi}>{part}</span>;
            })}
          </span>
        );
      })}
    </>
  );
}
