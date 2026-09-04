/**
 * 面试历史 —— 列表 + 详情（Modal 内栈导航）
 */

import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import SecondaryPage from '../components/SecondaryPage';
import {useTheme, space, radius, type} from '../theme';
import {useAppAlert} from '../components/AppAlert';
import ConversationBubble from '../components/ConversationBubble';
import {getInterviewList, getInterviewDetail, clearInterviewHistory, type InterviewListItem, type InterviewDetail} from '../api/interview';

function formatDate(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}  ${h}:${m}`;
}

function formatDuration(seconds: number): string {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (min === 0) { return `${sec} 秒`; }
  return `${min} 分 ${sec} 秒`;
}

const LANG_LABELS: Record<string, string> = {
  javascript: 'JavaScript', python: 'Python', java: 'Java',
  csharp: 'C#', cpp: 'C++', go: 'Go',
};
const LANG_ICONS: Record<string, string> = {
  javascript: '🟨', python: '🐍', java: '☕',
  csharp: '🟪', cpp: '🔷', go: '🔵',
};

// ── Nav Bar ──
function NavHeader({title, onBack, onClear, dark}: {
  title: string; onBack?: () => void; onClear?: () => void; dark: boolean;
}) {
  const t = useTheme(dark);
  return (
    <View style={[navStyles.bar, {backgroundColor: t.bgSurface, borderBottomColor: t.divider}, t.shadowSm]}>
      <View style={navStyles.side}>
        {onBack && (
          <Pressable onPress={onBack} hitSlop={12} style={navStyles.backBtn}>
            <Text style={[navStyles.backText, {color: t.accent}]}>‹</Text>
          </Pressable>
        )}
      </View>
      <Text style={[navStyles.title, {color: t.textPrimary}]}>{title}</Text>
      <View style={navStyles.side}>
        {onClear && (
          <Pressable onPress={onClear} hitSlop={12} style={navStyles.clearBtn}>
            <Text style={[navStyles.clearText, {color: t.danger}]}>清空</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ── List ──
function HistoryList({onSelect, dark}: {
  onSelect: (id: string) => void; dark: boolean;
}) {
  const t = useTheme(dark);
  const [list, setList] = useState<InterviewListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getInterviewList().then(setList).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={t.accent} />
      </View>
    );
  }

  if (list.length === 0) {
    return (
      <View style={s.center}>
        <Text style={s.emptyIcon}>📋</Text>
        <Text style={[s.emptyTitle, {color: t.textPrimary}]}>暂无面试记录</Text>
        <Text style={[s.emptySub, {color: t.textTertiary}]}>完成面试后会自动保存到这里</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={list}
      renderItem={({item}) => <InterviewCard item={item} onPress={onSelect} dark={dark} />}
      keyExtractor={item => item.id}
      contentContainerStyle={listStyles.content}
      showsVerticalScrollIndicator={false}
    />
  );
}

function InterviewCard({item, onPress, dark}: {
  item: InterviewListItem; onPress: (id: string) => void; dark: boolean;
}) {
  const t = useTheme(dark);
  return (
    <Pressable
      style={[listStyles.card, {backgroundColor: t.bgSurface, borderColor: t.divider}, t.shadowSm]}
      onPress={() => onPress(item.id)}
      android_ripple={{color: t.accent + '10'}}>
      {/* Accent bar */}
      <View style={[listStyles.accentBar, {backgroundColor: t.accent}]} />
      {/* Content */}
      <View style={listStyles.cardBody}>
        <View style={listStyles.cardRow}>
          <View style={listStyles.langBadge}>
            <Text style={listStyles.langIcon}>{LANG_ICONS[item.programming_language] ?? '💬'}</Text>
            <Text style={[listStyles.langText, {color: t.accent}]}>
              {LANG_LABELS[item.programming_language] ?? item.programming_language}
            </Text>
          </View>
          <Text style={[listStyles.count, {color: t.textTertiary}]}>{item.message_count} 条对话</Text>
        </View>
        <View style={listStyles.cardRow}>
          <Text style={[listStyles.date, {color: t.textSecondary}]}>{formatDate(item.started_at)}</Text>
          <Text style={[listStyles.duration, {color: t.textTertiary}]}>⏱ {formatDuration(item.duration_seconds)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

// ── Detail ──
function HistoryDetail({id, dark}: {id: string; dark: boolean}) {
  const t = useTheme(dark);
  const [detail, setDetail] = useState<InterviewDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getInterviewDetail(id).then(setDetail).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color={t.accent} /></View>;
  }
  if (!detail) {
    return <View style={s.center}><Text style={{color: t.textTertiary}}>加载失败</Text></View>;
  }

  return (
    <FlatList
      data={detail.conversation}
      keyExtractor={item => item.id}
      ListHeaderComponent={
        <View style={[detailStyles.meta, {backgroundColor: t.bgSurface, borderColor: t.divider}, t.shadowSm]}>
          <View style={detailStyles.metaRow}>
            <Text style={[detailStyles.metaLabel, {color: t.textTertiary}]}>时间</Text>
            <Text style={[detailStyles.metaVal, {color: t.textPrimary}]}>{formatDate(detail.started_at)}</Text>
          </View>
          <View style={[detailStyles.metaDivider, {backgroundColor: t.divider}]} />
          <View style={detailStyles.metaRow}>
            <Text style={[detailStyles.metaLabel, {color: t.textTertiary}]}>时长</Text>
            <Text style={[detailStyles.metaVal, {color: t.textPrimary}]}>⏱ {formatDuration(detail.duration_seconds)}</Text>
          </View>
          <View style={[detailStyles.metaDivider, {backgroundColor: t.divider}]} />
          <View style={detailStyles.metaRow}>
            <Text style={[detailStyles.metaLabel, {color: t.textTertiary}]}>语言</Text>
            <Text style={[detailStyles.metaVal, {color: t.textPrimary}]}>
              {LANG_ICONS[detail.programming_language] ?? ''} {LANG_LABELS[detail.programming_language] ?? detail.programming_language}
            </Text>
          </View>
          <View style={[detailStyles.metaDivider, {backgroundColor: t.divider}]} />
          <View style={detailStyles.metaRow}>
            <Text style={[detailStyles.metaLabel, {color: t.textTertiary}]}>对话</Text>
            <Text style={[detailStyles.metaVal, {color: t.textPrimary}]}>{detail.conversation.length} 条</Text>
          </View>
        </View>
      }
      renderItem={({item}) => (
        <View style={detailStyles.bubbleWrap}>
          <ConversationBubble
            role={item.role}
            text={item.text}
            status="done"
            timestamp={item.timestamp}
            dark={dark}
          />
        </View>
      )}
      contentContainerStyle={detailStyles.content}
      showsVerticalScrollIndicator={false}
    />
  );
}

// ── Main ──
export default function InterviewHistoryScreen({visible, onClose}: {
  visible: boolean; onClose: () => void;
}) {
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);
  const [stack, setStack] = useState<string[]>([]);
  const selectedId = stack[0];
  const {showAlert} = useAppAlert();

  const handleClear = useCallback(() => {
    showAlert({
      title: '清空历史',
      message: '确定要清空所有面试历史吗？此操作不可恢复。',
      confirmText: '清空',
      confirmDestructive: true,
      showCancel: true,
      onConfirm: async () => {
        await clearInterviewHistory();
        setStack([]);
        onClose();
      },
    });
  }, [showAlert, onClose]);

  const clearBtn = <Pressable onPress={handleClear} hitSlop={12}><Text style={{fontSize: 14, fontWeight: '600', color: '#EF4444'}}>清空</Text></Pressable>;

  return selectedId ? (
    <SecondaryPage visible={visible} onClose={() => setStack([])} title="面试详情" noScroll>
      <HistoryDetail id={selectedId} dark={dark} />
    </SecondaryPage>
  ) : (
    <SecondaryPage visible={visible} onClose={onClose} title="面试历史" headerRight={clearBtn} noScroll>
      <HistoryList onSelect={id => setStack([id])} dark={dark} />
    </SecondaryPage>
  );
}

// ── Shared ──
const s = StyleSheet.create({
  container: {flex: 1},
  center: {flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12},
  emptyIcon: {fontSize: 48, marginBottom: 4},
  emptyTitle: {...type.heading},
  emptySub: {...type.bodySm},
});

// ── Nav ──
const navStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    height: 50, paddingHorizontal: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  side: {width: 56, alignItems: 'center'},
  title: {...type.bodyLg, fontWeight: '700', textAlign: 'center', flex: 1},
  backBtn: {paddingVertical: 4, paddingRight: 8},
  backText: {fontSize: 28, fontWeight: '300', lineHeight: 30},
  clearBtn: {paddingVertical: 4, paddingLeft: 8},
  clearText: {fontSize: 14, fontWeight: '600'},
});

// ── List ──
const listStyles = StyleSheet.create({
  content: {padding: space.lg, paddingBottom: 40, gap: 14},
  card: {
    flexDirection: 'row', borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden',
  },
  accentBar: {width: 4},
  cardBody: {flex: 1, padding: space.lg, gap: 12},
  cardRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  langBadge: {flexDirection: 'row', alignItems: 'center', gap: 6},
  langIcon: {fontSize: 16},
  langText: {fontSize: 15, fontWeight: '700'},
  count: {...type.caption},
  date: {...type.bodySm},
  duration: {...type.caption, fontWeight: '500'},
});

// ── Detail ──
const detailStyles = StyleSheet.create({
  content: {paddingBottom: 40},
  meta: {
    marginHorizontal: space.lg, marginTop: space.lg, marginBottom: space.md,
    borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  metaRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: 13,
  },
  metaLabel: {...type.bodySm},
  metaVal: {...type.bodySm, fontWeight: '600'},
  metaDivider: {height: StyleSheet.hairlineWidth, marginHorizontal: space.lg},
  bubbleWrap: {paddingHorizontal: space.lg},
});
