import {api} from './client';
export interface AIReadiness {
  configured: boolean;
  reachable: boolean | null;
  ready: boolean;
  reason_code: string;
  message: string;
  model: string;
  base_url: string;
  proxy_mode: 'direct' | 'explicit' | 'environment';
}
export const checkAIReadiness = () => api.get<AIReadiness>('/api/diagnostics/ai', true);
