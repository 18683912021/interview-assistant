/**
 * InterviewScreen —— 面试页
 *
 * 布局：左控制面板 250px | 中对话流 | 右实时面板 270px（可折叠）
 */
import { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { Play, Square, Mic, Volume2, FileText, ChevronDown, PanelRightClose, PanelRightOpen, Lock, ArrowDown, Zap, Globe, RefreshCw } from 'lucide-react';
import { useAudioCapture } from '../hooks/useAudioCapture';
import { enumerateAudioInputs, loadSavedSystemDevice, saveSystemDevice, type AudioInputDevice } from '../utils/audioDevices';
import { saveInterview } from '../api/interview';
import { hasResume, getIntro } from '../api/resume';
import { getProgLang, setProgLang, type ProgLang } from '../config';
import { deductTime, getProfile as getProfileApi } from '../api/auth';
import { refreshProfile } from '../utils/token';
import { setInterviewActive } from '../utils/interviewState';
import { useToast } from '../components/Toast';
import ConversationBubble from '../components/ConversationBubble';
import MicLevelBar from '../components/MicLevelBar';
import PulsingDot from '../components/PulsingDot';

const LANGS: ProgLang[] = ['JavaScript', 'Python', 'Java', 'C++', 'C#', 'Go'];
const BLACKHOLE_URL = 'https://existential.audio/blackhole/';

function fmtTimer(s: number) { return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }

export default function InterviewScreen() {
  const { state, start, stop, sendLLMQuery, retryLLM } = useAudioCapture();
  const [timer, setTimer] = useState(0);
  const [style, setStyle] = useState('标准');
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [intro, setIntro] = useState('');
  const [introLoading, setIntroLoading] = useState(false);
  const [introFontSize, setIntroFontSize] = useState(16);
  const [hasIntro, setHasIntro] = useState(false);
  const capturing = state.captureState === 'capturing';
  const { confirm, toast } = useToast();
  const isMac = /Mac/i.test(navigator.userAgent);

  // ── macOS 系统音频源（BlackHole 虚拟声卡）设备枚举 ──
  const [sysDevices, setSysDevices] = useState<AudioInputDevice[]>([]);
  const [sysDeviceId, setSysDeviceId] = useState('');
  const [sysDevicesLoading, setSysDevicesLoading] = useState(false);

  const refreshSysDevices = useCallback(async () => {
    if (!isMac) return;
    setSysDevicesLoading(true);
    try {
      const devs = await enumerateAudioInputs();
      const virtuals = devs.filter(d => d.isVirtual);
      const saved = await loadSavedSystemDevice();
      setSysDevices(virtuals);
      setSysDeviceId((saved && virtuals.some(d => d.deviceId === saved) ? saved : virtuals[0]?.deviceId) || '');
    } finally {
      setSysDevicesLoading(false);
    }
  }, [isMac]);

  useEffect(() => { if (isMac) refreshSysDevices(); }, [isMac, refreshSysDevices]);

  useEffect(() => { hasResume().then(d => setHasIntro(d.has_intro)).catch(()=>{}); }, []);
  useEffect(() => {
    if (!capturing) { setTimer(0); setInterviewActive(false); return; }
    setInterviewActive(true);
    const id = setInterval(() => setTimer(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [capturing]);

  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowIntro(false); } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, []);

  // 结束面试（含确认、自动保存、自动扣费）
  const handleStop = () => {
    confirm('结束面试', '确定要结束当前面试吗？', async () => {
      stop(); setInterviewActive(false);
      if (state.conversation.length > 0) {
        try {
          await saveInterview({
            started_at: Math.floor((Date.now() - timer * 1000) / 1000),
            ended_at: Math.floor(Date.now() / 1000),
            duration_seconds: timer,
            programming_language: getProgLang().toLowerCase(),
            conversation: state.conversation.filter(m => m.status === 'done' || m.status === 'streaming'),
          });
          await deductTime(timer);
          await refreshProfile();
          toast('面试记录已保存', 'success');
        } catch { toast('保存失败，请重试', 'error'); }
      }
    });
  };

  // 开始面试（含剩余时长检查）
  const handleStart = async () => {
    try {
      const profile = await getProfileApi();
      if (profile.ok && profile.user.remaining_seconds < 10) {
        toast('剩余时长不足，请先续费', 'error');
        return;
      }
    } catch { /* 网络问题不阻止 */ }
    start();
  };

  const loadIntro = async () => {
    if (!hasIntro) return;
    setShowIntro(true);
    if (intro || introLoading) return;
    setIntroLoading(true);
    try { const d = await getIntro(); setIntro(d.ok && d.intro ? d.intro : ''); } catch { setIntro(''); }
    finally { setIntroLoading(false); }
  };

  const intMsgs = useMemo(() => state.conversation.filter(m => m.role === 'interviewer'), [state.conversation]);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* ═══ 左 · 控制面板 230px ═══ */}
      <aside className="w-[230px] shrink-0 bg-zinc-50 dark:bg-[#0F0F11] border-r border-zinc-200 dark:border-zinc-800 flex flex-col">
        <div className="p-4">
          {/* 会话卡片：状态 + 计时 + 主 CTA 一体（面试中焦点一眼可见） */}
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141416] shadow-sm overflow-hidden">
            <div className="px-4 pt-3.5 pb-3 text-center border-b border-zinc-100 dark:border-zinc-800/70">
              <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">{capturing ? '面试进行中' : '面试时长'}</div>
              <div className={`text-[30px] tabular-nums font-extrabold tracking-wider transition-colors duration-300 ${capturing ? 'text-indigo-600 dark:text-indigo-400' : 'text-zinc-300 dark:text-zinc-600'}`}>{fmtTimer(timer)}</div>
            </div>
            <div className="p-3">
              <button onClick={capturing ? handleStop : handleStart}
                className={`w-full h-11 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.98]
                  ${capturing
                    ? 'bg-red-500 hover:bg-red-600 text-white shadow-sm shadow-red-500/25 hover:shadow-md'
                    : 'bg-gradient-to-b from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-600 text-white shadow-sm shadow-indigo-500/30 hover:shadow-md hover:shadow-indigo-500/30'
                  }`}
                title={capturing ? '结束面试' : '开始面试'}>
                {capturing ? <><Square className="w-3.5 h-3.5" fill="currentColor"/>结束面试</> : <><Play className="w-3.5 h-3.5" fill="currentColor"/>开始面试</>}
              </button>
              <div className="mt-2.5 flex items-center justify-center min-h-[18px]">
                {capturing && state.streamState === 'ready' && <Status color="green" text="已连接 · 转录中"/>}
                {state.streamState === 'reconnecting' && <Status color="amber" text="重连中…"/>}
                {state.streamState === 'dead' && <Status color="red" text="连接失败"/>}
              </div>
            </div>
          </div>
        </div>

        {/* 采集错误（addon 缺失/无信号等）醒目上屏 */}
        {state.error && (
          <div className="px-4 pb-3">
            <div className="text-[11px] text-red-500 leading-relaxed break-words rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 px-3 py-2.5">{state.error.message}</div>
          </div>
        )}

        {/* 音频电平 */}
        <div className="px-4 flex flex-col gap-2 mb-4">
          <AudioRow icon={Mic} label="麦克风" lvl={state.levels.mic} />
          <AudioRow icon={Volume2} label="系统音频" lvl={state.levels.system} />
        </div>

        {/* macOS 系统音频源：虚拟声卡（BlackHole）——macOS 无系统音频拦截 API */}
        {isMac && (
          <div className="px-4 mb-3">
            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest ml-1 mb-1.5 block">系统音频源</label>
            {sysDevices.length > 0 ? (
              <div className="relative">
                <select
                  value={sysDeviceId}
                  onChange={e => { setSysDeviceId(e.target.value); saveSystemDevice(e.target.value); }}
                  className="w-full h-10 pl-3 pr-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141416] text-[13px] font-medium text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 dark:focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 cursor-pointer appearance-none transition-all duration-150"
                  title="系统输出需路由到该虚拟声卡（音频 MIDI 设置 → 多输出设备）">
                  {sysDevices.map(d => (<option key={d.deviceId} value={d.deviceId}>{d.label}</option>))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" strokeWidth={1.5}/>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10 p-3 text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                macOS 无法直接截取系统声音，需安装虚拟声卡 <b>BlackHole</b>：安装后在「音频 MIDI 设置」新建多输出设备（扬声器 + BlackHole），并把它设为系统输出。
                <button
                  onClick={() => (window as any).electronAPI?.window?.openExternal?.(BLACKHOLE_URL)}
                  className="mt-1.5 block text-[12px] font-semibold text-indigo-500 hover:text-indigo-600 transition-colors">
                  打开下载页 ↗
                </button>
              </div>
            )}
            <div className="mt-1.5 flex items-center gap-3 text-[10px] text-zinc-400">
              <button
                onClick={refreshSysDevices}
                disabled={sysDevicesLoading}
                className="flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors disabled:opacity-50">
                <RefreshCw className={`w-3 h-3 ${sysDevicesLoading ? 'animate-spin' : ''}`} strokeWidth={2}/>
                刷新设备
              </button>
              {sysDevices.length > 0 && <span className="truncate">采集时优先使用所选设备</span>}
            </div>
          </div>
        )}

        {/* 赛道 */}
        <div className="px-4 mb-3">
          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest ml-1 mb-1.5 block">面试赛道</label>
          {capturing ? (
            <div className="flex items-center gap-2 h-10 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/30 text-[13px] font-medium text-zinc-600 dark:text-zinc-400">
              <Lock className="w-3.5 h-3.5" strokeWidth={1.5}/>
              <span>{getProgLang()}</span>
              <span className="text-[10px] text-zinc-400 ml-auto">已锁定</span>
            </div>
          ) : (
            <div className="relative">
              <select defaultValue={getProgLang()} onChange={e => setProgLang(e.target.value as ProgLang)}
                className="w-full h-10 pl-3 pr-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141416] text-[13px] font-medium text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 dark:focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 cursor-pointer appearance-none transition-all duration-150">
                {LANGS.map(l => <option key={l}>{l}</option>)}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" strokeWidth={1.5}/>
            </div>
          )}
        </div>

        {/* 答案风格 */}
        <div className="px-4 mb-3">
          <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest ml-1 mb-1.5 block">答案风格</label>
          <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5">
            {['标准', '简洁', '详细'].map(s => (
              <button key={s} onClick={() => setStyle(s)}
                className={`flex-1 py-1.5 text-[12px] rounded-md font-medium transition-all duration-150 ${style === s ? 'bg-white dark:bg-[#141416] text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}>{s}</button>
            ))}
          </div>
        </div>

        {/* 自我介绍 */}
        <div className="px-4 mb-3">
          <button onClick={loadIntro} disabled={!hasIntro}
            className={`w-full h-10 rounded-xl flex items-center justify-center gap-2 text-[13px] font-medium transition-all duration-150 active:scale-[0.98]
              ${hasIntro
                ? 'bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 hover:shadow-sm'
                : 'bg-zinc-100 dark:bg-zinc-800/50 text-zinc-300 dark:text-zinc-600 cursor-not-allowed border border-transparent'
              }`}
            title={hasIntro ? '点击查看自我介绍（可调字号，Esc 关闭）' : '请先在「我的」上传 PDF 简历'}>
            <FileText className="w-4 h-4" strokeWidth={1.5}/>
            <span>自我介绍</span>
          </button>
        </div>
      </aside>

      {/* ═══ 中 · 对话流 ═══ */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        {state.conversation.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-8 relative">
            {/* 氛围光晕 */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute -top-28 left-1/2 -translate-x-1/2 w-[620px] h-[300px] rounded-full bg-indigo-500/[0.07] dark:bg-indigo-500/10 blur-3xl" />
              <div className="absolute bottom-0 right-8 w-72 h-72 rounded-full bg-violet-500/[0.05] dark:bg-violet-500/10 blur-3xl" />
            </div>
            <div className="relative w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/25 flex items-center justify-center">
              <Mic className="w-9 h-9 text-white" strokeWidth={1.8}/>
            </div>
            <div className="relative">
              <div className="text-lg font-bold text-zinc-900 dark:text-white mb-2">准备开始面试</div>
              <div className="text-sm text-zinc-500 max-w-sm leading-relaxed">
                点击左侧「开始面试」，系统自动转写面试官语音；<br/>点击任意转写气泡即可获取 AI 实时回答。
              </div>
            </div>
            <div className="relative grid grid-cols-3 gap-3 mt-1 max-w-md">
              {[{ icon: Mic, label: '实时转写', desc: '精准捕获面试官提问' }, { icon: Zap, label: 'AI 回答', desc: 'DeepSeek 驱动高质量应答' }, { icon: Globe, label: '多赛道', desc: '6 种编程语言面试' }].map((f, i) => {
                const Fi = f.icon;
                return <div key={i} className="p-4 rounded-2xl bg-white dark:bg-[#141416] border border-zinc-200 dark:border-zinc-800 text-center shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-indigo-200 dark:hover:border-indigo-500/20">
                  <Fi className="w-5 h-5 text-indigo-500/80 dark:text-indigo-400/80 mx-auto mb-2" strokeWidth={1.5}/>
                  <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">{f.label}</div>
                  <div className="text-[11px] text-zinc-400 mt-1">{f.desc}</div>
                </div>;
              })}
            </div>
          </div>
        ) : (
          <ConversationList messages={state.conversation} onTriggerLLM={sendLLMQuery} onRetryLLM={retryLLM} />
        )}
      </main>

      {/* ═══ 右 · 实时面板 270px（memo：只有对话变化才重渲染） ═══ */}
      <RealtimePanel
        collapsed={rightCollapsed}
        intMsgs={intMsgs}
        conversation={state.conversation}
        onToggle={() => setRightCollapsed(c => !c)}
      />

      {/* ── 自我介绍阅读面板 ── */}
      {showIntro && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setShowIntro(false)}>
          {/* 半透明遮罩 */}
          <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" />
          {/* 阅读卡片 */}
          <div
            className="relative bg-white dark:bg-[#141416] rounded-2xl shadow-2xl shadow-black/20 border border-zinc-200 dark:border-zinc-800 w-full max-w-2xl max-h-[85vh] flex flex-col animate-[scaleIn_150ms_ease-out]"
            onClick={e => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
              <div className="flex items-center gap-2.5">
                <FileText className="w-5 h-5 text-indigo-500" strokeWidth={1.5}/>
                <span className="text-sm font-bold text-zinc-900 dark:text-white">自我介绍</span>
                <span className="text-[10px] text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded-full">面试时可朗读</span>
              </div>
              <div className="flex items-center gap-1">
                {/* 字号调节 */}
                <button onClick={() => setIntroFontSize(s => Math.max(12, s - 2))}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-150"
                  title="缩小字号">A-</button>
                <span className="text-[11px] text-zinc-400 tabular-nums w-8 text-center">{introFontSize}px</span>
                <button onClick={() => setIntroFontSize(s => Math.min(24, s + 2))}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-150"
                  title="放大字号">A+</button>
                <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-1" />
                <button onClick={() => setShowIntro(false)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-150"
                  title="关闭 (Esc)">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
            </div>
            {/* 内容 */}
            <div className="flex-1 overflow-y-auto px-6 py-5" style={{ fontSize: `${introFontSize}px`, lineHeight: 1.8 }}>
              {introLoading ? (
                <div className="flex items-center gap-3 text-zinc-400">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  加载中…
                </div>
              ) : intro ? (
                <p className="text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap leading-relaxed">{intro}</p>
              ) : (
                <div className="text-center py-8">
                  <FileText className="w-10 h-10 text-zinc-300 mx-auto mb-3" strokeWidth={1}/>
                  <p className="text-zinc-500">暂无自我介绍内容</p>
                  <p className="text-zinc-400 mt-1">请在「我的」页面上传简历</p>
                </div>
              )}
            </div>
            {/* 底部提示 */}
            <div className="px-5 py-2 border-t border-zinc-200 dark:border-zinc-800 text-center text-[10px] text-zinc-400 shrink-0">
              Esc 关闭 · A+ / A- 调节字号 · 面试时可以此内容回答面试官
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

const AudioRow = memo(function AudioRow({ icon: Icon, label, lvl }: { icon: any; label: string; lvl: number }) {
  const pct = Math.round(lvl * 100);
  return (
    <div className="p-2.5 rounded-xl bg-white dark:bg-[#141416] border border-zinc-100 dark:border-zinc-800 transition-shadow duration-150 hover:shadow-sm">
      <div className="flex justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-400"><Icon className="w-3.5 h-3.5" strokeWidth={1.5}/><span>{label}</span></div>
        <span className="text-[11px] text-zinc-400 tabular-nums">{pct}%</span>
      </div>
      <MicLevelBar level={pct}/>
    </div>
  );
});

const Status = memo(function Status({ color, text }: { color: string; text: string }) {
  const c = color==='green'?'text-emerald-500':color==='amber'?'text-amber-500':'text-red-500';
  return <div className={`flex items-center gap-1.5 text-[12px] font-medium ${c}`}><PulsingDot/>{text}</div>;
});

/** 对话列表：自动滚动、FAB 回到底部、时间间隔分隔线（memo：消息引用不变时不重渲染） */
const ConversationList = memo(function ConversationList({ messages, onTriggerLLM, onRetryLLM }: {
  messages: any[]; onTriggerLLM?: (id: string) => void; onRetryLLM?: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showFab, setShowFab] = useState(false);

  // 新消息自动滚底
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist < 200) el.scrollTop = el.scrollHeight;
    else setShowFab(true);
  }, [messages]);

  const scrollBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    setShowFab(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowFab(dist > 300);
  }, []);

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-4">
      {messages.map((msg: any, i: number) => (
        <div key={msg.id}>
          {/* 时间间隔分隔线 */}
          {i > 0 && msg.role === messages[i-1]?.role && msg.timestamp - messages[i-1]?.timestamp > 3000 && (
            <div className="flex items-center gap-3 my-3">
              <div className="flex-1 border-t border-zinc-200 dark:border-zinc-700" />
              <span className="text-[10px] text-zinc-400 shrink-0">···</span>
              <div className="flex-1 border-t border-zinc-200 dark:border-zinc-700" />
            </div>
          )}
          <ConversationBubble message={msg} onTriggerLLM={onTriggerLLM} onRetryLLM={onRetryLLM} />
        </div>
      ))}
      <div className="h-6" />
      {showFab && (
        <button onClick={scrollBottom}
          className="sticky bottom-4 float-right w-10 h-10 rounded-full bg-white dark:bg-[#141416] border border-zinc-200 dark:border-zinc-800 shadow-lg flex items-center justify-center hover:shadow-xl transition-all z-10">
          <ArrowDown className="w-4 h-4 text-zinc-500" strokeWidth={2}/>
        </button>
      )}
    </div>
  );
});

/** 右 · 实时面板（memo：conversation/intMsgs 引用不变时不重渲染，LLM 流式期间仅左侧对话流更新） */
const RealtimePanel = memo(function RealtimePanel({ collapsed, intMsgs, conversation, onToggle }: {
  collapsed: boolean;
  intMsgs: any[];
  conversation: any[];
  onToggle: () => void;
}) {
  if (collapsed) {
    return (
      <button onClick={onToggle}
        className="absolute right-0 top-1/2 -translate-y-1/2 w-7 h-16 rounded-l-xl bg-zinc-50 dark:bg-[#0F0F11] border border-r-0 border-zinc-200 dark:border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-white dark:hover:bg-[#141416] transition-all duration-150 shadow-sm"
        title="展开实时面板">
        <PanelRightOpen className="w-4 h-4" strokeWidth={1.5}/>
      </button>
    );
  }
  return (
    <aside className="w-[240px] shrink-0 bg-zinc-50 dark:bg-[#0F0F11] border-l border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">实时面板</span>
          {intMsgs.length > 0 && (
            <span className="text-[10px] font-semibold text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 rounded-full px-1.5 py-0.5">{intMsgs.length} 条</span>
          )}
        </div>
        <button onClick={onToggle} className="p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-150" title="折叠面板">
          <PanelRightClose className="w-4 h-4" strokeWidth={1.5}/>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <section>
          <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-3">实时转写</h3>
          <div className="space-y-2">
            {intMsgs.slice(-5).reverse().map(m => (
              <div key={m.id} className="p-3 rounded-xl bg-white dark:bg-[#141416] border border-zinc-100 dark:border-zinc-800 text-[13px] text-zinc-700 dark:text-zinc-300 leading-relaxed transition-all duration-150 hover:shadow-sm">
                {m.text || <span className="text-zinc-300 italic">识别中…</span>}
              </div>
            ))}
            {intMsgs.length === 0 && (
              <div className="text-[13px] text-zinc-400 italic p-3 rounded-xl bg-white dark:bg-[#141416] border border-zinc-100 dark:border-zinc-800">等待语音输入…</div>
            )}
          </div>
        </section>
        {conversation.length > 0 && (
          <section>
            <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-3">对话目录</h3>
            <div className="space-y-0.5">
              {conversation.map(m => (
                <div key={m.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] cursor-pointer hover:bg-white dark:hover:bg-[#141416] transition-colors duration-150 truncate" title={m.text.slice(0,80)}>
                  <span className="shrink-0 text-[10px]">{m.role==='interviewer'?'🎙':m.role==='ai'?'🤖':'👤'}</span>
                  <span className={`truncate ${m.status==='streaming'?'text-indigo-500 font-medium':m.status==='error'?'text-red-500':'text-zinc-500'}`}>
                    {m.text.slice(0,24)||(m.status==='loading'?'思考中…':'')}{m.text.length>24?'…':''}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
});
