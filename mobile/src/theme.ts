/**
 * Design Token —— 统一主题系统
 *
 * 使用方式：在组件中 const t = useTheme(dark)
 * 即可获取当前模式下的完整 Token。
 */

import {useMemo} from 'react';

// ── Raw token values by mode ──
const tokens = {
  light: {
    // Background
    bg: '#F7F8FA',
    bgSurface: '#FFFFFF',
    bgElevated: '#FFFFFF',
    bgHeader: 'rgba(255,255,255,0.85)',

    // Text
    textPrimary: '#1A1D26',
    textSecondary: '#6B7280',
    textTertiary: '#9CA3AF',
    textInverse: '#FFFFFF',

    // Accent
    accent: '#4F46E5',
    accentLight: '#EEF2FF',
    accentSoft: '#E0E7FF',
    danger: '#EF4444',
    dangerLight: '#FEF2F2',
    success: '#10B981',
    successLight: '#ECFDF5',
    warning: '#F59E0B',
    warningLight: '#FFFBEB',

    // Bubble
    bubbleInterviewer: '#F3F4F6',
    bubbleUser: '#DCFCE7',
    bubbleUserBorder: '#BBF7D0',
    bubbleAI: '#F0F4FF',
    bubbleAIBorder: '#C7D2FE',

    // Divider
    divider: '#E5E7EB',
    dividerStrong: '#D1D5DB',

    // Shadows (iOS + Android elevation)
    shadowSm: {
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    shadowMd: {
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 3,
    },
    shadowLg: {
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 4},
      shadowOpacity: 0.12,
      shadowRadius: 16,
      elevation: 6,
    },

    // Misc
    backdrop: 'rgba(0,0,0,0.35)',
    skeleton: '#E5E7EB',
    skeletonShimmer: '#F3F4F6',
  },

  dark: {
    bg: '#0F1117',
    bgSurface: '#1A1D28',
    bgElevated: '#242734',
    bgHeader: 'rgba(15,17,23,0.9)',

    textPrimary: '#F1F5F9',
    textSecondary: '#94A3B8',
    textTertiary: '#64748B',
    textInverse: '#0F1117',

    accent: '#818CF8',
    accentLight: '#1E1B4B',
    accentSoft: '#312E81',
    danger: '#F87171',
    dangerLight: '#451A1A',
    success: '#34D399',
    successLight: '#064E3B',
    warning: '#FBBF24',
    warningLight: '#451A03',

    bubbleInterviewer: '#1E293B',
    bubbleUser: '#14532D',
    bubbleUserBorder: '#166534',
    bubbleAI: '#1E1B4B',
    bubbleAIBorder: '#3730A3',

    divider: '#272A36',
    dividerStrong: '#374151',

    shadowSm: {
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 1},
      shadowOpacity: 0.2,
      shadowRadius: 2,
      elevation: 1,
    },
    shadowMd: {
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 3,
    },
    shadowLg: {
      shadowColor: '#000',
      shadowOffset: {width: 0, height: 4},
      shadowOpacity: 0.4,
      shadowRadius: 16,
      elevation: 6,
    },

    backdrop: 'rgba(0,0,0,0.6)',
    skeleton: '#272A36',
    skeletonShimmer: '#32364A',
  },
};

export type Theme = typeof tokens.light;

export function useTheme(dark: boolean): Theme {
  return useMemo(() => (dark ? tokens.dark : tokens.light), [dark]);
}

// ── Spacing scale (pt) ──
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
} as const;

// ── Typography scale ──
export const type = {
  caption: {fontSize: 11, lineHeight: 16} as const,
  bodySm: {fontSize: 13, lineHeight: 18} as const,
  body: {fontSize: 15, lineHeight: 22} as const,
  bodyLg: {fontSize: 17, lineHeight: 24} as const,
  heading: {fontSize: 18, lineHeight: 26, fontWeight: '700' as const},
  title: {fontSize: 22, lineHeight: 30, fontWeight: '700' as const},
} as const;

// ── Border radius scale ──
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;
