/**
 * AuthScreen — 登录 / 注册
 *
 * 布局参考主流 App：上方品牌区 → 输入区 → 按钮区 → 底部协议
 * 质感增强版：渐变光晕背景 + 卡片阴影 + 输入框精致化
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {useTheme, space, radius, type} from '../theme';
import {saveToken, refreshProfile} from '../utils/token';
import {useAppAlert} from '../components/AppAlert';
import {sendCode, checkEmail, login, loginPassword, register} from '../api/auth';
import {ApiError} from '../api/client';
import AgreementScreen from './AgreementScreen';

type AuthMode = 'login' | 'register';
type LoginMethod = 'phone' | 'email';
type LoginSubMode = 'code' | 'password';
type AgreementType = 'service' | 'privacy' | null;

export default function AuthScreen({onLogin, onRegister}: {onLogin?: () => void; onRegister?: () => void}) {
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);
  const {showAlert} = useAppAlert();
  const [mode, setMode] = useState<AuthMode>('login');
  // TODO: 短信服务接入后改为 true
  const SHOW_PHONE = false;
  const [method, setMethod] = useState<LoginMethod>(SHOW_PHONE ? 'phone' : 'email');
  const [loginSubMode, setLoginSubMode] = useState<LoginSubMode>('code');

  // phone fields
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeCountdown, setCodeCountdown] = useState(0);

  // email fields
  const [email, setEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailCodeCountdown, setEmailCodeCountdown] = useState(0);

  // password (register)
  const [password, setPassword] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [agreedTouched, setAgreedTouched] = useState(false);
  const [showAgreement, setShowAgreement] = useState<AgreementType>(null);
  const [loading, setLoading] = useState(false);

  // ── 行内校验态 ──
  const [emailTouched, setEmailTouched] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [pwdTouched, setPwdTouched] = useState(false);
  const [pwdError, setPwdError] = useState('');

  const pwdRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const isLogin = mode === 'login';
  const isPhone = method === 'phone';

  // ── 邮箱格式校验 ──
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isEmailValid = EMAIL_RE.test(email.trim());
  // 发送验证码按钮是否可用
  const canSendCode = isEmailValid && emailCodeCountdown === 0;
  // 提交按钮是否可用
  const codeTrim = emailCode.trim();
  const usePasswordLogin = isLogin && loginSubMode === 'password';
  const canSubmit = usePasswordLogin
    ? (isEmailValid && password.trim().length > 0 && agreed)
    : isLogin
      ? (isEmailValid && codeTrim.length > 0 && agreed)
      : (isEmailValid && codeTrim.length > 0 && password.trim().length >= 6 && password === confirmPwd && agreed);

  const switchMode = useCallback(() => {
    setMode(m => m === 'login' ? 'register' : 'login');
    setCode(''); setEmailCode(''); setPassword(''); setConfirmPwd('');
    setEmailTouched(false); setEmailError('');
    setPwdTouched(false); setPwdError('');
    setAgreedTouched(false);
    setLoginSubMode('code');
  }, []);

  const handleEmailChange = useCallback((val: string) => {
    setEmail(val);
    if (emailError) { setEmailError(''); }
  }, [emailError]);

  const handlePasswordChange = useCallback((val: string) => {
    setPassword(val);
    if (pwdError) { setPwdError(''); }
  }, [pwdError]);

  // ── 发送邮箱验证码 ──
  const handleSendEmailCode = useCallback(async () => {
    if (!email.trim()) {
      setEmailTouched(true);
      setEmailError('请输入邮箱地址');
      return;
    }
    if (!isEmailValid) {
      setEmailTouched(true);
      setEmailError('邮箱格式不正确');
      return;
    }
    if (emailCodeCountdown > 0) { return; }
    setEmailError('');

    // 检查帐号是否存在
    try {
      const {exists} = await checkEmail(email.trim());
      if (isLogin && !exists) {
        showAlert({title: '无法发送', message: '该邮箱未注册，请先注册'});
        return;
      }
      if (!isLogin && exists) {
        showAlert({title: '无法发送', message: '该邮箱已注册，请直接登录'});
        return;
      }
    } catch (err) {
      showAlert({title: '发送失败', message: err instanceof ApiError ? err.detail : '请稍后重试'});
      return;
    }

    try {
      await sendCode(email.trim());
      startCountdown(setEmailCodeCountdown);
    } catch (err) {
      showAlert({title: '发送失败', message: err instanceof ApiError ? err.detail : '请稍后重试'});
    }
  }, [email, emailCodeCountdown, isLogin]);

  // ── 发送手机验证码（暂不支持，占位） ──
  const handleSendPhoneCode = useCallback(async () => {
    if (!phone.trim() || phone.trim().length < 11) {
      showAlert({title: '提示', message: '请输入正确的手机号'});
      return;
    }
    showAlert({title: '提示', message: '手机验证码功能尚未接入短信服务，请使用邮箱登录'});
  }, [phone]);

  // ── 倒计时 ──
  const startCountdown = useCallback((setter: React.Dispatch<React.SetStateAction<number>>) => {
    setter(30);
    const id = setInterval(() => {
      setter((prev: number) => { if (prev <= 1) { clearInterval(id); return 0; } return prev - 1; });
    }, 1000);
  }, []);

  // ── 提交 ──
  const submit = useCallback(async () => {
    Keyboard.dismiss();

    if (!agreed) {
      setAgreedTouched(true);
      return;
    }

    if (isPhone) {
      if (!code.trim()) {
        showAlert({title: '提示', message: '请输入验证码'});
        return;
      }
      showAlert({title: '提示', message: '手机验证码功能尚未接入短信服务，请使用邮箱登录'});
      return;
    }

    // ── 邮箱登录 / 注册 —— 行内校验 → 定位到第一个错误 ──
    const emailTrimVal = email.trim();
    const codeTrimVal = emailCode.trim();

    if (!emailTrimVal || !isEmailValid) {
      setEmailTouched(true);
      setEmailError(!emailTrimVal ? '请输入邮箱地址' : '邮箱格式不正确');
      return;
    }

    if (usePasswordLogin) {
      // 密码登录：校验密码
      if (!password.trim()) {
        setPwdTouched(true);
        setPwdError('请输入密码');
        return;
      }
    } else if (isLogin) {
      // 验证码登录：校验验证码
      if (!codeTrimVal) {
        showAlert({title: '提示', message: '请输入验证码'});
        return;
      }
    } else {
      // 注册：校验验证码 + 密码
      if (!codeTrimVal) {
        showAlert({title: '提示', message: '请输入验证码'});
        return;
      }
      if (!password.trim()) {
        setPwdTouched(true);
        setPwdError('请设置密码');
        return;
      }
      if (password.trim().length < 6) {
        setPwdTouched(true);
        setPwdError('密码至少 6 位');
        return;
      }
      if (password !== confirmPwd) {
        setPwdTouched(true);
        setPwdError('两次输入的密码不一致');
        return;
      }
    }

    setLoading(true);
    try {
      let data;
      if (usePasswordLogin) {
        data = await loginPassword(emailTrimVal, password);
      } else if (isLogin) {
        data = await login(emailTrimVal, codeTrimVal);
      } else {
        data = await register(emailTrimVal, codeTrimVal, password);
      }

      if (data.token) {
        await saveToken(data.token);
        await refreshProfile();
      }

      if (isLogin) { onLogin?.(); } else { onRegister?.(); }
    } catch (err) {
      showAlert({
        title: isLogin ? '登录失败' : '注册失败',
        message: err instanceof ApiError ? err.detail : '请稍后重试',
      });
    } finally {
      setLoading(false);
    }
  }, [isLogin, isPhone, usePasswordLogin, loginSubMode, email, phone, emailCode, code, password, confirmPwd, agreed, onLogin, onRegister]);

  return (
    <SafeAreaView style={[styles.root, {backgroundColor: t.bg}]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* ── 装饰光晕 ── */}
          <View style={styles.glowWrap} pointerEvents="none">
            <View style={[styles.glowBlob, styles.glowTop, {backgroundColor: t.accent}]} />
            <View style={[styles.glowBlob, styles.glowBottom, {backgroundColor: t.accent}]} />
          </View>

          {/* ── Brand ── */}
          <View style={styles.brand}>
            <View style={[styles.brandIconWrap, {backgroundColor: t.accentLight, borderColor: t.accentSoft}]}>
              <View style={[styles.brandIconGlow, {backgroundColor: t.accent + '20'}]} />
              <Text style={styles.brandIcon}>🎯</Text>
            </View>
            <Text style={[styles.brandName, {color: t.textPrimary}]}>AI面试助手</Text>
            <Text style={[styles.brandSub, {color: t.textTertiary}]}>实时转写 · AI 辅助面试</Text>
          </View>

          {/* ── Form Card ── */}
          <View style={[styles.formCard, {backgroundColor: t.bgSurface, borderColor: t.divider}, t.shadowLg]}>

            {/* 手机 / 邮箱 切换（短信接入后恢复 SHOW_PHONE=true） */}
            {SHOW_PHONE && (
            <View style={styles.switchRow}>
              <TouchableOpacity style={isPhone ? styles.switchActive : styles.switchInactive} onPress={() => setMethod('phone')} activeOpacity={0.7}>
                <Text style={[styles.switchText, {color: isPhone ? t.accent : t.textTertiary}]}>手机</Text>
              </TouchableOpacity>
              <TouchableOpacity style={!isPhone ? styles.switchActive : styles.switchInactive} onPress={() => setMethod('email')} activeOpacity={0.7}>
                <Text style={[styles.switchText, {color: !isPhone ? t.accent : t.textTertiary}]}>邮箱</Text>
              </TouchableOpacity>
            </View>
            )}

            {/* 手机号 / 邮箱 */}
            {isPhone ? (
              <View style={[styles.inputWrap, {backgroundColor: t.bg, borderColor: t.divider}]}>
                <Text style={[styles.prefix, {color: t.textPrimary}]}>+86</Text>
                <View style={[styles.vr, {backgroundColor: t.divider}]} />
                <TextInput style={[styles.input, {color: t.textPrimary}]} placeholder="手机号" placeholderTextColor={t.textTertiary} keyboardType="phone-pad" maxLength={11} value={phone} onChangeText={setPhone} />
              </View>
            ) : (
              <>
                <View style={[styles.inputWrap, {backgroundColor: t.bg, borderColor: emailError ? t.danger : t.divider}]}>
                  <TextInput
                    style={[styles.input, {color: t.textPrimary}]}
                    placeholder="邮箱地址"
                    placeholderTextColor={t.textTertiary}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={email}
                    onChangeText={handleEmailChange}
                    onBlur={() => { setEmailTouched(true); if (!email.trim()) { setEmailError('请输入邮箱地址'); } else if (!isEmailValid) { setEmailError('邮箱格式不正确'); } }}
                  />
                </View>
                {emailTouched && emailError ? (
                  <Text style={[styles.hint, {color: t.danger}]}>{emailError}</Text>
                ) : null}
              </>
            )}

            {/* 验证码输入（非密码登录模式） */}
            {!usePasswordLogin && (
            <View style={[styles.inputWrap, {backgroundColor: t.bg, borderColor: t.divider}]}>
              <TextInput style={[styles.input, {color: t.textPrimary}]} placeholder="验证码" placeholderTextColor={t.textTertiary} keyboardType="number-pad" maxLength={6} value={isPhone ? code : emailCode} onChangeText={isPhone ? setCode : setEmailCode} />
              <TouchableOpacity
                style={[styles.codeBtn, {backgroundColor: canSendCode ? t.accentLight : t.bg}]}
                onPress={isPhone ? handleSendPhoneCode : handleSendEmailCode}
                activeOpacity={canSendCode ? 0.7 : 1}
                disabled={!canSendCode}>
                <Text style={[styles.codeBtnText, {color: canSendCode ? t.accent : t.textTertiary}]}>
                  {isPhone
                    ? (codeCountdown > 0 ? `${codeCountdown}s` : '获取验证码')
                    : (emailCodeCountdown > 0 ? `${emailCodeCountdown}s` : '获取验证码')}
                </Text>
              </TouchableOpacity>
            </View>
            )}

            {/* 密码输入 */}
            {(usePasswordLogin || !isLogin) && (
              <>
                <View style={[styles.inputWrap, {backgroundColor: t.bg, borderColor: pwdError ? t.danger : t.divider}]}>
                  <TextInput
                    ref={pwdRef}
                    style={[styles.input, {color: t.textPrimary}]}
                    placeholder={usePasswordLogin ? '输入密码' : '设置密码（至少 6 位）'}
                    placeholderTextColor={t.textTertiary}
                    secureTextEntry
                    value={password}
                    onChangeText={handlePasswordChange}
                    returnKeyType={!isLogin ? 'next' : 'done'}
                    onSubmitEditing={!isLogin ? () => confirmRef.current?.focus() : undefined}
                  />
                </View>
                {/* 注册模式：确认密码 */}
                {!isLogin && (
                  <View style={[styles.inputWrap, {backgroundColor: t.bg, borderColor: pwdError ? t.danger : t.divider}]}>
                    <TextInput
                      ref={confirmRef}
                      style={[styles.input, {color: t.textPrimary}]}
                      placeholder="确认密码"
                      placeholderTextColor={t.textTertiary}
                      secureTextEntry
                      value={confirmPwd}
                      onChangeText={newVal => { setConfirmPwd(newVal); if (pwdError) { setPwdError(''); } }}
                      returnKeyType="done"
                    />
                  </View>
                )}
                {pwdTouched && pwdError ? (
                  <Text style={[styles.hint, {color: t.danger}]}>{pwdError}</Text>
                ) : null}
              </>
            )}

            {/* 登录模式：验证码 / 密码 切换 */}
            {isLogin && (
              <View style={styles.loginMethodRow}>
                <TouchableOpacity onPress={() => setLoginSubMode('code')} activeOpacity={0.6}>
                  <Text style={[styles.loginMethodText, {color: loginSubMode === 'code' ? t.accent : t.textTertiary}]}>验证码登录</Text>
                </TouchableOpacity>
                <Text style={[styles.loginMethodSep, {color: t.dividerStrong}]}>|</Text>
                <TouchableOpacity onPress={() => setLoginSubMode('password')} activeOpacity={0.6}>
                  <Text style={[styles.loginMethodText, {color: loginSubMode === 'password' ? t.accent : t.textTertiary}]}>密码登录</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* 协议 */}
            <Pressable style={styles.agreeRow} onPress={() => { setAgreed(!agreed); setAgreedTouched(false); }}>
              <View style={[styles.cb, {borderColor: (agreedTouched && !agreed) ? t.danger : agreed ? t.accent : t.dividerStrong, backgroundColor: agreed ? t.accent : 'transparent'}]}>
                {agreed && <Text style={styles.cbMark}>✓</Text>}
              </View>
              <Text style={[styles.agreeText, {color: t.textTertiary}]}>已阅读并同意</Text>
              <Text style={[styles.agreeLink, {color: t.accent}]} onPress={() => setShowAgreement('service')}>《服务协议》</Text>
              <Text style={[styles.agreeText, {color: t.textTertiary}]}>和</Text>
              <Text style={[styles.agreeLink, {color: t.accent}]} onPress={() => setShowAgreement('privacy')}>《隐私政策》</Text>
            </Pressable>
            {agreedTouched && !agreed ? (
              <Text style={[styles.hint, {color: t.danger}]}>请先阅读并同意协议</Text>
            ) : null}

            {/* 提交 */}
            <TouchableOpacity
              style={[styles.submit, {backgroundColor: t.accent}, t.shadowLg]}
              onPress={submit}
              activeOpacity={0.85}
              disabled={loading}>
              {loading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.submitText}>{isLogin ? '登录' : '注册'}</Text>
              )}
            </TouchableOpacity>

          </View>

          {/* ── 底部切换 ── */}
          <View style={styles.footer}>
            <Text style={[styles.footerText, {color: t.textSecondary}]}>{isLogin ? '还没有账号？' : '已有账号？'}</Text>
            <TouchableOpacity onPress={switchMode} activeOpacity={0.6}>
              <Text style={[styles.footerLink, {color: t.accent}]}>{isLogin ? '去注册' : '去登录'}</Text>
            </TouchableOpacity>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* 协议弹窗 */}
      <Modal visible={showAgreement != null} animationType="slide" presentationStyle="pageSheet">
        {showAgreement != null && <AgreementScreen type={showAgreement} onClose={() => setShowAgreement(null)} />}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  flex: {flex: 1},
  scroll: {flexGrow: 1, justifyContent: 'flex-start', paddingTop: '18%', paddingHorizontal: 28, paddingBottom: 40},

  // ── Decorative glow blobs ──
  glowWrap: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    overflow: 'hidden',
  },
  glowBlob: {
    position: 'absolute',
    width: 280, height: 280, borderRadius: 140,
    opacity: 0.08,
  },
  glowTop: {top: -80, right: -80},
  glowBottom: {bottom: -100, left: -100, width: 240, height: 240, borderRadius: 120, opacity: 0.05},

  // ── Brand ──
  brand: {alignItems: 'center', marginBottom: 32},
  brandIconWrap: {
    width: 88, height: 88, borderRadius: 44,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1,
    marginBottom: 16,
    overflow: 'hidden',
  },
  brandIconGlow: {
    position: 'absolute',
    width: 60, height: 60, borderRadius: 30,
    top: 14,
  },
  brandIcon: {fontSize: 40},
  brandName: {fontSize: 24, fontWeight: '800', letterSpacing: 1.5, marginBottom: 6},
  brandSub: {fontSize: 13, letterSpacing: 1, lineHeight: 18},

  // ── Form Card ──
  formCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.xl,
    padding: 22,
    gap: 14,
  },

  // ── Login method toggle ──
  loginMethodRow: {
    flexDirection: 'row', justifyContent: 'flex-end',
    alignItems: 'center', gap: 8,
  },
  loginMethodText: {fontSize: 12, fontWeight: '600'},
  loginMethodSep: {fontSize: 11},

  // ── Switch ──
  switchRow: {flexDirection: 'row', marginBottom: 1},
  switchActive: {marginRight: 24},
  switchInactive: {marginRight: 24},
  switchText: {fontSize: 17, fontWeight: '700'},

  // ── Input ──
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    height: 50,
  },
  prefix: {fontSize: 16, fontWeight: '700', paddingHorizontal: 16},
  vr: {width: StyleSheet.hairlineWidth, height: 24},
  input: {flex: 1, fontSize: 16, paddingHorizontal: 14},

  // ── Inline hint ──
  hint: {
    fontSize: 12, lineHeight: 16,
    marginTop: -8, marginLeft: 4,
  },

  // ── Code button ──
  codeBtn: {
    paddingHorizontal: 14, height: 34, borderRadius: radius.sm,
    justifyContent: 'center', alignItems: 'center',
    marginRight: 8,
  },
  codeBtnText: {fontSize: 13, fontWeight: '700'},

  // ── Agreement ──
  agreeRow: {flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingVertical: 4, gap: 2},
  cb: {width: 17, height: 17, borderRadius: 4, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center', marginRight: 4},
  cbMark: {fontSize: 11, color: '#FFF', fontWeight: '800'},
  agreeText: {fontSize: 12, lineHeight: 18},
  agreeLink: {fontSize: 12, fontWeight: '700', lineHeight: 18},

  // ── Submit ──
  submit: {
    height: 52, borderRadius: radius.lg,
    justifyContent: 'center', alignItems: 'center',
    marginTop: 4,
  },
  submitText: {fontSize: 17, fontWeight: '800', color: '#FFFFFF', letterSpacing: 3},

  // ── Footer ──
  footer: {flexDirection: 'row', justifyContent: 'center', marginTop: 28, gap: 4},
  footerText: {fontSize: 14},
  footerLink: {fontSize: 14, fontWeight: '700'},
});
