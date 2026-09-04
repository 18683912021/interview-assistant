/**
 * InterviewHistoryScreen —— 面试历史
 *
 * 主从布局：左列表 55% | 右详情 45%
 * 参考：Apple Mail / Gmail 三栏
 */
import { useEffect, useState, useCallback } from 'react';
import { Clock, MessageCircle, Trash2, FileText } from 'lucide-react';
import { getInterviewList, getInterviewDetail, clearInterviewHistory, type InterviewListItem, type InterviewDetail } from '../api/interview';
import ConversationBubble from '../components/ConversationBubble';

const LL: Record<string,string> = { javascript:'JavaScript',python:'Python',java:'Java',csharp:'C#',cpp:'C++',go:'Go' };
const LI: Record<string,string> = { javascript:'🟨',python:'🐍',java:'☕',csharp:'🟪',cpp:'🔷',go:'🔵' };

export default function InterviewHistoryScreen() {
  const [list, setList] = useState<InterviewListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string|null>(null);
  const [detail, setDetail] = useState<InterviewDetail|null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showClear, setShowClear] = useState(false);

  useEffect(() => { getInterviewList().then(setList).catch(()=>[]).finally(()=>setLoading(false)); }, []);

  const select = useCallback(async (id: string) => { setSelectedId(id); setDetailLoading(true); setDetail(null); try { setDetail(await getInterviewDetail(id)); } catch {} finally { setDetailLoading(false); } }, []);

  const handleClear = async () => { await clearInterviewHistory(); setList([]); setSelectedId(null); setDetail(null); setShowClear(false); };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 左列表 */}
      <div className="w-[55%] min-w-[360px] flex flex-col border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0F0F11]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
          <h2 className="text-base font-extrabold text-zinc-900 dark:text-white tracking-tight">面试历史</h2>
          {list.length > 0 && <button onClick={()=>setShowClear(true)} className="flex items-center gap-1.5 text-[13px] text-zinc-400 hover:text-red-500 font-medium transition-colors"><Trash2 className="w-3.5 h-3.5" strokeWidth={1.5}/>清空</button>}
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? <div className="p-8 text-center text-sm text-zinc-400">加载中…</div>
          : list.length === 0 ? <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8"><FileText className="w-10 h-10 text-zinc-300" strokeWidth={1}/><div className="text-sm font-semibold text-zinc-500">暂无面试记录</div><div className="text-xs text-zinc-400">完成面试后自动保存</div></div>
          : <div className="p-4 space-y-2">{list.map(item => (
            <button key={item.id} onClick={()=>select(item.id)} className={`w-full flex rounded-xl border transition-all hover:shadow-sm ${selectedId===item.id?'border-indigo-300 dark:border-indigo-600 bg-white dark:bg-[#141416] shadow-sm':'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141416] hover:border-zinc-300'}`}>
              <div className={`w-1 rounded-l-xl shrink-0 ${selectedId===item.id?'bg-indigo-500':'bg-transparent'}`}/>
              <div className="flex-1 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2"><span className="text-sm">{LI[item.programming_language]??'💬'}</span><span className="text-[13px] font-semibold text-zinc-900 dark:text-white">{LL[item.programming_language]??item.programming_language}</span></div>
                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-400"><MessageCircle className="w-3 h-3" strokeWidth={1.5}/>{item.message_count}</div>
                </div>
                <div className="flex items-center justify-between"><span className="text-[12px] text-zinc-500">{fmt(item.started_at)}</span><span className="flex items-center gap-1 text-[11px] text-zinc-400"><Clock className="w-3 h-3" strokeWidth={1.5}/>{dur(item.duration_seconds)}</span></div>
              </div>
            </button>
          ))}</div>}
        </div>
      </div>

      {/* 右详情 */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedId ? <div className="flex-1 flex items-center justify-center"><div className="text-center space-y-3"><FileText className="w-10 h-10 text-zinc-300 mx-auto" strokeWidth={1}/><span className="text-sm text-zinc-400">选择左侧记录查看详情</span></div></div>
        : detailLoading ? <div className="flex-1 flex items-center justify-center text-sm text-zinc-400">加载中…</div>
        : detail ? <>
          <div className="shrink-0 px-5 py-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0A0A0B]"><div className="flex items-center gap-6 text-sm">
            <M label="时间" v={fmt(detail.started_at)}/><M label="时长" v={dur(detail.duration_seconds)}/><M label="赛道" v={`${LI[detail.programming_language]??''} ${LL[detail.programming_language]??detail.programming_language}`}/><M label="对话" v={`${detail.conversation.length} 条`}/>
          </div></div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{detail.conversation.map(msg => <ConversationBubble key={msg.id} message={{...msg,status:'done'}}/>)}</div>
        </> : <div className="flex-1 flex items-center justify-center text-sm text-zinc-400">加载失败</div>}
      </div>

      {/* 清空确认 */}
      {showClear && <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 backdrop-blur-sm" onClick={()=>setShowClear(false)}><div className="bg-white dark:bg-[#141416] rounded-2xl p-6 w-80 shadow-xl shadow-black/10 border border-zinc-200 dark:border-zinc-800" onClick={e=>e.stopPropagation()}><h3 className="text-base font-bold text-zinc-900 dark:text-white mb-2">清空历史</h3><p className="text-sm text-zinc-500 mb-5">确定清空所有面试历史？不可恢复。</p><div className="flex gap-3 justify-end"><button onClick={()=>setShowClear(false)} className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800">取消</button><button onClick={handleClear} className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-600 shadow-sm">清空</button></div></div></div>}
    </div>
  );
}

function fmt(ts: number) { const d = new Date(ts*1000); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function dur(s: number) { const m = Math.floor(s/60); return m===0?`${s}秒`:`${m}分${s%60}秒`; }
function M({label,v}:{label:string;v:string}){return <div className="flex items-center gap-1.5"><span className="text-xs text-zinc-400">{label}</span><span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{v}</span></div>}
