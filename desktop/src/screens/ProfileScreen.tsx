/**
 * ProfileScreen —— 个人中心
 */
import { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Calendar, BarChart3, Globe, Edit3, FileUp, FileText, LogOut } from 'lucide-react';
import { AuthContext } from '../utils/AuthContext';
import { getProfile, saveProfile } from '../utils/token';
import { hasResume, uploadResume, getIntro } from '../api/resume';
import { updateProfile as updateProfileApi } from '../api/auth';
import type { UserProfile } from '../api/auth';
import { setProgLang, type ProgLang } from '../config';
import SubscriptionScreen from './SubscriptionScreen';
import Avatar from '../components/Avatar';

const LANGS: ProgLang[] = ['JavaScript', 'Java', 'Python', 'C#', 'C++', 'Go'];
const LANG_MAP: Record<string, ProgLang> = { javascript:'JavaScript',java:'Java',python:'Python','c#':'C#',csharp:'C#','c++':'C++',cpp:'C++',go:'Go',golang:'Go' };

function fmtTime(s: number) { return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
function fmtDate(ts: number) { const d=new Date(ts*1000); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

export default function ProfileScreen() {
  const { logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [p, setP] = useState<UserProfile|null>(null);
  const [label, setLabel] = useState('未上传');
  const [uploading, setUploading] = useState(false);
  const [lang, setLang] = useState<ProgLang>('JavaScript');
  const [showLang, setShowLang] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [showSub, setShowSub] = useState(false);
  const [intro, setIntro] = useState('');

  useEffect(() => {
    const refresh = () => {
      getProfile().then(p => { if(p){setP(p);const l=LANG_MAP[p.programming_language]||'JavaScript';setLang(l);setProgLang(l);} });
      hasResume().then(d => { if(d.has_intro) setLabel('已上传'); }).catch(()=>{});
    };
    refresh();
    // 页面可见时自动刷新（从其它页面切换回来时更新数据）
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const handleLang = async (l: ProgLang) => { setLang(l); setProgLang(l); setShowLang(false); try{const d=await updateProfileApi({programming_language:l.toLowerCase()});if(d.user){setP(d.user);await saveProfile(d.user);}}catch{} };
  const handleUpload = async () => {
    const api = (window as any).electronAPI; if(!api?.fileConvert) return;
    try{const fp=await api.fileConvert.pickFile(['pdf']);if(!fp)return;setUploading(true);setLabel('上传中…');const r=await fetch(`file://${fp}`);const b=await r.blob();const fd=new FormData();fd.append('file',b,fp.split(/[/\\]/).pop()||'resume.pdf');await uploadResume(fd);setLabel('已上传');}catch{setLabel('失败');}finally{setUploading(false);}
  };
  const loadIntro = async () => { setIntro(''); try{const d=await getIntro();setIntro(d.ok&&d.intro?d.intro:'');}catch{setIntro('');} };

  // Esc close modals
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if(e.key==='Escape'){setShowLang(false);setShowLogout(false);setShowSub(false);} };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const sections = [
    { title: '数据', items: [
      { icon: BarChart3, label: '面试历史', desc: `${p?.interview_count??0} 次`, action: () => navigate('/history') },
    ]},
    { title: '偏好', items: [
      { icon: Globe,     label: '面试赛道', desc: lang, action: () => setShowLang(true) },
      { icon: Edit3,     label: '答案风格', desc: p?.answer_style??'标准书面', action: ()=>{} },
      { icon: FileUp,    label: '简历上传', desc: uploading?'上传中…':label, action: handleUpload },
      { icon: FileText,  label: '自我介绍', desc: label==='已上传'?'点击查看':'需先上传', action: ()=>{if(label==='已上传'){loadIntro();}} },
    ]},
  ];

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* 左菜单 */}
      <nav className="w-[230px] shrink-0 bg-zinc-50 dark:bg-[#0F0F11] border-r border-zinc-200 dark:border-zinc-800 flex flex-col py-5">
        <div className="px-4 mb-5">
          <div className="flex items-center gap-3">
            <Avatar name={p?.name} size={40} />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{p?.name||'--'}</div>
              <span className="inline-block mt-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300">{p?.membership||'会员'}</span>
            </div>
          </div>
        </div>
        <div className="space-y-4 px-3 flex-1">
          {sections.map(sec => (
            <div key={sec.title}>
              <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1.5 px-3">{sec.title}</div>
              {sec.items.map(item => { const I=item.icon; return (
                <button key={item.label} onClick={item.action} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white dark:hover:bg-[#141416] text-left transition-all duration-150 group active:scale-[0.99]">
                  <I className="w-4 h-4 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 shrink-0" strokeWidth={1.5}/>
                  <div className="min-w-0 flex-1"><div className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">{item.label}</div><div className="text-[11px] text-zinc-400 truncate">{item.desc}</div></div>
                </button>
              );})}
            </div>
          ))}
        </div>
        <div className="px-3">
          <button onClick={()=>setShowLogout(true)} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-500/5 text-left transition-all duration-150 group active:scale-[0.99]">
            <LogOut className="w-4 h-4 text-zinc-400 group-hover:text-red-500 shrink-0 transition-colors duration-150" strokeWidth={1.5}/><span className="text-[13px] font-medium text-zinc-500 group-hover:text-red-500 transition-colors duration-150">退出登录</span>
          </button>
        </div>
      </nav>

      {/* 右内容 */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto p-8 space-y-6">
          <div className="bg-white dark:bg-[#141416] rounded-2xl p-6 shadow-sm border border-zinc-200 dark:border-zinc-800 hover:shadow-md transition-shadow duration-300">
            <div className="flex items-center gap-2 mb-3"><Clock className="w-4 h-4 text-zinc-400" strokeWidth={1.5}/><span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">剩余时长</span></div>
            <div className="text-[38px] font-extrabold tabular-nums text-zinc-900 dark:text-white tracking-tight">{p?fmtTime(p.remaining_seconds):'--:--:--'}</div>
            <div className="flex items-center justify-between mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-1.5 text-[13px] text-zinc-500"><Calendar className="w-3.5 h-3.5" strokeWidth={1.5}/><span>有效期至 {p?fmtDate(p.expires_at):'----'}</span></div>
              <button onClick={()=>setShowSub(true)} className="px-4 py-1.5 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[13px] font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-100 shadow-sm transition-all duration-150 active:scale-[0.98] hover:shadow-md">续费</button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Stat icon={BarChart3} val={`${p?.interview_count??0}`} label="面试次数"/>
            <Stat icon={FileUp} val={label==='已上传'?'✓':'—'} label="简历"/>
            <Stat icon={Globe} val={lang} label="赛道"/>
          </div>

          {intro && (
            <div className="bg-white dark:bg-[#141416] rounded-2xl p-6 shadow-sm border border-zinc-200 dark:border-zinc-800 hover:shadow-md transition-shadow duration-300">
              <div className="flex items-center gap-2 mb-4"><FileText className="w-4 h-4 text-zinc-400" strokeWidth={1.5}/><h3 className="text-sm font-bold text-zinc-900 dark:text-white">自我介绍</h3></div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{intro}</p>
            </div>
          )}

          <p className="text-center text-[11px] text-zinc-400 mt-8 pb-4">AI面试助手 v1.0.0</p>
        </div>
      </main>

      {showSub && <SubscriptionScreen onClose={()=>setShowSub(false)}/>}
      {showLang && <Modal title="选择面试赛道" onClose={()=>setShowLang(false)}><div className="space-y-1">{LANGS.map(l=><button key={l} onClick={()=>handleLang(l)} className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-all duration-150 active:scale-[0.99] ${l===lang?'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold':'hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400'}`}>{l}{l===lang&&<span className="w-2 h-2 rounded-full bg-indigo-500"/>}</button>)}</div></Modal>}
      {showLogout && <Modal title="退出登录" onClose={()=>setShowLogout(false)}><p className="text-sm text-zinc-500 mb-5">确定要退出当前账号吗？</p><div className="flex gap-3 justify-end"><button onClick={()=>setShowLogout(false)} className="px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all duration-150">取消</button><button onClick={logout} className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-all duration-150 shadow-sm active:scale-[0.98]">退出</button></div></Modal>}
    </div>
  );
}

function Stat({ icon:Icon, val, label }:{icon:any;val:string;label:string}) {
  return <div className="bg-white dark:bg-[#141416] rounded-xl p-4 border border-zinc-200 dark:border-zinc-800 text-center shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all duration-200">
    <Icon className="w-5 h-5 text-zinc-400 mx-auto mb-2" strokeWidth={1.5}/><div className="text-lg font-extrabold text-zinc-900 dark:text-white">{val}</div><div className="text-[11px] text-zinc-400 mt-1">{label}</div>
  </div>;
}

function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:any}) {
  return <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 backdrop-blur-sm" onClick={onClose}>
    <div className="bg-white dark:bg-[#141416] rounded-2xl p-6 max-w-lg w-full mx-4 shadow-xl shadow-black/10 border border-zinc-200 dark:border-zinc-800 animate-[scaleIn_150ms_ease-out]" onClick={e=>e.stopPropagation()}>
      <div className="flex items-center justify-between mb-5"><h3 className="text-base font-bold text-zinc-900 dark:text-white">{title}</h3>
        <button onClick={onClose} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all duration-150" title="关闭 (Esc)"><svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
      </div>
      {children}
    </div>
  </div>;
}
