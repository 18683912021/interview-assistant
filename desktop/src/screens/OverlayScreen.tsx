/**
 * OverlayScreen —— AI 浮窗
 *
 * 透明背景 + 半透明卡片，显示最新 AI 回答。
 * 鼠标穿透由 Electron 主进程 setIgnoreMouseEvents 控制。
 */
import { useState, useEffect } from 'react';
import { Bot } from 'lucide-react';

export default function OverlayScreen() {
  const [text, setText] = useState('等待 AI 回答…');
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;

    const u1 = api.audio.onLLMChunk((data: any) => { if (data?.delta) { setText(t => t === '等待 AI 回答…' ? data.delta : t + data.delta); setStreaming(true); } });
    const u2 = api.audio.onLLMDone((data: any) => { if (data?.full_answer) { setText(data.full_answer); setStreaming(false); } });

    return () => { if (u1) u1(); if (u2) u2(); };
  }, []);

  return (
    <div className="h-full bg-transparent text-white p-3 select-none">
      <div className="h-full rounded-2xl bg-black/75 backdrop-blur-xl border border-white/10 flex flex-col overflow-hidden shadow-2xl">
        {/* 拖动把手 */}
        <div className="h-7 -mx-3 -mt-3 mb-0 flex items-center justify-center cursor-move bg-white/[0.03]">
          <div className="w-8 h-1 rounded-full bg-white/25"/>
        </div>

        {/* 头部 */}
        <div className="px-4 py-2 flex items-center gap-2 border-b border-white/5">
          <Bot className="w-3.5 h-3.5 text-indigo-400" strokeWidth={2}/>
          <span className="text-[11px] font-semibold text-white/60 uppercase tracking-wider">AI 回答</span>
          {streaming && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-auto"/>}
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <p className="text-[13px] leading-relaxed text-white/85 whitespace-pre-wrap">{text}</p>
          {streaming && <span className="inline-block w-[2px] h-3.5 bg-indigo-400 animate-pulse ml-0.5 align-middle rounded-sm"/>}
        </div>
      </div>
    </div>
  );
}
