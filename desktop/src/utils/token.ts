/**
 * Token + 用户信息持久化
 *
 * PC 端适配：storage API 替换 Android SharedPreferences。
 * 通过平台适配层自动选择 IPC（Electron）或 localStorage（Web）。
 */
import { storage } from '../platform/storage';
import { verify as verifyApi, getProfile as getProfileApi, type UserProfile } from '../api/auth';

const TOKEN_KEY = 'auth_token';
const PROFILE_KEY = 'auth_profile';

export async function saveToken(token: string): Promise<void> {
  await storage.set(TOKEN_KEY, token);
}

export async function getToken(): Promise<string | null> {
  return storage.get(TOKEN_KEY);
}

export async function clearToken(): Promise<void> {
  await storage.remove(TOKEN_KEY);
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await storage.set(PROFILE_KEY, JSON.stringify(profile));
}

export async function getProfile(): Promise<UserProfile | null> {
  try {
    const raw = await storage.get(PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function clearProfile(): Promise<void> {
  await storage.remove(PROFILE_KEY);
}

export async function verifyToken(): Promise<string | null> {
  try {
    const token = await getToken();
    if (!token) { return null; }
    const data = await verifyApi(token);
    try { const p = await getProfileApi(); if (p.user) { await saveProfile(p.user); } } catch { /* ignore */ }
    return data.email;
  } catch {
    return null;
  }
}

export async function refreshProfile(): Promise<void> {
  try { const p = await getProfileApi(); if (p.user) { await saveProfile(p.user); } } catch { /* ignore */ }
}
