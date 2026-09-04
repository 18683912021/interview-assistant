/**
 * ProfileScreen — 我的
 *
 * 页面结构：
 *   Header Card   —— 头像、用户名、会员等级、剩余时长
 *   Menu Sections —— 面试历史 / 面试语言 / 答案风格 / 简历上传
 */

import React, {useCallback, useContext, useEffect, useState} from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {AudioCapture} from '../native';
import {setProgLang, type ProgLang} from '../config';
import {useTheme, space, radius, type} from '../theme';
import {useAppAlert} from '../components/AppAlert';
import {AuthContext} from '../utils/AuthContext';
import {getProfile} from '../utils/token';
import {hasResume, uploadResume} from '../api/resume';
import {ApiError} from '../api/client';
import type {UserProfile} from '../api/auth';
import {updateProfile as updateProfileApi} from '../api/auth';
import {saveProfile} from '../utils/token';
import InterviewHistoryScreen from './InterviewHistoryScreen';
import SubscriptionScreen from './SubscriptionScreen';

const PROGRAMMING_LANGUAGES = ['JavaScript', 'Java', 'Python', 'C#', 'C++', 'Go'] as const;
const LANG_MAP: Record<string, ProgLang> = {
  javascript: 'JavaScript', java: 'Java', python: 'Python',
  'c#': 'C#', csharp: 'C#', 'c++': 'C++', cpp: 'C++', go: 'Go', golang: 'Go',
};
// ── Types ──
interface MenuItem {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
}

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatExpiry(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Menu Row Component ──
function MenuRow({icon, label, value, onPress}: MenuItem) {
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);

  return (
    <TouchableOpacity
      style={[styles.menuRow, {backgroundColor: t.bgSurface, borderColor: t.divider}]}
      activeOpacity={0.6}
      onPress={onPress}>
      <View style={styles.menuLeft}>
        <View style={[styles.menuIconWrap, {backgroundColor: t.accentLight}]}>
          <Text style={styles.menuIcon}>{icon}</Text>
        </View>
        <Text style={[styles.menuLabel, {color: t.textPrimary}]}>{label}</Text>
      </View>
      <View style={styles.menuRight}>
        {value != null && (
          <Text style={[styles.menuValue, {color: t.textSecondary}]}>{value}</Text>
        )}
        <Text style={[styles.menuChevron, {color: t.textTertiary}]}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Section Header ──
function SectionTitle({title}: {title: string}) {
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);

  return (
    <Text style={[styles.sectionTitle, {color: t.textTertiary}]}>{title}</Text>
  );
}

// ── Screen ──
export default function ProfileScreen({isFocused}: {isFocused?: boolean}): React.JSX.Element {
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);
  const {showAlert} = useAppAlert();
  const {logout} = useContext(AuthContext);
  const [progLang, setProgLangLocal] = useState<ProgLang>('JavaScript');
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  // 打开选择器时同步最新语言选择
  const openLangPicker = useCallback(async () => {
    const p = await getProfile();
    if (p?.programming_language) {
      const lang = LANG_MAP[p.programming_language] || 'JavaScript';
      setProgLangLocal(lang);
      setProgLang(lang);
    }
    setShowLangPicker(true);
  }, []);

  const [showHistory, setShowHistory] = useState(false);
  const [showSubscription, setShowSubscription] = useState(false);
  const [resumeLabel, setResumeLabel] = useState('未上传');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    getProfile().then(p => {
      if (p) {
        setProfile(p);
        if (p.programming_language) {
          const lang = LANG_MAP[p.programming_language] || 'JavaScript';
          setProgLang(lang);
          setProgLangLocal(lang);
        }
      }
    });
  }, []);

  useEffect(() => {
    if (isFocused) {
      getProfile().then(p => {
        if (p) {
          setProfile(p);
          if (p.programming_language) {
            const lang = LANG_MAP[p.programming_language] || 'JavaScript';
            setProgLang(lang);
            setProgLangLocal(lang);
          }
        }
      });
    }
  }, [isFocused]);

  // 检查是否已有简历
  useEffect(() => {
    hasResume()
      .then(d => { if (d.has_intro) { setResumeLabel('已上传'); } })
      .catch(() => {});
  }, []);

  // ── 简历上传 ──
  const handleUploadResume = useCallback(async () => {
    try {
      const result = await AudioCapture.pickPDF();
      if (!result?.uri) {
        return;
      }

      setUploading(true);
      setResumeLabel('上传中…');

      const formData = new FormData();
      formData.append('file', {
        uri: result.uri,
        type: 'application/pdf',
        name: result.name ?? 'resume.pdf',
      } as any);

      await uploadResume(formData);

      setResumeLabel('已上传');
      showAlert({title: '上传成功', message: '自我介绍已生成，面试中可随时查看'});
    } catch (err) {
      setResumeLabel('上传失败');
      console.error('[Resume] 上传失败:', err instanceof ApiError ? err.detail : String(err));
    } finally {
      setUploading(false);
    }
  }, []);

  const menuSections: {title: string; items: MenuItem[]}[] = [
    {
      title: '数据',
      items: [
        {icon: '📋', label: '面试历史', value: `${profile?.interview_count ?? 0} 次`, onPress: () => setShowHistory(true)},
      ],
    },
    {
      title: '偏好',
      items: [
        {icon: '🌐', label: '面试语言', value: progLang, onPress: openLangPicker},
        {icon: '✍️', label: '答案风格', value: profile?.answer_style ?? '标准书面', onPress: () => {}},
        {icon: '📄', label: '简历上传', value: uploading ? '上传中…' : resumeLabel, onPress: handleUploadResume},
      ],
    },
    {
      title: '系统',
      items: [
        {icon: '🚪', label: '退出登录', onPress: () => {
          showAlert({
            title: '退出登录',
            message: '确定要退出当前账号吗？',
            confirmText: '退出',
            confirmDestructive: true,
            showCancel: true,
            onConfirm: logout,
          });
        }},
      ],
    },
  ];

  return (
    <SafeAreaView style={[styles.container, {backgroundColor: t.bg}]} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>

        {/* ── Header Card ── */}
        <View style={[styles.headerCard, {backgroundColor: t.bgSurface}, t.shadowMd]}>
          {/* Avatar + Name */}
          <View style={styles.headerTop}>
            <View style={[styles.avatar, {backgroundColor: t.accentLight, borderColor: t.accent}]}>
              <Text style={styles.avatarText}>{profile?.avatar ?? '👨‍💻'}</Text>
            </View>
            <View style={styles.nameBlock}>
              <Text style={[styles.userName, {color: t.textPrimary}]}>{profile?.name ?? '--'}</Text>
              <View style={[styles.membershipBadge, {backgroundColor: t.accent}]}>
                <Text style={styles.membershipText}>✨ {profile?.membership ?? '高级会员'}</Text>
              </View>
            </View>
          </View>

          {/* Divider + Time */}
          <View style={[styles.timeSection, {backgroundColor: t.accentLight, borderColor: t.accentSoft}]}>
            <View style={styles.timeLeft}>
              <Text style={[styles.timeLabel, {color: t.textSecondary}]}>剩余时长</Text>
              <Text style={[styles.timeValue, {color: t.accent}]}>
                {profile ? formatTime(profile.remaining_seconds) : '--:--:--'}
              </Text>
            </View>
            <View style={styles.timeMeta}>
              <Text style={[styles.timeMetaText, {color: t.textTertiary}]}>
                有效期至 {profile ? formatExpiry(profile.expires_at) : '----'}
              </Text>
              <TouchableOpacity activeOpacity={0.6} onPress={() => setShowSubscription(true)}>
                <Text style={[styles.renewBtn, {color: t.accent}]}>续费 ›</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ── Menu Sections ── */}
        {menuSections.map(section => (
          <View key={section.title} style={styles.section}>
            <SectionTitle title={section.title} />
            <View style={[styles.menuCard, {backgroundColor: t.bgSurface}, t.shadowSm]}>
              {section.items.map((item, idx) => (
                <React.Fragment key={item.label}>
                  <MenuRow {...item} />
                  {idx < section.items.length - 1 && (
                    <View style={[styles.menuDivider, {backgroundColor: t.divider}]} />
                  )}
                </React.Fragment>
              ))}
            </View>
          </View>
        ))}

        {/* ── Footer ── */}
        <Text style={[styles.footer, {color: t.textTertiary}]}>
          AI面试助手 v1.0.0
        </Text>
      </ScrollView>

      {/* ── 编程语言选择弹窗 ── */}
      <Modal visible={showLangPicker} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setShowLangPicker(false)}>
        <TouchableOpacity
          style={[pickerStyles.backdrop, {backgroundColor: t.backdrop}]}
          activeOpacity={1}
          onPress={() => setShowLangPicker(false)}>
          <View style={[pickerStyles.card, {backgroundColor: t.bgSurface}, t.shadowLg]}>
            <Text style={[pickerStyles.title, {color: t.textPrimary}]}>选择面试语言</Text>
            {PROGRAMMING_LANGUAGES.map(lang => (
              <TouchableOpacity
                key={lang}
                style={[
                  pickerStyles.option,
                  lang === progLang && {backgroundColor: t.accentLight, borderColor: t.accent},
                ]}
                onPress={() => {
                setProgLangLocal(lang); setProgLang(lang); setShowLangPicker(false);
                updateProfileApi({programming_language: lang.toLowerCase()}).then(d => {
                  if (d.user) { saveProfile(d.user); setProfile(d.user); }
                }).catch(() => {});
              }}
                activeOpacity={0.6}>
                <Text style={[pickerStyles.optionText, {
                  color: lang === progLang ? t.accent : t.textPrimary,
                  fontWeight: lang === progLang ? '700' : '500',
                }]}>{lang}</Text>
                {lang === progLang && (
                  <View style={[pickerStyles.checkDot, {backgroundColor: t.accent}]} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
      <InterviewHistoryScreen visible={showHistory} onClose={() => setShowHistory(false)} />
      <SubscriptionScreen visible={showSubscription} onClose={() => setShowSubscription(false)} />
    </SafeAreaView>
  );
}

// ── Styles ──
const styles = StyleSheet.create({
  container: {flex: 1},
  scrollContent: {paddingBottom: 40},

  // ── Header Card ──
  headerCard: {
    marginHorizontal: space.lg,
    marginTop: space.md,
    borderRadius: radius.xl,
    padding: space.xl,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
  },
  avatarText: {fontSize: 30},
  nameBlock: {flex: 1, gap: 4},
  userName: {
    ...type.title,
    letterSpacing: 0.3,
  },
  membershipBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  membershipText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // ── Time Section ──
  timeSection: {
    marginTop: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timeLeft: {gap: 2},
  timeLabel: {...type.caption, fontWeight: '500'},
  timeValue: {
    fontSize: 28,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1.5,
  },
  timeMeta: {
    alignItems: 'flex-end',
    gap: 6,
  },
  timeMetaText: {...type.caption},
  renewBtn: {
    ...type.caption,
    fontWeight: '700',
  },

  // ── Menu Sections ──
  section: {marginTop: space['2xl'], paddingHorizontal: space.lg},
  sectionTitle: {
    ...type.caption,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: space.sm,
    marginLeft: space.xs,
  },
  menuCard: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: 14,
  },
  menuLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuIcon: {fontSize: 17},
  menuLabel: {
    ...type.body,
    fontWeight: '500',
  },
  menuRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  menuValue: {
    ...type.bodySm,
  },
  menuChevron: {
    fontSize: 18,
    fontWeight: '300',
    marginLeft: 2,
    lineHeight: 22,
    includeFontPadding: false,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: space.lg + 36 + space.md, // align with label
    marginRight: space.lg,
  },

  // ── Footer ──
  footer: {
    ...type.caption,
    textAlign: 'center',
    marginTop: space['3xl'],
    marginBottom: space.lg,
  },
});

const pickerStyles = StyleSheet.create({
  backdrop: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: space['2xl'],
  },
  card: {
    width: '100%', borderRadius: radius.xl, paddingVertical: 22,
    paddingHorizontal: 20,
  },
  title: {...type.heading, marginBottom: 18, textAlign: 'center'},
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 15, paddingHorizontal: 14, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: 'transparent',
  },
  optionText: {...type.body, fontWeight: '500'},
  checkDot: {width: 10, height: 10, borderRadius: 5},
});
