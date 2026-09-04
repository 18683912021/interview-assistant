/**
 * Design Token —— 统一主题系统
 *
 * PC 端适配：替换 RN shadow 为 CSS box-shadow。
 * 使用 CSS 变量注入，组件用 Tailwind 类名引用 var(--color-xxx)。
 */
import { useEffect, useMemo, useState } from 'react';

// ── Raw token values by mode ──
const tokens = {
  light: {
    colors: {
      bg: '#F7F8FA',
      'bg-surface': '#FFFFFF',
      'bg-elevated': '#FFFFFF',
      'bg-header': 'rgba(255,255,255,0.85)',
      'text-primary': '#1A1D26',
      'text-secondary': '#6B7280',
      'text-tertiary': '#9CA3AF',
      'text-inverse': '#FFFFFF',
      accent: '#4F46E5',
      'accent-light': '#EEF2FF',
      'accent-soft': '#E0E7FF',
      danger: '#EF4444',
      'danger-light': '#FEF2F2',
      success: '#10B981',
      'success-light': '#ECFDF5',
      warning: '#F59E0B',
      'warning-light': '#FFFBEB',
      'bubble-interviewer': '#F3F4F6',
      'bubble-user': '#DCFCE7',
      'bubble-user-border': '#BBF7D0',
      'bubble-ai': '#F0F4FF',
      'bubble-ai-border': '#C7D2FE',
      divider: '#E5E7EB',
      'divider-strong': '#D1D5DB',
      skeleton: '#E5E7EB',
      'skeleton-shimmer': '#F3F4F6',
      backdrop: 'rgba(0,0,0,0.35)',
    },
  },
  dark: {
    colors: {
      bg: '#0F1117',
      'bg-surface': '#1A1D28',
      'bg-elevated': '#242734',
      'bg-header': 'rgba(15,17,23,0.9)',
      'text-primary': '#F1F5F9',
      'text-secondary': '#94A3B8',
      'text-tertiary': '#64748B',
      'text-inverse': '#0F1117',
      accent: '#818CF8',
      'accent-light': '#1E1B4B',
      'accent-soft': '#312E81',
      danger: '#F87171',
      'danger-light': '#451A1A',
      success: '#34D399',
      'success-light': '#064E3B',
      warning: '#FBBF24',
      'warning-light': '#451A03',
      'bubble-interviewer': '#1E293B',
      'bubble-user': '#14532D',
      'bubble-user-border': '#166534',
      'bubble-ai': '#1E1B4B',
      'bubble-ai-border': '#3730A3',
      divider: '#272A36',
      'divider-strong': '#374151',
      skeleton: '#272A36',
      'skeleton-shimmer': '#32364A',
      backdrop: 'rgba(0,0,0,0.6)',
    },
  },
};

export type Theme = typeof tokens.light;

export function useTheme(dark: boolean): Theme {
  const theme = useMemo(() => (dark ? tokens.dark : tokens.light), [dark]);

  useEffect(() => {
    const root = document.documentElement;
    Object.entries(theme.colors).forEach(([key, value]) => {
      root.style.setProperty(`--color-${key}`, value);
    });
  }, [theme]);

  return tokens.light; // 返回 light 作为 Theme 类型，实际 CSS 变量已注入
}

// ── useDarkMode ──
export function useDarkMode(): { dark: boolean; toggle: () => void } {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', dark);
    const themeTokens = dark ? tokens.dark : tokens.light;
    Object.entries(themeTokens.colors).forEach(([key, value]) => {
      root.style.setProperty(`--color-${key}`, value);
    });
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  const toggle = () => setDark(d => !d);

  return { dark, toggle };
}
