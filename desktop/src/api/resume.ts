/**
 * 简历 API —— 上传 / 获取自我介绍 / 检查状态
 *
 * 从 RN 项目零改动迁移。
 */
import { api } from './client';

export interface IntroResult {
  ok: boolean;
  intro: string | null;
  filename?: string;
  generated_at?: string;
}

export interface HasResult {
  ok: boolean;
  has_intro: boolean;
}

export interface UploadResult {
  ok: boolean;
  intro: string;
  generated_at: string;
  filename: string;
}

export function getIntro(): Promise<IntroResult> {
  return api.get<IntroResult>('/api/resume/intro', true);
}

export function hasResume(): Promise<HasResult> {
  return api.get<HasResult>('/api/resume/has', true);
}

export function uploadResume(formData: FormData): Promise<UploadResult> {
  return api.upload<UploadResult>('/api/resume/upload', formData);
}
