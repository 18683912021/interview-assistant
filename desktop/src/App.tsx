import {useCallback, useEffect, useRef, useState} from 'react';
import {HashRouter, Navigate, Route, Routes, useLocation, useNavigate} from 'react-router-dom';
import {AudioLines, ChevronsUpDown, Files, Grid2X2, History, Settings} from 'lucide-react';
import {WorkspaceDraftProvider} from './utils/WorkspaceDraftContext';
import {AuthContext} from './utils/AuthContext';
import {useDarkMode} from './theme/tokens';
import {useKeyboardShortcuts} from './hooks/useKeyboardShortcuts';
import {clearProfile, clearToken, getProfile as cachedProfile, verifyToken} from './utils/token';
import {getProfile, logoutSession, type UserProfile} from './api/auth';
import {ApiError, AUTH_EXPIRED_EVENT, messageOf} from './api/client';
import {isInterviewActive, onInterviewActiveChange} from './utils/interviewState';
import {ToastProvider, useToast} from './components/Toast';
import {ErrorState, Loading, ProfileAvatar} from './components/WorkspaceUI';
import AuthScreen from './screens/AuthScreen';
import InterviewScreen from './screens/InterviewScreen';
import OverlayScreen from './screens/OverlayScreen';
import InterviewHistoryScreen from './screens/InterviewHistoryScreen';
import InterviewDetailScreen from './screens/InterviewDetailScreen';
import MaterialsScreen from './screens/MaterialsScreen';
import ToolsScreen from './screens/ToolsScreen';
import SettingsScreen from './screens/SettingsScreen';
import {DesktopFrame} from './components/DesktopFrame';

export default function App() {
  useDarkMode();
  return (
    <ToastProvider>
      <HashRouter>
        <DesktopFrame><SessionApp /></DesktopFrame>
      </HashRouter>
    </ToastProvider>
  );
}
function SessionApp() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'guest' | 'error'>('checking');
  const [profile, setProfile] = useState<UserProfile | null>(null),
    [error, setError] = useState('');
  const {toast} = useToast();
  const logoutPending = useRef(false);
  const navigate = useNavigate();
  const boot = useCallback(async () => {
    setStatus('checking');
    setError('');
    try {
      const email = await verifyToken();
      if (email) {
        setProfile(await cachedProfile());
        setStatus('ready');
      } else {
        setProfile(null);
        setStatus('guest');
      }
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        await clearToken();
        await clearProfile();
        setProfile(null);
        setStatus('guest');
      } else {
        setError(messageOf(e));
        setStatus('error');
      }
    }
  }, []);
  useEffect(() => {
    void boot();
  }, [boot]);
  useEffect(() => {
    const expired = () => {
      const desktop = window.electronAPI;
      if (desktop) {
        void Promise.allSettled([desktop.audio.clearAnswer(), desktop.window.closeOverlay()]);
        // Stop can deliver a final in-flight answer; clear it after the connection closes too.
        void desktop.audio
          .stopCapture()
          .finally(() => desktop.audio.clearAnswer())
          .catch(() => {});
      }
      void clearToken();
      void clearProfile();
      setProfile(null);
      setStatus('guest');
      toast('登录已失效，请重新登录', 'warning');
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  }, [toast]);
  const logout = async () => {
    if (logoutPending.current) return;
    if (isInterviewActive()) {
      toast('请先结束当前面试并完成保存，再退出登录', 'warning');
      return;
    }
    logoutPending.current = true;
    try {
      await logoutSession();
      // A failed optional window IPC must not retain a server-revoked login.
      await Promise.allSettled([
        window.electronAPI?.audio.clearAnswer(),
        window.electronAPI?.window.closeOverlay(),
        clearToken(),
        clearProfile(),
      ]);
      setProfile(null);
      setStatus('guest');
      navigate('/history', {replace: true});
    } catch (e) {
      toast(messageOf(e), 'error');
    } finally {
      logoutPending.current = false;
    }
  };
  const refreshProfile = async () => {
    const result = await getProfile();
    setProfile(result.user);
  };
  if (status === 'checking') return <Loading text="正在连接你的工作空间…" />;
  if (status === 'error')
    return (
      <div className="empty-state">
        <h2>暂时无法连接工作空间</h2>
        <p>登录信息已保留，连接恢复后可以继续。</p>
        <ErrorState message={error} retry={() => void boot()} />
      </div>
    );
  if (status === 'guest')
    return (
      <AuthScreen
        onLogin={async () => {
          await boot();
          navigate('/history', {replace: true});
        }}
      />
    );
  return (
    <AuthContext.Provider value={{profile, logout, refreshProfile}}>
      <WorkspaceDraftProvider>
        <AuthenticatedApp profile={profile} />
      </WorkspaceDraftProvider>
    </AuthContext.Provider>
  );
}
function AuthenticatedApp({profile}: {profile: UserProfile | null}) {
  const location = useLocation(),
    navigate = useNavigate(),
    {toast} = useToast();
  const [active, setActive] = useState(isInterviewActive);
  useEffect(() => onInterviewActiveChange(setActive), []);
  const guarded = active && location.pathname !== '/interview' && location.pathname !== '/overlay';
  useEffect(() => {
    if (guarded) {
      toast('面试进行中，请先结束并保存，再切换页面', 'warning');
      navigate('/interview', {replace: true});
    }
  }, [guarded, navigate, toast]);
  const go = (path: string) => {
    if (isInterviewActive() && path !== '/interview') {
      toast('面试进行中，请先结束并保存，再切换页面', 'warning');
      return;
    }
    navigate(path);
  };
  useKeyboardShortcuts({
    'Ctrl+1': () => go('/history'),
    'Ctrl+2': () => go('/materials'),
    'Ctrl+3': () => go('/tools'),
    'Ctrl+,': () => go('/settings'),
    'Ctrl+B': () => {
      void window.electronAPI?.window?.toggleOverlay();
    },
  });
  const path = guarded ? '/interview' : location.pathname;
  if (path === '/overlay') return <OverlayScreen />;
  const session = path === '/interview' || path.startsWith('/history/');
  const navigation = [
    {path: '/history', label: '面试记录', icon: History},
    {path: '/materials', label: '我的资料', icon: Files},
    {path: '/tools', label: '小工具', icon: Grid2X2},
  ];
  const title =
    path === '/settings'
      ? '设置'
      : navigation.find(item => item.path === path)?.label || '个人空间';
  const name = profile?.name || profile?.email?.split('@')[0] || '我的账号';
  return (
    <div className="app-shell">
      {!session && (
        <aside className="app-sidebar">
          <div className="app-brand">
            <span className="brand-mark">
              <AudioLines />
            </span>
            <strong>面试助手</strong>
          </div>
          <span className="nav-label">工作空间</span>
          <nav className="side-nav" aria-label="主要导航">
            {navigation.map(item => (
              <button
                key={item.path}
                className={`side-link ${path === item.path ? 'active' : ''}`}
                aria-current={path === item.path ? 'page' : undefined}
                aria-label={item.label}
                title={item.label}
                onClick={() => go(item.path)}>
                <item.icon />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <button
              className={`side-link ${path === '/settings' ? 'active' : ''}`}
              aria-label="设置"
              title="设置"
              onClick={() => go('/settings')}>
              <Settings />
              <span>设置</span>
            </button>
            <button
              aria-label={`账号设置 · ${name}`}
              title={name}
              className="account-button"
              onClick={() => go('/settings?tab=account')}>
              <ProfileAvatar name={name} avatar={profile?.avatar} />
              <span>
                <strong>{name}</strong>
                <small>个人空间</small>
              </span>
              <ChevronsUpDown size={13} />
            </button>
          </div>
        </aside>
      )}
      <main className="app-main">
        {!session && (
          <header className="app-topbar">
            <span>个人空间</span>
            <span className="slash">/</span>
            <span>{title}</span>
          </header>
        )}
        <div className="route-content">
          <Routes location={guarded ? '/interview' : location}>
            <Route path="/" element={<Navigate to="/history" replace />} />
            <Route path="/history" element={<InterviewHistoryScreen />} />
            <Route path="/history/:id" element={<InterviewDetailScreen />} />
            <Route path="/interview" element={<InterviewScreen />} />
            <Route path="/materials" element={<MaterialsScreen />} />
            <Route path="/tools" element={<ToolsScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="/profile" element={<Navigate to="/settings?tab=account" replace />} />
            <Route path="*" element={<Navigate to="/history" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
