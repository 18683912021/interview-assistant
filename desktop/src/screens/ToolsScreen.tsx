/**
 * ToolsScreen —— 工具箱
 *
 * 卡片网格布局。每个工具一个卡片，点击进入详情面板。
 * 参考：Notion 设置 + Vercel 项目卡片
 */
import { useState, useEffect } from 'react';
import { Dice5, FileType, FileText, PenTool, Palette, Pencil, Download } from 'lucide-react';

type ToolKey = 'question' | 'word2pdf' | 'pdf2word' | 'format' | 'style' | 'content';

interface ToolDef { key: ToolKey; icon: any; title: string; desc: string; color: string; }
const TOOLS: ToolDef[] = [
  { key: 'question', icon: Dice5,  title: '随机出题',    desc: '按赛道生成面试题目',              color: '#10B981' },
  { key: 'word2pdf', icon: FileType,title: 'Word → PDF',  desc: '支持 .doc / .docx 转换为 PDF',   color: '#6366F1' },
  { key: 'pdf2word', icon: FileText,title: 'PDF → Word',  desc: '将 PDF 转换为 .docx',           color: '#8B5CF6' },
  { key: 'format',   icon: PenTool, title: '简历格式优化', desc: '自动调整字体、间距、页边距',       color: '#F59E0B' },
  { key: 'style',    icon: Palette, title: '简历样式优化', desc: '智能配色、版式美化、模板推荐',      color: '#EC4899' },
  { key: 'content',  icon: Pencil,  title: '简历内容优化', desc: 'AI 润色项目描述、提炼技术亮点',    color: '#8B5CF6' },
];

const QUESTIONS: Record<string, string[]> = {
  JavaScript: ['闭包的原理和实际应用场景','原型链实现继承的方式','事件循环：宏任务与微任务','Promise.all 和 Promise.race','防抖和节流的区别及手写','深拷贝的实现思路','跨域方案详解','React Hooks 底层原理','Vue 3 响应式系统','Webpack loader 和 plugin'],
  Java: ['HashMap 底层实现','JVM 内存模型和垃圾回收','Spring AOP 和 IOC 原理','MySQL B+树索引优化','Redis 缓存穿透/击穿/雪崩','线程池核心参数','分布式锁实现','消息队列可靠性','微服务注册与发现','分库分表'],
  Python: ['GIL 及多线程影响','装饰器原理及场景','Django 中间件流程','Python 内存管理','asyncio 工作原理','Pandas 性能优化','Django ORM N+1','Flask vs FastAPI','*args **kwargs','GC 分代回收'],
  'C#': ['DI 生命周期','EF Core 性能优化','async/await 实现','LINQ 延迟执行'], 'C++': ['虚函数表原理','智能指针实现','RAII 资源管理','move 语义'], Go: ['GMP 调度模型','channel 底层','GC 优化','interface 结构'],
};
import { getProgLang, API_BASE } from '../config';
import { getToken } from '../utils/token';

export default function ToolsScreen() {
  const [active, setActive] = useState<ToolKey | null>(null);
  const activeTool = TOOLS.find(t => t.key === active);

  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-[#0A0A0B]">
      <div className="max-w-5xl mx-auto p-8">
        {/* 头部 */}
        <div className="mb-8">
          <h1 className="text-xl font-extrabold text-zinc-900 dark:text-white tracking-tight">工具箱</h1>
          <p className="text-sm text-zinc-500 mt-1.5">面试备战工具集，助你高效准备</p>
        </div>

        {/* 卡片网格 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {TOOLS.map(tool => {
            const Icon = tool.icon;
            return (
              <button key={tool.key} onClick={() => setActive(tool.key)}
                className="group p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141416] text-left hover:shadow-md hover:border-zinc-300 dark:hover:border-zinc-700 transition-all">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ backgroundColor: tool.color + '15' }}>
                  <Icon className="w-5 h-5" style={{ color: tool.color }} strokeWidth={1.5}/>
                </div>
                <div className="text-sm font-bold text-zinc-900 dark:text-white mb-1">{tool.title}</div>
                <div className="text-[13px] text-zinc-500">{tool.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 详情弹窗 */}
      {activeTool && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 backdrop-blur-sm" onClick={() => setActive(null)}>
          <div className="bg-white dark:bg-[#141416] rounded-2xl p-6 max-w-lg w-full mx-4 shadow-xl shadow-black/10 border border-zinc-200 dark:border-zinc-800" onClick={e => e.stopPropagation()}>
            <ToolDetail tool={activeTool} onClose={() => setActive(null)}/>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 工具详情 ── */
function ToolDetail({ tool, onClose }: { tool: ToolDef; onClose: () => void }) {
  const Icon = tool.icon;

  // 随机出题
  if (tool.key === 'question') return <QuestionPanel tool={tool} onClose={onClose}/>;

  // 文件转换
  const needsLO = tool.key === 'word2pdf' || tool.key === 'pdf2word';
  if (needsLO) return <ConvertPanel tool={tool} onClose={onClose}/>;

  // 简历工具（占位）
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: tool.color + '15' }}><Icon className="w-5 h-5" style={{ color: tool.color }} strokeWidth={1.5}/></div>
          <h3 className="text-base font-bold text-zinc-900 dark:text-white">{tool.title}</h3>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      </div>
      <p className="text-sm text-zinc-500 mb-6">{tool.desc}</p>
      <div className="text-center py-12">
        <PenTool className="w-12 h-12 text-zinc-300 mx-auto mb-4" strokeWidth={1}/>
        <p className="text-sm text-zinc-500">此工具正在开发中</p>
        <p className="text-xs text-zinc-400 mt-1">敬请期待</p>
      </div>
    </div>
  );
}

/* ── 随机出题 ── */
function QuestionPanel({ tool, onClose }: { tool: ToolDef; onClose: () => void }) {
  const Icon = tool.icon;
  const [lang, setLang] = useState<string>(getProgLang());
  const [q, setQ] = useState('');
  const pool = QUESTIONS[lang] ?? QUESTIONS['JavaScript']!;
  const roll = () => { let n = Math.floor(Math.random() * pool.length); if (pool.length > 1 && n === (QUESTIONS[lang]??[]).indexOf(q)) n = (n + 1) % pool.length; setQ(pool[n]!); };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: tool.color + '15' }}><Icon className="w-5 h-5" style={{ color: tool.color }} strokeWidth={1.5}/></div>
          <h3 className="text-base font-bold text-zinc-900 dark:text-white">随机出题</h3>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      </div>
      <div className="flex items-center gap-3 mb-5">
        <select value={lang} onChange={e => { setLang(e.target.value); setQ(''); }} className="h-10 px-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141416] text-[13px] text-zinc-900 dark:text-zinc-100 outline-none focus:border-indigo-400 cursor-pointer">
          {Object.keys(QUESTIONS).map(l => <option key={l}>{l}</option>)}
        </select>
        <button onClick={roll} className="h-10 px-5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[13px] font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors shadow-sm">抽题</button>
      </div>
      {q && <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800 text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">{q}</div>}
    </div>
  );
}

/* ── 文件转换 ── */
function ConvertPanel({ tool, onClose }: { tool: ToolDef; onClose: () => void }) {
  const Icon = tool.icon;
  const [loAvailable, setLoAvail] = useState<boolean | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [dlProgress, setDlProgress] = useState(0);
  const [dlStage, setDlStage] = useState('');
  const [paused, setPaused] = useState(false);
  const [hasPartial, setHasPartial] = useState(false);

  const refreshLO = () => {
    (window as any).electronAPI?.fileConvert?.getLibreOfficeStatus().then((r: any) => setLoAvail(r?.available ?? false));
  };

  useEffect(() => {
    refreshLO();
    (window as any).electronAPI?.fileConvert?.checkPartialDownload().then((r: any) => {
      if (r?.hasPartial) setHasPartial(true);
    });
    return () => {
      (window as any).electronAPI?.fileConvert?.pauseDownload();
    };
  }, []);

  // 监听下载进度
  useEffect(() => {
    const api = (window as any).electronAPI?.fileConvert;
    if (!api) return;
    const unsub = api.onDownloadProgress((data: any) => {
      setDlProgress(data.progress);
      setDlStage(data.stage);
      if (data.stage === 'done') { setDownloading(false); setPaused(false); setLoAvail(true); setHasPartial(false); }
      if (data.stage === 'paused') { setDownloading(false); setPaused(true); }
      if (data.stage === 'error') { setDownloading(false); setPaused(false); setErr(data.error || '下载失败'); }
    });
    return () => { if (unsub) unsub(); };
  }, []);

  const startDownload = async (resume: boolean = false) => {
    // 已经装好了就不下载
    if (loAvailable) {
      setDlStage('done');
      return;
    }
    setDownloading(true); setPaused(false); setDlProgress(resume ? dlProgress : 0); setErr(null);
    const result = await (window as any).electronAPI?.fileConvert?.downloadLibreOffice(resume);
    if (result?.paused) { /* 暂停由 progress 事件处理 */ }
    else if (!result?.success) { setDownloading(false); setErr(result?.error || '下载失败'); }
  };

  const handlePause = async () => {
    await (window as any).electronAPI?.fileConvert?.pauseDownload();
  };

  const handleCleanup = async () => {
    await (window as any).electronAPI?.fileConvert?.cleanupDownload();
    setHasPartial(false); setDlProgress(0); setPaused(false); setErr(null);
  };

  const pick = async () => {
    const api = (window as any).electronAPI;
    const exts = tool.key === 'word2pdf' ? ['docx', 'doc'] : ['pdf'];
    const p = await api?.fileConvert?.pickFile(exts);
    if (!p) return;
    // 格式校验
    const ext = p.split('.').pop()?.toLowerCase();
    if (tool.key === 'word2pdf' && !['docx', 'doc'].includes(ext || '')) {
      setErr('仅支持 .docx / .doc 格式'); return;
    }
    if (tool.key === 'pdf2word' && ext !== 'pdf') {
      setErr('仅支持 .pdf 格式'); return;
    }
    setFile(p); setOutput(null); setErr(null);
  };

  const convert = async () => {
    if (!file) return;
    setConverting(true); setErr(null);
    try {
      if (tool.key === 'word2pdf') {
        // Word→PDF：本地 LibreOffice
        const out = await (window as any).electronAPI.fileConvert.convert(file, 'pdf');
        setOutput(out);
      } else {
        // PDF→Word：服务端 PyMuPDF + DeepSeek + python-docx
        const api = (window as any).electronAPI;
        const b64 = await api.fileConvert.readBase64(file);
        const filename = file.split(/[/\\]/).pop() || 'input.pdf';
        const token = await getToken();
        const res = await fetch(`${API_BASE}/api/tools/pdf-to-word-llm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ filename, data: b64 }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || '转换失败');
        }
        const blob = await res.blob();
        const buf = new Uint8Array(await blob.arrayBuffer());
        const outPath = await api.fileConvert.writeTemp(buf, 'docx');
        setOutput(outPath);
      }
    } catch (e: any) { setErr(e.message || '转换失败'); }
    finally { setConverting(false); }
  };


  const save = async () => {
    if (!output) return;
    await (window as any).electronAPI?.fileConvert?.saveOutput(output);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: tool.color + '15' }}><Icon className="w-5 h-5" style={{ color: tool.color }} strokeWidth={1.5}/></div>
          <h3 className="text-base font-bold text-zinc-900 dark:text-white">{tool.title}</h3>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      </div>

      {/* 引擎未安装 */}
      {!hasPartial && !paused && !downloading && !err && loAvailable === false && dlStage !== 'done' && (
        <div className="flex items-center justify-between p-4 rounded-xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/10 mb-4">
          <div className="text-sm font-semibold text-amber-700 dark:text-amber-400">此功能需要加载文件转换引擎</div>
          <button onClick={() => startDownload(false)} className="shrink-0 px-4 py-2 rounded-lg bg-amber-500 text-white text-[13px] font-semibold hover:bg-amber-600 transition-colors shadow-sm active:scale-[0.98]">
            加载引擎
          </button>
        </div>
      )}

      {/* 下载失败 */}
      {err && !downloading && (
        <div className="flex items-center justify-between p-4 rounded-xl bg-red-50 dark:bg-red-500/5 border border-red-200 dark:border-red-500/10 mb-4">
          <div>
            <div className="text-sm font-semibold text-red-700 dark:text-red-400">下载失败</div>
            <div className="text-[12px] text-red-600 dark:text-red-500 mt-0.5">{err}</div>
          </div>
          <button onClick={() => { setErr(null); startDownload(false); }} className="shrink-0 px-4 py-2 rounded-lg bg-red-500 text-white text-[13px] font-semibold hover:bg-red-600 transition-colors shadow-sm active:scale-[0.98]">
            重试
          </button>
        </div>
      )}

      {/* 有未完成的下载 */}
      {hasPartial && !downloading && !paused && !err && loAvailable === false && (
        <div className="flex items-center justify-between p-4 rounded-xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/10 mb-4">
          <div className="text-sm font-semibold text-amber-700 dark:text-amber-400">检测到未完成的下载，是否继续？</div>
          <div className="flex gap-2">
            <button onClick={handleCleanup} className="shrink-0 px-3 py-2 rounded-lg text-[12px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-amber-100 dark:hover:bg-amber-500/10 transition-colors">放弃</button>
            <button onClick={() => startDownload(true)} className="shrink-0 px-4 py-2 rounded-lg bg-amber-500 text-white text-[13px] font-semibold hover:bg-amber-600 transition-colors shadow-sm active:scale-[0.98]">
              继续下载
            </button>
          </div>
        </div>
      )}

      {/* 下载进度 */}
      {downloading && dlStage !== 'extracting' && (
        <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-500/5 border border-indigo-200 dark:border-indigo-500/10 mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-400">
              {dlStage === 'connecting' ? '正在连接…' : '正在下载引擎…'}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-indigo-600 dark:text-indigo-400 tabular-nums font-bold text-sm">{dlProgress}%</span>
              <button onClick={handlePause} className="px-3 py-1 rounded-lg bg-indigo-200 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-[12px] font-semibold hover:bg-indigo-300 dark:hover:bg-indigo-500/30 transition-colors active:scale-[0.98]">
                暂停
              </button>
            </div>
          </div>
          <div className="w-full h-2 rounded-full bg-indigo-200 dark:bg-indigo-500/20 overflow-hidden">
            <div className="h-full rounded-full bg-indigo-500 transition-all duration-300 ease-out" style={{ width: `${dlProgress}%` }} />
          </div>
        </div>
      )}

      {/* 安装进度 */}
      {downloading && dlStage === 'extracting' && (
        <div className="p-4 rounded-xl bg-indigo-50 dark:bg-indigo-500/5 border border-indigo-200 dark:border-indigo-500/10 mb-4 space-y-3">
          <div className="flex items-center gap-3">
            <svg className="animate-spin w-4 h-4 text-indigo-500 shrink-0" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            <div>
              <div className="text-sm font-semibold text-indigo-700 dark:text-indigo-400">正在安装引擎…</div>
              <div className="text-[11px] text-indigo-500 dark:text-indigo-400 mt-0.5">请稍候，安装完成后可立即使用</div>
            </div>
          </div>
        </div>
      )}

      {/* 已暂停 */}
      {paused && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/10 mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">已暂停下载</span>
            <span className="text-amber-600 dark:text-amber-400 tabular-nums font-bold text-sm">{dlProgress}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-amber-200 dark:bg-amber-500/20 overflow-hidden">
            <div className="h-full rounded-full bg-amber-500 transition-all duration-300 ease-out" style={{ width: `${dlProgress}%` }} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => startDownload(true)} className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-[13px] font-semibold hover:bg-amber-600 transition-colors shadow-sm active:scale-[0.98]">
              继续下载
            </button>
            <button onClick={handleCleanup} className="px-4 py-2 rounded-lg text-[12px] text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-amber-100 dark:hover:bg-amber-500/10 transition-colors">
              取消
            </button>
          </div>
        </div>
      )}

      {/* 安装完成（3 秒后自动消失） */}
      {!downloading && !paused && dlStage === 'done' && <DoneBanner onDone={() => setDlStage('')} />}

      {/* 转换区（引擎就绪后才显示） */}
      {loAvailable === true ? (
        <div className="border-2 border-dashed border-zinc-200 dark:border-zinc-700 rounded-2xl p-8 text-center">
          {file ? (
            <div className="space-y-4">
              <FileText className="w-10 h-10 text-indigo-400 mx-auto" strokeWidth={1}/>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 truncate">{file.split(/[/\\]/).pop()}</p>
              {output ? (
                <button onClick={save} className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-emerald-500 text-white text-[13px] font-semibold hover:bg-emerald-600 shadow-sm active:scale-[0.98] transition-all">
                  <Download className="w-4 h-4" strokeWidth={2}/>保存到本地
                </button>
              ) : (
                <button onClick={convert} disabled={converting}
                  className="h-10 px-5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[13px] font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-100 disabled:opacity-40 shadow-sm active:scale-[0.98] transition-all">
                  {converting ? '转换中…' : '开始转换'}
                </button>
              )}
              <button onClick={() => { setFile(null); setOutput(null); }} className="block mx-auto text-[12px] text-zinc-400 hover:text-zinc-600">重新选择</button>
            </div>
          ) : (
            <div className="space-y-4">
              <Download className="w-10 h-10 text-zinc-300 mx-auto" strokeWidth={1}/>
              <div>
                <p className="text-sm text-zinc-500">拖拽文件到此处</p>
                <p className="text-xs text-zinc-400 mt-1">或点击下方按钮选择文件</p>
              </div>
              <button onClick={pick}
                className="h-10 px-5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[13px] font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-100 shadow-sm active:scale-[0.98] transition-all">
                选择文件
              </button>
            </div>
          )}
          {err && <p className="text-xs text-red-500 mt-3">{err}</p>}
        </div>
      ) : null}
    </div>
  );
}

/** 下载完成横幅，用户手动关闭 */
function DoneBanner({ onDone }: { onDone: () => void }) {
  return (
    <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-500/5 border border-emerald-200 dark:border-emerald-500/10 mb-4 flex items-center justify-between animate-[fadeIn_200ms_ease-out]">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center">
          <svg className="w-4 h-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
        </div>
        <div>
          <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">转换引擎已就绪</div>
          <div className="text-[11px] text-emerald-600 dark:text-emerald-500 mt-0.5">可以开始转换文件了</div>
        </div>
      </div>
      <button onClick={onDone} className="shrink-0 px-3 py-1 rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-500/10 text-[12px] font-medium transition-colors">
        知道了
      </button>
    </div>
  );
}
