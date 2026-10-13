import {useEffect, useLayoutEffect, useRef, useState, type FormEvent} from 'react';
import {
  AudioLines,
  ArrowRight,
  BriefcaseBusiness,
  CheckCheck,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  LockKeyhole,
  LoaderCircle,
  Mail,
} from 'lucide-react';
import {login, loginPassword, register, resetPassword, sendCode} from '../api/auth';
import {messageOf} from '../api/client';
import {saveToken} from '../utils/token';
import {ErrorState} from '../components/WorkspaceUI';

type AuthField = 'email' | 'code' | 'password';
type FieldErrors = Partial<Record<AuthField, string>>;
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

type Mode = 'login' | 'register' | 'reset';
export default function AuthScreen({onLogin}: {onLogin: () => void | Promise<void>}) {
  const scrollContainer = useRef<HTMLDivElement>(null);
  const previousMode = useRef<Mode>('login');
  const emailInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [capsLock, setCapsLock] = useState(false);
  const focusField = (field: AuthField) => ({email: emailInput, code: codeInput, password: passwordInput})[field].current?.focus();
  const clearField = (field: AuthField) => {setFieldErrors(old => ({...old, [field]: undefined})); setError('');};
  const [mode, setMode] = useState<Mode>('login'),
    [method, setMethod] = useState<'code' | 'password'>('code');
  const [email, setEmail] = useState(''),
    [code, setCode] = useState(''),
    [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false),
    [busy, setBusy] = useState(false),
    [sending, setSending] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [deadlines, setDeadlines] = useState<Record<string, number>>({}),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const normalizedEmail = email.trim().toLowerCase(),
    purpose = mode === 'reset' ? 'reset_password' : mode,
    cooldownKey = `${purpose}:${normalizedEmail}`,
    remaining = Math.max(0, Math.ceil(((deadlines[cooldownKey] || 0) - now) / 1000));
  const needCode = mode !== 'login' || method === 'code',
    needPassword = mode !== 'login' || method === 'password';
  useLayoutEffect(() => {
    if (previousMode.current === mode) return;
    previousMode.current = mode;
    if (scrollContainer.current) scrollContainer.current.scrollTop = 0;
    emailInput.current?.focus({preventScroll: true});
  }, [mode]);
  function changeMode(next: Mode) {
    setMode(next);
    setFieldErrors({});
    setCapsLock(false);
    setError('');
    setNotice('');
    setCode('');
    setPassword('');
    setShowPassword(false);
  }
  function showFailure(value: unknown) {
    const message = messageOf(value);
    const field: AuthField | undefined = /^验证码(错误|无效|已过期)/.test(message) ? 'code'
      : message === '密码错误' ? 'password'
      : /^该邮箱(未注册|已注册)/.test(message) ? 'email' : undefined;
    if (field) {
      setFieldErrors(old => ({...old, [field]: message}));
      window.requestAnimationFrame(() => focusField(field));
    } else setError(message);
  }
  async function requestCode() {
    if (busy || sending || remaining > 0) return;
    if (!validEmail(normalizedEmail)) {
      setFieldErrors(old => ({...old, email: '请输入有效的邮箱地址，例如 name@example.com'}));
      focusField('email');
      return;
    }
    setSending(true);
    setError('');
    setNotice('');
    try {
      const result = await sendCode(normalizedEmail, purpose);
      if (!result.ok) throw new Error(result.message || '验证码发送失败');
      setDeadlines(old => ({
        ...old,
        [cooldownKey]: Date.now() + Math.max(result.cooldown || 60, 1) * 1000,
      }));
      setNotice(result.message || `验证码已发送至 ${normalizedEmail}，请查看收件箱或垃圾邮件。`);
      window.requestAnimationFrame(() => focusField('code'));
    } catch (e) {
      showFailure(e);
    } finally {
      setSending(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || sending) return;
    setError('');
    setNotice('');
    const invalid: FieldErrors = {};
    if (!validEmail(normalizedEmail)) invalid.email = '请输入有效的邮箱地址，例如 name@example.com';
    if (needCode && !/^\d{6}$/.test(code.trim())) invalid.code = '请输入 6 位邮箱验证码';
    if (needPassword && password.length < (mode === 'login' ? 1 : 8))
      invalid.password = mode === 'login' ? '请输入密码' : '密码至少需要 8 个字符';
    setFieldErrors(invalid);
    const first = (['email', 'code', 'password'] as const).find(field => invalid[field]);
    if (first) {focusField(first); return;}
    setBusy(true);
    try {
      if (mode === 'reset') {
        const result = await resetPassword(normalizedEmail, code.trim(), password);
        if (!result.ok) throw new Error('密码重设未完成，请重试');
        changeMode('login');
        setMethod('password');
        setNotice('密码已更新，请使用新密码登录');
      } else {
        const result =
          mode === 'register'
            ? await register(normalizedEmail, code.trim(), password)
            : method === 'code'
              ? await login(normalizedEmail, code.trim())
              : await loginPassword(normalizedEmail, password);
        if (!result.ok || !result.token) throw new Error('登录未完成，请重试');
        await saveToken(result.token);
        setPassword('');
        setCode('');
        await onLogin();
      }
    } catch (e) {
      showFailure(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-screen" ref={scrollContainer}>
      <aside className="auth-art">
        <div className="app-brand">
          <span className="brand-mark">
            <AudioLines />
          </span>
          <strong>面试助手</strong>
        </div>
        <div className="auth-scene" aria-hidden="true">
          <div className="auth-scene-head">
            <span className="tool-card-icon">
              <BriefcaseBusiness size={19} />
            </span>
            <div>
              <strong>下一场面试</strong>
              <small>从准备到回顾</small>
            </div>
          </div>
          <div className="auth-scene-doc">
            <FileText size={23} />
            <span>带上你的岗位与真实经历</span>
          </div>
          <div className="auth-scene-question">
            <span>问</span>
            <p>
              在这个项目里，
              <br />
              你具体负责哪一部分？
            </p>
          </div>
          <div className="auth-scene-answer">
            <span>回答思路</span>
            <p>先讲职责，再展开一个真实的决策。</p>
            <i />
            <i />
            <i />
          </div>
          <div className="auth-scene-foot">
            <CheckCheck size={14} />
            对话与回答，完整留下。
          </div>
        </div>
        <div className="auth-caption">
          <strong>准备充分，表达清楚。</strong>
          <p>每一段真实经历，都值得被好好讲述。</p>
        </div>
      </aside>
      <main className="auth-main">
        <form className="auth-form" onSubmit={submit} noValidate aria-busy={busy}>
          <h1>
            {mode === 'register' ? '创建你的账号' : mode === 'reset' ? '重新设置密码' : '欢迎回来'}
          </h1>
          <p className="auth-subtitle">
            {mode === 'register'
              ? '用邮箱开始你的第一场面试。'
              : mode === 'reset'
                ? '验证邮箱后，设置新的登录密码。'
                : '登录后继续你的面试准备。'}
          </p>
          {mode === 'login' && (
            <div className="auth-methods">
              <button
                type="button"
                className={method === 'code' ? 'active' : ''}
                aria-pressed={method === 'code'}
                disabled={busy || sending}
                onClick={() => {
                  setMethod('code');
                  setError('');
                  setFieldErrors({});
                  setShowPassword(false);
                }}>
                验证码登录
              </button>
              <button
                type="button"
                className={method === 'password' ? 'active' : ''}
                aria-pressed={method === 'password'}
                disabled={busy || sending}
                onClick={() => {
                  setMethod('password');
                  setError('');
                  setFieldErrors({});
                  setShowPassword(false);
                }}>
                密码登录
              </button>
            </div>
          )}
          <div className="field">
            <label htmlFor="auth-email">邮箱</label>
            <div className="input-with-icon">
              <Mail />
              <input
                id="auth-email"
                ref={emailInput}
                name="email"
                aria-invalid={!!fieldErrors.email}
                aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined}
                spellCheck={false}
                autoCapitalize="none"
                required
                type="email"
                autoComplete="email"
                placeholder="name@example.com"
                value={email}
                onChange={e => {
                  setEmail(e.target.value); clearField('email'); setCode(''); setNotice('');
                  setFieldErrors(old => ({...old, code: undefined}));
                }}
                onBlur={() => {
                  if (email.trim() && !validEmail(normalizedEmail))
                    setFieldErrors(old => ({...old, email: '请输入有效的邮箱地址，例如 name@example.com'}));
                }}
                disabled={busy || sending}
              />
            </div>
            <small className="field-error field-feedback" id="auth-email-error" role={fieldErrors.email ? 'alert' : undefined}>{fieldErrors.email || '\u00a0'}</small>
          </div>
          {needCode && (
            <div className="field">
              <label htmlFor="auth-code">验证码</label>
              <div className="input-with-icon">
                <KeyRound />
                <input
                  id="auth-code"
                  ref={codeInput}
                  name="code"
                  aria-invalid={!!fieldErrors.code}
                  aria-describedby={fieldErrors.code ? 'auth-code-error' : notice && needCode ? 'auth-code-notice' : undefined}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位验证码"
                  value={code}
                  onChange={e => {setCode(e.target.value.replace(/\D/g, '')); clearField('code');}}
                  disabled={busy || sending}
                />
                <button
                  type="button"
                  disabled={busy || sending || remaining > 0}
                  onClick={requestCode}>
                  {sending ? '正在发送' : remaining ? `${remaining} 秒后重发` : '获取验证码'}
                </button>
              </div>
              {fieldErrors.code && <small className="field-error" id="auth-code-error" role="alert">{fieldErrors.code}</small>}
              {notice && <small className="field-success" id="auth-code-notice" role="status">{notice}</small>}
            </div>
          )}
          {needPassword && (
            <div className="field">
              <label htmlFor="auth-password">{mode === 'reset' ? '新密码' : '密码'}</label>
              <div className="input-with-icon">
                <LockKeyhole />
                <input
                  id="auth-password"
                  ref={passwordInput}
                  name="password"
                  aria-invalid={!!fieldErrors.password}
                  aria-describedby={fieldErrors.password ? 'auth-password-error' : mode !== 'login' ? 'auth-password-hint' : undefined}
                  onKeyDown={event => setCapsLock(event.getModifierState('CapsLock'))}
                  onKeyUp={event => setCapsLock(event.getModifierState('CapsLock'))}
                  onBlur={() => setCapsLock(false)}
                  type={showPassword ? 'text' : 'password'}
                  maxLength={128}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder={mode === 'login' ? '输入密码' : '至少 8 个字符'}
                  value={password}
                  onChange={e => {setPassword(e.target.value); clearField('password');}}
                  disabled={busy || sending}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {fieldErrors.password ? <small className="field-error" id="auth-password-error" role="alert">{fieldErrors.password}</small>
                : mode !== 'login' && <small id="auth-password-hint">至少 8 个字符，建议组合字母、数字与符号。</small>}
              {capsLock && <small className="field-warning" role="status">大写锁定已开启</small>}
            </div>
          )}
          <div className="auth-extra">
            <span>{mode === 'register' ? '验证码用于验证邮箱归属' : '使用邮箱安全登录'}</span>
            {mode === 'login' && (
              <button
                type="button"
                className="link-button"
                disabled={busy || sending}
                onClick={() => changeMode('reset')}>
                忘记密码
              </button>
            )}
          </div>
          {error && <ErrorState message={error} />}{' '}
          {notice && !needCode && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          <button className="btn btn-primary auth-submit" disabled={busy || sending}>
            {busy
              ? mode === 'register' ? '正在创建账号…' : mode === 'reset' ? '正在重设密码…' : '正在登录…'
              : mode === 'register'
                ? '创建账号'
                : mode === 'reset'
                  ? '重设密码'
                  : '登录'}
            {busy ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />}
          </button>
          <p className="auth-switch">
            {mode === 'login' ? '还没有账号？' : '已有账号？'}
            <button
              type="button"
              disabled={busy || sending}
              onClick={() => changeMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? '创建账号' : '返回登录'}
            </button>
          </p>
          <p className="auth-note">
            面试资料与记录保存在你的账号中。请使用自己的邮箱，勿与他人共享验证码。
          </p>
        </form>
      </main>
    </div>
  );
}
