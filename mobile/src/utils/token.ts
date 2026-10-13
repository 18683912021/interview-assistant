/**
 * Token + 用户信息持久化
 */

import {AudioCapture} from '../native';
import {
  verify as verifyApi,
  getProfile as getProfileApi,
  type UserProfile,
} from '../api/auth';

const TOKEN_KEY = 'auth_token';
const PROFILE_KEY = 'auth_profile';
const EMAIL_KEY = 'auth_email';
export async function getEmail(): Promise<string | null> {
  return _read(EMAIL_KEY);
}

async function _read(key: string): Promise<string | null> {
  try {
    return await AudioCapture.getPreference(key);
  } catch {
    return null;
  }
}
async function _write(key: string, value: string): Promise<void> {
  await AudioCapture.storePreference(key, value);
}
async function _remove(key: string): Promise<void> {
  await AudioCapture.removePreference(key);
}

export async function saveToken(token: string): Promise<void> {
  await _write(TOKEN_KEY, token);
}
export async function getToken(): Promise<string | null> {
  return _read(TOKEN_KEY);
}
export async function clearToken(): Promise<void> {
  await _remove(TOKEN_KEY);
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await _write(EMAIL_KEY, profile.email);
  await _write(PROFILE_KEY, JSON.stringify(profile));
}
export async function getProfile(): Promise<UserProfile | null> {
  try {
    const raw = await _read(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export async function clearProfile(): Promise<void> {
  await _remove(PROFILE_KEY);
}

/** 校验本地 token 有效 → 刷新 profile → 返回 email */
export async function verifyToken(): Promise<string | null> {
  try {
    const token = await getToken();
    if (!token) {
      return null;
    }
    const data = await verifyApi(token);
    await _write(EMAIL_KEY, data.email);
    // 刷新用户信息
    try {
      const p = await getProfileApi();
      if (p.user) {
        await saveProfile(p.user);
      }
    } catch {}
    return data.email;
  } catch {
    return null;
  }
}

/** 从后端拉取最新用户信息 */
export async function refreshProfile(): Promise<void> {
  try {
    const p = await getProfileApi();
    if (p.user) {
      await saveProfile(p.user);
    }
  } catch {}
}
