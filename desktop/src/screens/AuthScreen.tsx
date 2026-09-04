/**
 * AuthScreen —— PC 桌面端登录 / 注册
 *
 * 参考 Linear / Notion / Vercel 设计风格。
 * 左品牌展示区（几何装饰 + 功能亮点）| 右表单区（卡片式登录）。
 * 图标使用 Lucide（ISC 协议，商用免费）。
 */
import { useState, useCallback } from 'react';
import { Mail, Key, ArrowRight, Zap, Mic, MessageSquare, Clock, Shield, Eye, EyeOff, Check } from 'lucide-react';
import { sendCode, checkEmail, login, loginPassword, register } from '../api/auth';
import { saveToken, refreshProfile } from '../utils/token';
import { useToast } from '../components/Toast';
import AgreementScreen from './AgreementScreen';

type AuthMode = 'login' | 'register';
type LoginSubMode = 'code' | 'password';

const features = [
  { icon: Mic, label: '实时语音转写', desc: '精准捕获面试官提问' },
  { icon: Zap, label: 'AI 即时回答', desc: 'DeepSeek 驱动高质量应答' },
  { icon: Clock, label: '面试历史回顾', desc: '每次面试自动保存复盘' },
];

interface Props { onLogin: () => void; }

export default function AuthScreen({ onLogin }: Props) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [subMode, setSubMode] = useState<LoginSubMode>('code');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showAgreement, setShowAgreement] = useState<'service' | 'privacy' | null>(null);
  const { toast } = useToast();
  const [showPwd, setShowPwd] = useState(false);
  const [emailErr, setEmailErr] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);
  const [pwdErr, setPwdErr] = useState('');
  const [pwdTouched, setPwdTouched] = useState(false);
  const [agreedTouched, setAgreedTouched] = useState(false);

  const isLogin = mode === 'login';
  const usePwd = isLogin && subMode === 'password';
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emailOk = EMAIL_RE.test(email.trim());
  const canSend = emailOk && countdown === 0;

  const handleSendCode = useCallback(async () => {
    if (!email.trim()) { setEmailTouched(true); setEmailErr('请输入邮箱'); return; }
    if (!emailOk) { setEmailTouched(true); setEmailErr('邮箱格式不正确'); return; }
    if (countdown > 0) return;
    try {
      const { exists } = await checkEmail(email.trim());
      if (isLogin && !exists) { setEmailErr('该邮箱未注册'); return; }
      if (!isLogin && exists) { setEmailErr('该邮箱已注册'); return; }
      setEmailErr('');
    } catch (_: any) { setEmailErr(_.detail || '网络错误'); return; }
    try {
      await sendCode(email.trim());
      setCountdown(60);
      const id = setInterval(() => setCountdown(c => { if (c <= 1) { clearInterval(id); return 0; } return c - 1; }), 1000);
    } catch (_: any) { setEmailErr(_.detail || '发送失败'); }
  }, [email, emailOk, countdown, isLogin]);

  const submit = useCallback(async () => {
    if (!agreed) { setAgreedTouched(true); return; }
    if (!email.trim() || !emailOk) { setEmailTouched(true); setEmailErr(!email.trim() ? '请输入邮箱' : '邮箱格式不正确'); return; }
    if (usePwd) { if (!password.trim()) { setPwdTouched(true); setPwdErr('请输入密码'); return; } }
    else if (isLogin) { if (!code.trim()) return; }
    else {
      if (!code.trim()) return;
      if (!password.trim()) { setPwdTouched(true); setPwdErr('请设置密码'); return; }
      if (password.length < 6) { setPwdTouched(true); setPwdErr('密码至少 6 位'); return; }
      if (password !== confirmPwd) { setPwdTouched(true); setPwdErr('两次密码不一致'); return; }
    }
    setLoading(true);
    try {
      let data;
      if (usePwd) data = await loginPassword(email.trim(), password);
      else if (isLogin) data = await login(email.trim(), code.trim());
      else data = await register(email.trim(), code.trim(), password);
      if (data.token) { await saveToken(data.token); await refreshProfile(); }
      onLogin();
    } catch (_: any) { toast(_.detail || '登录失败，请重试', 'error'); }
    finally { setLoading(false); }
  }, [isLogin, usePwd, email, code, password, confirmPwd, agreed, emailOk, onLogin]);

  const switchMode = () => {
    setMode(m => m === 'login' ? 'register' : 'login');
    setCode(''); setPassword(''); setConfirmPwd(''); setEmailErr(''); setPwdErr('');
    setEmailTouched(false); setPwdTouched(false); setAgreedTouched(false); setSubMode('code');
  };

  const btnDisabled = !agreed || loading;

  return (
    <div className="h-full flex bg-white dark:bg-[#0A0A0B]">
      {/* ═══════════════ 左 · 品牌区 ═══════════════ */}
      <div className="hidden lg:flex w-[48%] relative overflow-hidden bg-gradient-to-br from-[#0A0A10] via-[#100F1A] to-[#0A0A10]">
        {/* 主体 SVG 几何装饰 */}
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 800 900" fill="none" opacity="0.7">
          {/* 大圆环 */}
          <circle cx="700" cy="100" r="300" stroke="#818CF8" strokeWidth="1" strokeDasharray="6 12" opacity="0.25" />
          <circle cx="700" cy="100" r="200" stroke="#6366F1" strokeWidth="1.5" strokeDasharray="3 9" opacity="0.18" />
          {/* 底部圆环 */}
          <circle cx="-100" cy="800" r="350" stroke="#A78BFA" strokeWidth="1" strokeDasharray="6 12" opacity="0.22" />
          <circle cx="-50" cy="780" r="240" stroke="#C4B5FD" strokeWidth="1" strokeDasharray="3 8" opacity="0.12" />
          {/* 水平线网格 */}
          <line x1="0" y1="150" x2="800" y2="150" stroke="#3F3F46" strokeWidth="0.5" opacity="0.6" />
          <line x1="0" y1="300" x2="800" y2="300" stroke="#3F3F46" strokeWidth="0.5" opacity="0.4" />
          <line x1="0" y1="450" x2="800" y2="450" stroke="#3F3F46" strokeWidth="0.5" opacity="0.6" />
          <line x1="0" y1="600" x2="800" y2="600" stroke="#3F3F46" strokeWidth="0.5" opacity="0.3" />
          <line x1="0" y1="750" x2="800" y2="750" stroke="#3F3F46" strokeWidth="0.5" opacity="0.5" />
          {/* 虚线方框 */}
          <rect x="50" y="80" width="220" height="220" rx="12" stroke="#818CF8" strokeWidth="1.2" strokeDasharray="6 12" transform="rotate(12 160 190)" opacity="0.3" />
          <rect x="540" y="580" width="180" height="180" rx="12" stroke="#A78BFA" strokeWidth="1.2" strokeDasharray="6 12" transform="rotate(-8 630 670)" opacity="0.3" />
          {/* 点缀小圆点 */}
          <circle cx="380" cy="80" r="3" fill="#818CF8" opacity="0.4" />
          <circle cx="650" cy="430" r="2.5" fill="#A78BFA" opacity="0.35" />
          <circle cx="120" cy="550" r="3.5" fill="#6366F1" opacity="0.3" />
          <circle cx="450" cy="700" r="2" fill="#C4B5FD" opacity="0.4" />
          <circle cx="200" cy="300" r="2" fill="#818CF8" opacity="0.3" />
          <circle cx="580" cy="200" r="2.5" fill="#A78BFA" opacity="0.35" />
        </svg>

        {/* 渐变光晕 */}
        <div className="absolute top-[-15%] right-[-5%] w-[600px] h-[600px] rounded-full bg-gradient-to-br from-indigo-500/25 via-violet-500/10 to-transparent blur-[80px]" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-gradient-to-tr from-violet-600/20 via-fuchsia-500/8 to-transparent blur-[100px]" />
        <div className="absolute top-[30%] left-[20%] w-[300px] h-[300px] rounded-full bg-indigo-400/8 blur-[60px]" />

        {/* 内容 */}
        <div className="relative z-10 flex flex-col justify-center px-16 w-full">
          {/* Logo */}
          <div className="flex items-center gap-4 mb-16">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
              <MessageSquare className="w-5 h-5 text-white" strokeWidth={2} />
            </div>
            <span className="text-lg font-bold text-white tracking-tight">AI 面试助手</span>
          </div>

          {/* 标题 */}
          <h1 className="text-[42px] font-extrabold text-white leading-[1.15] tracking-tight mb-4">
            {isLogin ? '欢迎回来' : '创建账号'}
          </h1>
          <p className="text-base text-zinc-300 leading-relaxed mb-14 max-w-sm">
            {isLogin
              ? '登录后开始你的 AI 辅助面试之旅'
              : '注册即享 AI 实时转写与智能回答'}
          </p>

          {/* 功能亮点 */}
          <div className="space-y-5">
            {features.map((f, i) => {
              const Icon = f.icon;
              return (
                <div key={i} className="flex items-start gap-4 group">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.08] flex items-center justify-center shrink-0 group-hover:bg-white/[0.14] transition-colors ring-1 ring-white/[0.06]">
                    <Icon className="w-4 h-4 text-indigo-300" strokeWidth={1.5} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-zinc-100">{f.label}</div>
                    <div className="text-sm text-zinc-400 mt-0.5">{f.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══════════════ 右 · 表单区 ═══════════════ */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white dark:bg-[#0A0A0B]">
        <div className="w-full max-w-[400px]">

          {/* 移动端品牌区 (lg 以下可见) */}
          <div className="lg:hidden mb-10">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/25">
                <MessageSquare className="w-5 h-5 text-white" strokeWidth={2} />
              </div>
              <span className="text-lg font-bold text-zinc-900 dark:text-white">AI 面试助手</span>
            </div>
            <h1 className="text-3xl font-extrabold text-zinc-900 dark:text-white tracking-tight">
              {isLogin ? '欢迎回来' : '创建账号'}
            </h1>
            <p className="text-sm text-zinc-500 mt-2">{isLogin ? '登录后开始你的 AI 面试之旅' : '注册即享 AI 实时转写与智能回答'}</p>
          </div>

          {/* 表单卡片 */}
          <div className="space-y-5">
            {/* 邮箱 */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider ml-0.5">
                邮箱地址
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" strokeWidth={1.5} />
                <input
                  type="email" value={email} autoCapitalize="off"
                  onChange={e => { setEmail(e.target.value); if (emailErr) setEmailErr(''); }}
                  onBlur={() => { setEmailTouched(true); if (!email.trim()) setEmailErr('请输入邮箱'); else if (!emailOk) setEmailErr('邮箱格式不正确'); }}
                  placeholder="name@example.com"
                  className={`w-full h-12 pl-10 pr-4 rounded-xl border bg-white dark:bg-[#141416] text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 transition-all outline-none
                    ${emailTouched && emailErr
                      ? 'border-red-300 dark:border-red-700 ring-2 ring-red-100 dark:ring-red-900/30'
                      : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 focus:border-indigo-400 dark:focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-500/15'
                    }`}
                />
              </div>
              {emailTouched && emailErr && (
                <p className="text-xs text-red-500 ml-1">{emailErr}</p>
              )}
            </div>

            {/* 验证码（非密码登录模式） */}
            {!usePwd && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider ml-0.5">
                  验证码
                </label>
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <Shield className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" strokeWidth={1.5} />
                    <input
                      type="text" value={code}
                      onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="6 位数字" maxLength={6}
                      className="w-full h-12 pl-10 pr-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#141416] text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none focus:border-indigo-400 dark:focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-500/15 transition-all"
                    />
                  </div>
                  <button
                    onClick={handleSendCode}
                    disabled={!canSend}
                    className="h-12 px-5 rounded-xl text-sm font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
                  >
                    {countdown > 0 ? `${countdown}s 后重发` : '发送验证码'}
                  </button>
                </div>
              </div>
            )}

            {/* 密码 */}
            {(usePwd || !isLogin) && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider ml-0.5">
                    {usePwd ? '密码' : '设置密码'}
                  </label>
                  <div className="relative">
                    <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" strokeWidth={1.5} />
                    <input
                      type={showPwd ? 'text' : 'password'}
                      value={password}
                      onChange={e => { setPassword(e.target.value); if (pwdErr) setPwdErr(''); }}
                      placeholder={usePwd ? '输入登录密码' : '至少 6 位字符'}
                      className={`w-full h-12 pl-10 pr-12 rounded-xl border bg-white dark:bg-[#141416] text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none transition-all
                        ${pwdTouched && pwdErr
                          ? 'border-red-300 dark:border-red-700 ring-2 ring-red-100 dark:ring-red-900/30'
                          : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 focus:border-indigo-400 dark:focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-500/15'
                        }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd(!showPwd)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                    >
                      {showPwd ? <EyeOff className="w-4 h-4" strokeWidth={1.5} /> : <Eye className="w-4 h-4" strokeWidth={1.5} />}
                    </button>
                  </div>
                </div>
                {/* 确认密码 */}
                {!isLogin && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider ml-0.5">
                      确认密码
                    </label>
                    <div className="relative">
                      <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" strokeWidth={1.5} />
                      <input
                        type={showPwd ? 'text' : 'password'}
                        value={confirmPwd}
                        onChange={e => { setConfirmPwd(e.target.value); if (pwdErr) setPwdErr(''); }}
                        placeholder="再次输入密码"
                        className={`w-full h-12 pl-10 pr-4 rounded-xl border bg-white dark:bg-[#141416] text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 outline-none transition-all
                          ${pwdTouched && pwdErr
                            ? 'border-red-300 dark:border-red-700 ring-2 ring-red-100 dark:ring-red-900/30'
                            : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 focus:border-indigo-400 dark:focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-500/15'
                          }`}
                      />
                    </div>
                    {pwdTouched && pwdErr && <p className="text-xs text-red-500 ml-1">{pwdErr}</p>}
                  </div>
                )}
              </>
            )}

            {/* 登录模式：验证码/密码切换 */}
            {isLogin && (
              <div className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => setSubMode('code')}
                  className={`pb-0.5 border-b-2 transition-colors ${subMode === 'code' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 font-semibold' : 'border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
                >
                  验证码登录
                </button>
                <span className="text-zinc-300 dark:text-zinc-700">·</span>
                <button
                  onClick={() => setSubMode('password')}
                  className={`pb-0.5 border-b-2 transition-colors ${subMode === 'password' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 font-semibold' : 'border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
                >
                  密码登录
                </button>
              </div>
            )}

            {/* 协议 */}
            <div>
              <button
                onClick={() => { setAgreed(!agreed); setAgreedTouched(false); }}
                className="flex items-start gap-2.5 group text-left"
              >
                <span className={`w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center shrink-0 mt-[1px] transition-all ${
                  agreedTouched && !agreed
                    ? 'border-red-400'
                    : agreed
                      ? 'border-indigo-500 bg-indigo-500'
                      : 'border-zinc-300 dark:border-zinc-600 group-hover:border-indigo-400'
                }`}>
                  {agreed && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed select-none">
                  已阅读并同意 <span className="text-indigo-600 dark:text-indigo-400 font-medium cursor-pointer hover:underline" onClick={(e) => { e.stopPropagation(); setShowAgreement('service'); }}>服务协议</span> 和 <span className="text-indigo-600 dark:text-indigo-400 font-medium cursor-pointer hover:underline" onClick={(e) => { e.stopPropagation(); setShowAgreement('privacy'); }}>隐私政策</span>
                </span>
              </button>
              {agreedTouched && !agreed && (
                <p className="text-xs text-red-500 mt-2 ml-[26px]">请先同意服务协议和隐私政策</p>
              )}
            </div>

            {/* 提交 */}
            <button
              onClick={submit}
              disabled={btnDisabled}
              className={`w-full h-12 rounded-xl text-sm font-bold tracking-wide flex items-center justify-center gap-2 transition-all
                ${btnDisabled
                  ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed'
                  : 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 shadow-lg shadow-zinc-900/10 active:scale-[0.98]'
                }`}
            >
              {loading ? (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <>
                  <span>{isLogin ? '登 录' : '注 册'}</span>
                  <ArrowRight className="w-4 h-4" strokeWidth={2} />
                </>
              )}
            </button>
          </div>

          {/* 模式切换 */}
          <div className="mt-8 text-center">
            <span className="text-sm text-zinc-400">{isLogin ? '还没有账号？' : '已有账号？'}</span>{' '}
            <button onClick={switchMode} className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 transition-colors">
              {isLogin ? '创建账号' : '去登录'}
            </button>
          </div>
        </div>
      </div>

      {/* 协议弹窗 */}
      {showAgreement && <AgreementScreen type={showAgreement} onClose={() => setShowAgreement(null)} />}
    </div>
  );
}
