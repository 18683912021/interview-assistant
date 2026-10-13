import React, {useEffect, useState} from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import {api} from '../api/client';
import {
  login,
  loginPassword,
  register,
  getProfile as fetchProfile,
} from '../api/auth';
import {saveProfile, saveToken} from '../utils/token';
import {Button, Field, Notice, Segments, Txt, ui, usePalette} from './ui';
export default function Auth({onLogin}: {onLogin: () => void}) {
  const t = usePalette();
  const [mode, setMode] = useState('code'),
    [email, setEmail] = useState(''),
    [code, setCode] = useState(''),
    [password, setPassword] = useState(''),
    [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({}),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [sending, setSending] = useState(false),
    [until, setUntil] = useState(0),
    [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setRemaining(Math.max(0, Math.ceil((until - Date.now()) / 1000))),
      500,
    );
    return () => clearInterval(timer);
  }, [until]);
  const emailValid = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrors({email: '请输入有效的邮箱地址'});
      return false;
    }
    return true;
  };
  const send = async () => {
    if (!emailValid() || sending || remaining) {
      return;
    }
    setSending(true);
    setNotice('');
    setErrors({});
    try {
      const r = await api.post<{cooldown: number}>('/api/auth/send-code', {
        email: email.trim(),
        purpose:
          mode === 'register'
            ? 'register'
            : mode === 'reset'
            ? 'reset_password'
            : 'login',
      });
      setUntil(Date.now() + (r.cooldown || 60) * 1000);
      setRemaining(r.cooldown || 60);
      setNotice('验证码已发送，请查收邮件；未收到时也检查垃圾邮件。');
    } catch (e) {
      setErrors({email: (e as Error).message});
    } finally {
      setSending(false);
    }
  };
  const submit = async () => {
    if (busy || !emailValid()) {
      return;
    }
    const next: Record<string, string> = {};
    if (mode !== 'password' && !/^\d{6}$/.test(code)) {
      next.code = '请输入 6 位验证码';
    }
    if (
      mode !== 'code' &&
      ((mode === 'password' ? password.length < 1 : password.length < 6) ||
        password.length > 128)
    ) {
      next.password = '密码需要 6–128 位';
    }
    setErrors(next);
    if (Object.keys(next).length) {
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      if (mode === 'reset') {
        await api.post('/api/auth/reset-password', {
          email: email.trim(),
          code,
          password,
        });
        setMode('password');
        setCode('');
        setPassword('');
        setNotice('密码已重置，请使用新密码登录');
        return;
      }
      const data =
        mode === 'password'
          ? await loginPassword(email.trim(), password)
          : mode === 'register'
          ? await register(email.trim(), code, password)
          : await login(email.trim(), code);
      await saveToken(data.token);
      const profile = await fetchProfile();
      await saveProfile(profile.user);
      onLogin();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <KeyboardAvoidingView
      style={ui.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          ui.page,
          {
            flexGrow: 1,
            justifyContent: 'center',
            maxWidth: 500,
            width: '100%',
            alignSelf: 'center',
            gap: 24,
          },
        ]}>
        <View style={{gap: 12}}>
          <Text style={{fontSize: 14, color: t.accent, fontWeight: '600'}}>
            AI 面试助手
          </Text>
          <Text style={[ui.title, {fontSize: 34, color: t.textPrimary}]}>
            {mode === 'register'
              ? '创建账号'
              : mode === 'reset'
              ? '重设密码'
              : '欢迎回来'}
          </Text>
          <Txt muted>让每一次准备，都更从容。</Txt>
        </View>
        {['code', 'password'].includes(mode) && (
          <Segments
            value={mode}
            onChange={v => {
              setMode(v);
              setErrors({});
              setNotice('');
            }}
            options={[
              {value: 'code', label: '验证码登录'},
              {value: 'password', label: '密码登录'},
            ]}
          />
        )}
        <Field
          label="邮箱"
          value={email}
          onChangeText={v => {
            setEmail(v);
            setErrors(e => ({...e, email: ''}));
          }}
          error={errors.email}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          placeholder="name@example.com"
        />
        {mode !== 'password' && (
          <>
            <Field
              label="验证码"
              value={code}
              onChangeText={v => {
                setCode(v.replace(/\D/g, ''));
                setErrors(e => ({...e, code: ''}));
              }}
              error={errors.code}
              keyboardType="number-pad"
              maxLength={6}
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
            />
            <Button
              tone="quiet"
              label={remaining ? `${remaining} 秒后重发` : '获取验证码'}
              busy={sending}
              disabled={remaining > 0 || busy}
              onPress={send}
            />
          </>
        )}
        {mode !== 'code' && (
          <>
            <Field
              label={mode === 'password' ? '密码' : '设置新密码'}
              value={password}
              onChangeText={v => {
                setPassword(v);
                setErrors(e => ({...e, password: ''}));
              }}
              error={errors.password}
              secureTextEntry={!show}
              autoCapitalize="none"
              autoComplete={
                mode === 'password' ? 'current-password' : 'new-password'
              }
              onSubmitEditing={submit}
            />
            <Button
              tone="quiet"
              label={show ? '隐藏密码' : '显示密码'}
              onPress={() => setShow(!show)}
            />
          </>
        )}
        <Notice text={notice} />
        <Button
          label={
            mode === 'register'
              ? '创建账号'
              : mode === 'reset'
              ? '保存新密码'
              : '登录'
          }
          busy={busy}
          disabled={sending}
          onPress={submit}
        />
        <View style={ui.row}>
          <View style={ui.fill}>
            <Button
              tone="quiet"
              label={
                mode === 'register' || mode === 'reset'
                  ? '返回登录'
                  : '创建账号'
              }
              disabled={busy}
              onPress={() => {
                setMode(
                  mode === 'register' || mode === 'reset' ? 'code' : 'register',
                );
                setErrors({});
                setNotice('');
                setPassword('');
                setCode('');
              }}
            />
          </View>
          {mode !== 'reset' && (
            <Button
              tone="quiet"
              label="忘记密码"
              disabled={busy}
              onPress={() => {
                setMode('reset');
                setErrors({});
                setNotice('');
                setPassword('');
                setCode('');
              }}
            />
          )}
        </View>
        <Txt muted small>
          使用自己的邮箱，勿与他人共享验证码。面试资料与记录保存在当前账号中。
        </Txt>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
