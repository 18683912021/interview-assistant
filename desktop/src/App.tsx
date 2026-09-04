/**
 * App 根组件 —— 全局布局：Toolbar | 页面内容 | 状态栏
 *
 * 设计参考：Linear（侧边栏 / 快捷键）、VS Code（状态栏）
 * 图标库：Lucide（ISC 协议，商用免费）
 */
import { useState, useEffect, useCallback } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { MessageSquare, Mic, Wrench, User, Shield, ShieldOff } from 'lucide-react';
import { AuthContext } from './utils/AuthContext';
import { useDarkMode } from './theme/tokens';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { verifyToken, clearToken, clearProfile } from './utils/token';
import { isInterviewActive } from './utils/interviewState';
import { useToast } from './components/Toast';
import InterviewScreen from './screens/InterviewScreen';
import ToolsScreen from './screens/ToolsScreen';
import ProfileScreen from './screens/ProfileScreen';
import InterviewHistoryScreen from './screens/InterviewHistoryScreen';
import AuthScreen from './screens/AuthScreen';
import OverlayScreen from './screens/OverlayScreen';
import { ToastProvider } from './components/Toast';

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [checking, setChecking] = useState(true);
  useDarkMode();

  useEffect(() => {
    verifyToken().then(email => { setIsLoggedIn(!!email); setChecking(false); });
  }, []);

  const logout = useCallback(() => { clearToken(); clearProfile(); setIsLoggedIn(false); }, []);

  if (checking) {
    return (
      <div className="h-full flex items-center justify-center bg-white dark:bg-[#0A0A0B]">
        <div className="flex items-center gap-3">
          <svg className="animate-spin w-4 h-4 text-zinc-400" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
          <span className="text-sm text-zinc-400">加载中...</span>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ logout }}>
      <ToastProvider>
        <HashRouter>
          <KeyboardShortcutHandler />
          {isLoggedIn ? <AuthenticatedApp /> : <AuthScreen onLogin={() => setIsLoggedIn(true)} />}
        </HashRouter>
      </ToastProvider>
    </AuthContext.Provider>
  );
}

/* ═══════════════════════════════════════════
   登录后的完整 App 壳
   ═══════════════════════════════════════════ */
function AuthenticatedApp() {
  const location = useLocation();
  const activeKey = location.pathname.replace('/', '') || 'interview';

  const tabs = [
    { key: 'interview', label: '面试', icon: Mic },
    { key: 'tools',     label: '工具箱', icon: Wrench },
    { key: 'profile',   label: '我的',   icon: User },
  ];

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#0A0A0B] select-none">
      {/* ── Toolbar ── */}
      <Toolbar tabs={tabs} activeKey={activeKey} />

      {/* ── 页面内容 ── */}
      <div className="flex-1 flex overflow-hidden">
        <Routes>
          <Route path="/"        element={<Navigate to="/interview" />} />
          <Route path="/interview" element={<InterviewScreen />} />
          <Route path="/tools"     element={<ToolsScreen />} />
          <Route path="/profile"   element={<ProfileScreen />} />
          <Route path="/history"   element={<InterviewHistoryScreen />} />
          <Route path="/overlay"   element={<OverlayScreen />} />
        </Routes>
      </div>

      {/* ── 状态栏 ── */}
      <StatusBar />
    </div>
  );
}

/* ═══════════════════════════════════════════
   Toolbar
   ═══════════════════════════════════════════ */
function Toolbar({ tabs, activeKey }: {
  tabs: { key: string; label: string; icon: any }[];
  activeKey: string;
}) {
  const navigate = useNavigate();
  const [stealth, setStealth] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    (window as any).electronAPI?.window?.getContentProtection().then((on: boolean) => setStealth(on));
  }, []);

  const toggle = () => {
    (window as any).electronAPI?.window?.toggleContentProtection().then((on: boolean) => setStealth(on));
  };

  const goTab = (key: string) => {
    if (key !== 'interview' && isInterviewActive()) {
      toast('面试进行中，请先结束当前面试', 'warning');
      return;
    }
    navigate(`/${key}`);
  };

  return (
    <header className="h-11 shrink-0 bg-white dark:bg-[#0A0A0B] border-b border-zinc-200 dark:border-zinc-800 flex items-center px-4">
      {/* Logo */}
      <div className="flex items-center gap-2.5 mr-6">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-sm shadow-indigo-500/20">
          <MessageSquare className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
        </div>
        <span className="text-sm font-bold text-zinc-900 dark:text-white tracking-tight">AI 面试助手</span>
      </div>

      {/* Nav Tabs */}
      <nav className="flex items-center h-full">
        {tabs.map(t => {
          const Icon = t.icon;
          const active = t.key === activeKey;
          return (
            <button
              key={t.key}
              onClick={() => goTab(t.key)}
              className={`h-full px-4 flex items-center gap-2 text-[13px] font-medium border-b-[2px] transition-colors ${
                active
                  ? 'border-zinc-900 dark:border-white text-zinc-900 dark:text-white'
                  : 'border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
              }`}
            >
              <Icon className="w-4 h-4" strokeWidth={active ? 2 : 1.5} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* 右侧：隐身开关 */}
      <div className="ml-auto flex items-center">
        <button
          onClick={toggle}
          className={`flex items-center gap-2 h-8 px-3 rounded-full text-[12px] font-semibold transition-all duration-200 active:scale-95 ${
            stealth
              ? 'bg-indigo-500 text-white shadow-sm shadow-indigo-500/25 hover:bg-indigo-600'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700'
          }`}
          title={stealth ? '隐身模式已开启：屏幕共享中不可见' : '点击开启隐身模式：屏幕共享中隐藏窗口'}
        >
          {/* 圆点指示器 */}
          <span className={`relative flex h-4 w-4 items-center justify-center`}>
            <span className={`absolute w-2.5 h-2.5 rounded-full transition-all duration-200 ${
              stealth ? 'bg-white scale-100' : 'bg-zinc-400 dark:bg-zinc-500 scale-75'
            }`} />
            <span className={`absolute w-4 h-4 rounded-full border-2 transition-all duration-200 ${
              stealth ? 'border-white/30 scale-100' : 'border-transparent scale-0'
            }`} />
          </span>
          {stealth ? (
            <span className="flex items-center gap-1">
              隐身中
              <Shield className="w-3 h-3" strokeWidth={2.5} />
            </span>
          ) : (
            <span className="flex items-center gap-1">
              隐身
              <ShieldOff className="w-3 h-3" strokeWidth={1.5} />
            </span>
          )}
        </button>
      </div>
    </header>
  );
}

/* ═══════════════════════════════════════════
   状态栏
   ═══════════════════════════════════════════ */
function StatusBar() {
  return (
    <footer className="h-7 shrink-0 bg-zinc-50 dark:bg-[#0F0F11] border-t border-zinc-200 dark:border-zinc-800 flex items-center px-4 gap-4 text-[11px] text-zinc-400 select-none">
      <span><kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-[#141416] border border-zinc-200 dark:border-zinc-700 font-mono text-[10px] text-zinc-500">Ctrl+1/2/3</kbd> 切换页面</span>
      <span><kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-[#141416] border border-zinc-200 dark:border-zinc-700 font-mono text-[10px] text-zinc-500">Ctrl+B</kbd> 浮窗</span>
      <span><kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-[#141416] border border-zinc-200 dark:border-zinc-700 font-mono text-[10px] text-zinc-500">Ctrl+Shift+P</kbd> 隐身</span>
    </footer>
  );
}

/* ═══════════════════════════════════════════
   快捷键
   ═══════════════════════════════════════════ */
function KeyboardShortcutHandler(): null {
  const navigate = useNavigate();
  useKeyboardShortcuts({
    'Ctrl+1': () => navigate('/interview'),
    'Ctrl+2': () => navigate('/tools'),
    'Ctrl+3': () => navigate('/profile'),
    'Ctrl+,': () => navigate('/profile'),
    'Ctrl+B': () => { (window as any).electronAPI?.window?.toggleOverlay(); },
    'Ctrl+Shift+P': () => { (window as any).electronAPI?.window?.toggleContentProtection?.(); },
    'Ctrl+Shift+A': () => { (window as any).electronAPI?.window?.setAlwaysOnTop?.(true); },
  });
  return null;
}
