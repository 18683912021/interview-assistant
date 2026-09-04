/**
 * 简历 API —— 上传 / 获取自我介绍 / 检查状态
 */

import {api} from './client';

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

/** 获取自我介绍 */
export function getIntro(): Promise<IntroResult> {
  return api.get<IntroResult>('/api/resume/intro', true);
}

/** 检查是否已上传简历 */
export function hasResume(): Promise<HasResult> {
  return api.get<HasResult>('/api/resume/has', true);
}

/** 上传 PDF 简历 */
export function uploadResume(formData: FormData): Promise<UploadResult> {
  return api.upload<UploadResult>('/api/resume/upload', formData);
}
