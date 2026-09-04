/**
 * 认证 API —— 邮箱验证码登录 / 注册 / Token 校验 / 用户信息
 */

import {api} from './client';

export interface UserProfile {
  email: string;
  name: string;
  avatar: string;
  membership: string;
  remaining_seconds: number;
  expires_at: number;
  programming_language: string;
  interview_language: string;
  interview_count: number;
  answer_style: string;
}

export interface SendCodeResult { ok: boolean; message: string; cooldown: number; }
export interface CheckEmailResult { ok: boolean; exists: boolean; }
export interface LoginResult { ok: boolean; token: string; email: string; is_new?: boolean; expires_in: number; expires_at: number; }
export interface VerifyResult { ok: boolean; email: string; }
export interface ProfileResult { ok: boolean; user: UserProfile; }
export interface DeductResult { ok: boolean; user: UserProfile; }

export function sendCode(email: string): Promise<SendCodeResult> {
  return api.post('/api/auth/send-code', {email});
}

export function checkEmail(email: string): Promise<CheckEmailResult> {
  return api.post('/api/auth/check-email', {email});
}

export function login(email: string, code: string): Promise<LoginResult> {
  return api.post('/api/auth/login', {email, code});
}

export function loginPassword(email: string, password: string): Promise<LoginResult> {
  return api.post('/api/auth/login-password', {email, password});
}

export function register(email: string, code: string, password: string): Promise<LoginResult> {
  return api.post('/api/auth/register', {email, code, password});
}

export function verify(token: string): Promise<VerifyResult> {
  return api.post('/api/auth/verify', {token});
}

/** 获取用户信息（需认证） */
export function getProfile(): Promise<ProfileResult> {
  return api.get<ProfileResult>('/api/user/profile', true);
}

/** 扣除面试时长（需认证） */
export function deductTime(seconds: number): Promise<DeductResult> {
  return api.post<DeductResult>('/api/user/deduct-time', {seconds}, true);
}

/** 更新用户偏好 */
export function updateProfile(data: {programming_language?: string; interview_language?: string}): Promise<ProfileResult> {
  return api.put<ProfileResult>('/api/user/profile', data, true);
}
