import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Animated,
  FlatList,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {
  ConversationMessage,
  useAudioCaptureController,
} from './hooks/useAudioCaptureController';
import ConversationBubble from './components/ConversationBubble';
import SeparatorLine from './components/SeparatorLine';
import {useAppAlert} from './components/AppAlert';
import {useTheme, space, radius, type} from './theme';
import {hasResume, getIntro} from './api/resume';
import {deductTime} from './api/auth';
import {getProfile, refreshProfile} from './utils/token';
import {setInterviewActive} from './utils/interviewState';
import {saveInterview} from './api/interview';
import {getProgLang} from './config';

// ── Display item for FlatList (bubble or separator) ──
type DisplayItem =
  | {type: 'bubble'; message: ConversationMessage}
  | {type: 'separator'; id: string};

// ── Pulsing Dot ──
function PulsingDot({color, size = 8}: {color: string; size?: number}) {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {toValue: 0.3, duration: 800, useNativeDriver: true}),
        Animated.timing(anim, {toValue: 1, duration: 800, useNativeDriver: true}),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [anim]);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: anim,
        transform: [{scale: anim}],
      }}
    />
  );
}

// ── Mic Level Bars ──
function MicLevelBar({level, dark}: {level: number; dark: boolean}) {
  const t = useTheme(dark);
  const barCount = 7;
  const activeBars = Math.max(1, Math.round(level * barCount));
  return (
    <View style={premiumStyles.levelBarRow}>
      {Array.from({length: barCount}).map((_, i) => {
        const isActive = i < activeBars;
        const h = 3 + (i + 1) * 2.5;
        return (
          <View
            key={i}
            style={{
              width: 3,
              height: h,
              borderRadius: 1.5,
              backgroundColor: isActive ? (i < 4 ? t.success : t.warning) : t.divider,
            }}
          />
        );
      })}
    </View>
  );
}

// ── Screen ──
export default function InterviewScreen(): React.JSX.Element {
  const controller = useAudioCaptureController();
  const {showAlert} = useAppAlert();
  const {state} = controller;
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);
  const flatListRef = useRef<FlatList<DisplayItem>>(null);
  const isNearBottom = useRef(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  // 自我介绍弹窗
  const [showIntro, setShowIntro] = useState(false);
  const [introText, setIntroText] = useState('');
  const [introLoading, setIntroLoading] = useState(false);
  const [showNoResume, setShowNoResume] = useState(false);

  const fetchIntro = useCallback(async () => {
    try {
      const checkData = await hasResume();
      if (!checkData.has_intro) {
        setShowNoResume(true);
        return;
      }
    } catch {
      // 网络错误不阻塞
    }

    setShowIntro(true);
    setIntroLoading(true);
    try {
      const data = await getIntro();
      setIntroText(data.ok && data.intro ? data.intro : '');
    } catch {
      setIntroText('');
    } finally {
      setIntroLoading(false);
    }
  }, []);

  const active = state.captureState === 'capturing';

  // 开始前检查剩余时长
  const handleStart = useCallback(async () => {
    const p = await getProfile();
    if (p && p.remaining_seconds < 10) {
      showAlert({
        title: '时长不足',
        message: '剩余面试时长不足 10 秒，请先续费再开始面试。',
        confirmText: '去续费',
        showCancel: true,
        cancelText: '取消',
      });
      return;
    }
    controller.start();
  }, [controller, showAlert]);

  // 面试中锁定 Tab 切换
  useEffect(() => { setInterviewActive(active); }, [active]);
  // 面试计时
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (active) {
      startTimeRef.current = Date.now() / 1000;
      timerRef.current = setInterval(() => setElapsed(e => { const v = e + 1; elapsedRef.current = v; return v; }), 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      setElapsed(0);
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); } };
  }, [active]);
  const fmtElapsed = () => { const m = Math.floor(elapsed / 60); const s = elapsed % 60; return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; };
  // 扣除面试时长 + 保存历史 + 刷新用户信息
  const deductElapsed = useCallback(async () => {
    const seconds = elapsedRef.current;
    if (seconds < 10) { return; }
    const startedAt = startTimeRef.current;
    const endedAt = Date.now() / 1000;
    const convForSave = controller.state.conversation.filter(
      m => m.text && m.text.trim() && m.status !== 'loading',
    );
    try {
      await deductTime(seconds);
      await saveInterview({
        started_at: startedAt,
        ended_at: endedAt,
        duration_seconds: seconds,
        programming_language: getProgLang().toLowerCase(),
        conversation: convForSave,
      });
      await refreshProfile();
    } catch (e) {
      console.log('[deduct] failed:', e);
    }
  }, [controller]);

  const connecting = state.streamState === 'connecting';
  const streamReady = state.streamState === 'ready';
  const conversation = state.conversation;
  const isEmpty = conversation.length === 0;
  const micLevel = state.levels?.mic ?? 0;

  // ── 浮动回底按钮动画 ──
  const fabOpacity = useRef(new Animated.Value(0)).current;
  const fabScale = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    const visible = showScrollBtn && !isEmpty;
    Animated.parallel([
      Animated.spring(fabOpacity, {toValue: visible ? 1 : 0, useNativeDriver: true, tension: 200, friction: 22}),
      Animated.spring(fabScale, {toValue: visible ? 1 : 0.6, useNativeDriver: true, tension: 200, friction: 22}),
    ]).start();
  }, [showScrollBtn, isEmpty, fabOpacity, fabScale]);

  // ── Display list（仅结构性变化时重建，纯文本更新跳过） ──
  const displayItems: DisplayItem[] = useMemo(() => {
    const items: DisplayItem[] = [];
    for (let i = 0; i < conversation.length; i++) {
      const msg = conversation[i]!;
      if (i > 0) {
        const prev = conversation[i - 1]!;
        const sameRole = prev.role === msg.role;
        const isTranscription = msg.role === 'interviewer' || msg.role === 'user';
        const isPrevTranscription = prev.role === 'interviewer' || prev.role === 'user';
        if (sameRole && isTranscription && isPrevTranscription) {
          const gap = msg.timestamp - prev.timestamp;
          if (gap > 3000) {
            items.push({type: 'separator', id: `sep-${prev.id}-${msg.id}`});
          }
        }
      }
      items.push({type: 'bubble', message: msg});
    }
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation]);

  // 滚动回底按钮逻辑
  const scrollDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollToEnd = useCallback((force = false) => {
    if (!force && !isNearBottom.current) { return; }
    flatListRef.current?.scrollToEnd({animated: false});
  }, []);

  const onContentSizeChange = useCallback(() => scrollToEnd(), [scrollToEnd]);
  const onFlatListLayout = useCallback(() => scrollToEnd(true), [scrollToEnd]);

  const onScroll = useCallback((event: {nativeEvent: {contentOffset: {y: number}; contentSize: {height: number}; layoutMeasurement: {height: number}}}) => {
    const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
    const distToBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    isNearBottom.current = distToBottom < 60;
    // 防抖 100ms，避免频繁切换
    if (scrollDebounce.current) { clearTimeout(scrollDebounce.current); }
    scrollDebounce.current = setTimeout(() => {
      setShowScrollBtn(distToBottom > 300 && contentSize.height > layoutMeasurement.height * 1.2);
    }, 100);
  }, []);

  // 用 ref 稳定回调引用，避免 renderItem 随每次转录事件重建
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  const renderItem = useCallback(
    ({item}: {item: DisplayItem}) => {
      if (item.type === 'separator') {
        return <SeparatorLine dark={dark} />;
      }
      const msg = item.message;
      return (
        <ConversationBubble
          role={msg.role}
          text={msg.text}
          status={msg.status}
          timestamp={msg.timestamp}
          onPress={
            msg.role !== 'ai'
              ? () => controllerRef.current.sendLLMQuery(msg.id)
              : undefined
          }
          dark={dark}
        />
      );
    },
    [dark],
  );

  const keyExtractor = useCallback(
    (item: DisplayItem) => (item.type === 'separator' ? item.id : item.message.id),
    [],
  );

  // ── Status ──
  const statusConfig = active
    ? {label: fmtElapsed(), color: t.success, dot: true}
    : connecting
      ? {label: '连接中', color: t.warning, dot: true}
      : {label: '就绪', color: t.accent, dot: false};

  // 面试结束时扣除时长
  const wasCapturing = useRef(false);
  useEffect(() => {
    if (state.captureState === 'capturing') { wasCapturing.current = true; }
    if (wasCapturing.current && (state.captureState === 'completed' || state.captureState === 'idle')) {
      wasCapturing.current = false;
      deductElapsed();
    }
  }, [state.captureState, deductElapsed]);

  const handleStop = () => {
    showAlert({
      title: '结束面试',
      message: '确定要结束当前面试吗？对话将被清空。',
      confirmText: '结束',
      confirmDestructive: true,
      showCancel: true,
      onConfirm: controller.stop,
    });
  };

  return (
    <SafeAreaView style={[premiumStyles.safe, {backgroundColor: t.bg}]} edges={['top', 'bottom', 'left', 'right']}>
      <StatusBar
        barStyle={dark ? 'light-content' : 'dark-content'}
        backgroundColor={t.bgHeader}
      />

      {/* ── Header ── */}
      <View style={[premiumStyles.header, {backgroundColor: t.bgHeader}]}>
        <View style={premiumStyles.headerLeft}>
          <View style={[premiumStyles.appIcon, {backgroundColor: t.accentLight}]}>
            <Text style={premiumStyles.appIconText}>🎯</Text>
          </View>
          <View>
            <Text style={[premiumStyles.headerTitle, {color: t.textPrimary}]}>AI 面试助手</Text>
            <Text style={[premiumStyles.headerSub, {color: t.textTertiary}]}>实时转写 · AI 辅助</Text>
          </View>
        </View>
        <View style={premiumStyles.headerRight}>
          <TouchableOpacity
            style={[premiumStyles.introBtn, {backgroundColor: t.accentLight}]}
            onPress={fetchIntro}
            activeOpacity={0.6}>
            <Text style={premiumStyles.introBtnIcon}>📋</Text>
          </TouchableOpacity>
          <View style={[premiumStyles.statusBadge, {backgroundColor: statusConfig.color + '18'}]}>
            {statusConfig.dot && <PulsingDot color={statusConfig.color} size={7} />}
            <View style={[premiumStyles.statusDot, !statusConfig.dot && {backgroundColor: statusConfig.color}]} />
            <Text style={[premiumStyles.statusText, {color: statusConfig.color}]}>{statusConfig.label}</Text>
          </View>
        </View>
      </View>

      {/* ── Body ── */}
      {isEmpty ? (
        <View style={premiumStyles.emptyWrap}>
          <View style={premiumStyles.emptyHero}>
            <View style={[premiumStyles.emptyIconWrap, {backgroundColor: t.accentLight, borderColor: t.accentSoft}]}>
              <Text style={premiumStyles.emptyIcon}>🎤</Text>
            </View>
            <Text style={[premiumStyles.emptyTitle, {color: t.textPrimary}]}>准备开始面试</Text>
            <Text style={[premiumStyles.emptySub, {color: t.textSecondary}]}>
              {!active ? '点击下方按钮，AI 将实时转写对话并生成建议' : !streamReady ? '正在建立安全连接…' : '点击任意对话气泡，获取 AI 专业回答'}
            </Text>
          </View>

          {!active && (
            <View style={premiumStyles.featureCards}>
              {[
                {icon: '🎙️', title: '实时转写', desc: '双轨采集 · 毫秒级上屏'},
                {icon: '🤖', title: 'AI 建议', desc: '四维度深度面试分析'},
                {icon: '🌐', title: '双语支持', desc: '中文 · English 自由切换'},
              ].map((f, i) => (
                <View
                  key={i}
                  style={[premiumStyles.featureCard, {backgroundColor: t.bgSurface, borderColor: t.divider}, t.shadowSm]}>
                  <Text style={premiumStyles.featureIcon}>{f.icon}</Text>
                  <Text style={[premiumStyles.featureTitle, {color: t.textPrimary}]}>{f.title}</Text>
                  <Text style={[premiumStyles.featureDesc, {color: t.textTertiary}]}>{f.desc}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={displayItems}
          extraData={state.currentStreamingAIId}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={premiumStyles.listContent}
          onContentSizeChange={onContentSizeChange}
          onLayout={onFlatListLayout}
          onScroll={onScroll}
          scrollEventThrottle={100}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={<View style={{height: space.lg}} />}
          keyboardShouldPersistTaps="handled"
          maxToRenderPerBatch={10}
          windowSize={10}
        />
      )}

      {/* ── 浮动回底 ── */}
      <Animated.View
        pointerEvents={showScrollBtn && !isEmpty ? 'auto' : 'none'}
        style={[
          premiumStyles.scrollFabWrap,
          {
            opacity: fabOpacity,
            transform: [{scale: fabScale}],
          },
        ]}>
        <TouchableOpacity
          style={[premiumStyles.scrollFab, {backgroundColor: t.accent, borderColor: t.textInverse + '40'}, t.shadowLg]}
          onPress={() => { scrollToEnd(true); setShowScrollBtn(false); }}
          activeOpacity={0.75}>
          <Text style={premiumStyles.scrollFabIcon}>▼</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* ── Bottom Control ── */}
      <View style={[premiumStyles.controlBar, {backgroundColor: t.bgSurface, borderTopColor: t.divider}, t.shadowMd]}>
        {/* Stream status */}
        {active && (
          <View style={premiumStyles.streamRow}>
            <View style={premiumStyles.streamLeft}>
              <PulsingDot color={streamReady ? t.success : t.warning} size={8} />
              <Text style={[premiumStyles.streamText, {color: t.textSecondary}]}>
                {streamReady ? '服务器已连接' : '正在连接…'}
              </Text>
            </View>
            <MicLevelBar level={micLevel} dark={dark} />
          </View>
        )}
        {/* Capture Button */}
        <TouchableOpacity
          style={[
            premiumStyles.captureBtn,
            {backgroundColor: active ? t.danger : t.accent},
            t.shadowMd,
          ]}
          onPress={active ? handleStop : handleStart}
          activeOpacity={0.85}>
          <Text style={premiumStyles.captureIcon}>{active ? '⏹' : '🎙'}</Text>
          <Text style={premiumStyles.captureLabel}>{active ? '结束面试' : '开始面试'}</Text>
        </TouchableOpacity>
      </View>
      {/* ── 未上传简历提示 ── */}
      <Modal visible={showNoResume} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setShowNoResume(false)}>
        <View style={[premiumStyles.alertBackdrop, {backgroundColor: t.backdrop}]}>
          <View style={[premiumStyles.alertCard, {backgroundColor: t.bgSurface}, t.shadowLg]}>
            <Text style={[premiumStyles.alertTitle, {color: t.textPrimary}]}>未上传简历</Text>
            <Text style={[premiumStyles.alertMsg, {color: t.textSecondary}]}>
              请先在「我的」页面上传 PDF 简历，AI 将为您生成面试自我介绍
            </Text>
            <TouchableOpacity
              style={[premiumStyles.alertBtn, {backgroundColor: t.accent}]}
              onPress={() => setShowNoResume(false)}
              activeOpacity={0.7}>
              <Text style={premiumStyles.alertBtnText}>知道了</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── 自我介绍弹窗 ── */}
      <Modal visible={showIntro} animationType="slide" presentationStyle="pageSheet" statusBarTranslucent transparent onRequestClose={() => setShowIntro(false)}>
        <View style={[premiumStyles.safe, {backgroundColor: t.backdrop, justifyContent: 'flex-end'}]}>
        <View style={[premiumStyles.introModalCard, {backgroundColor: t.bgSurface}]}>
          <View style={[premiumStyles.introModalHeader, {borderBottomColor: t.divider}]}>
            <View style={{width: 50}} />
            <Text style={[premiumStyles.introModalTitle, {color: t.textPrimary}]}>自我介绍</Text>
            <TouchableOpacity onPress={() => setShowIntro(false)} style={premiumStyles.introModalClose} activeOpacity={0.6}>
              <Text style={[premiumStyles.introModalCloseText, {color: t.accent}]}>关闭</Text>
            </TouchableOpacity>
          </View>
          {introLoading ? (
            <View style={premiumStyles.introLoading}>
              <Text style={[premiumStyles.introLoadingText, {color: t.textSecondary}]}>加载中…</Text>
            </View>
          ) : introText ? (
            <ScrollView style={premiumStyles.introScroll} contentContainerStyle={premiumStyles.introContent}>
              <Text style={[premiumStyles.introText, {color: t.textPrimary}]}>{introText}</Text>
            </ScrollView>
          ) : (
            <View style={premiumStyles.introEmpty}>
              <Text style={[premiumStyles.introEmptyIcon]}>📄</Text>
              <Text style={[premiumStyles.introEmptyText, {color: t.textSecondary}]}>
                尚未上传简历{'\n'}请在「我的」页面上传简历生成自我介绍
              </Text>
            </View>
          )}
        </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Premium Styles ──
const premiumStyles = StyleSheet.create({
  safe: {flex: 1},

  // ── Header ──
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: 14,
  },
  headerLeft: {flexDirection: 'row', alignItems: 'center', gap: space.md},
  appIcon: {
    width: 44, height: 44, borderRadius: radius.md,
    justifyContent: 'center', alignItems: 'center',
  },
  appIconText: {fontSize: 22},
  headerTitle: {fontSize: 17, fontWeight: '800', letterSpacing: -0.3},
  headerSub: {fontSize: 11, marginTop: 2, fontWeight: '500'},
  statusBadge: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: radius.full, gap: 6,
  },
  statusDot: {width: 8, height: 8, borderRadius: 4},
  statusText: {fontSize: 13, fontWeight: '700', letterSpacing: 0.3},

  // ── Empty State ──
  emptyWrap: {flex: 1, justifyContent: 'center', paddingHorizontal: space['2xl']},
  emptyHero: {alignItems: 'center', marginBottom: space['3xl']},
  emptyIconWrap: {
    width: 96, height: 96, borderRadius: 48,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: space.xl,
    borderWidth: 1,
  },
  emptyIcon: {fontSize: 44},
  emptyTitle: {...type.title, marginBottom: space.sm, letterSpacing: 0.5},
  emptySub: {...type.bodySm, textAlign: 'center', lineHeight: 22, maxWidth: 300},

  // ── Feature Cards ──
  featureCards: {flexDirection: 'row', gap: 10},
  featureCard: {
    flex: 1, borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: space.lg, paddingHorizontal: space.sm,
    alignItems: 'center', gap: 6,
  },
  featureIcon: {fontSize: 24},
  featureTitle: {...type.caption, fontWeight: '700', marginTop: 4},
  featureDesc: {...type.caption, textAlign: 'center', fontSize: 10, lineHeight: 14},

  // ── Conversation List ──
  listContent: {paddingTop: space.md, paddingBottom: space.xs},

  // ── Control Bar ──
  controlBar: {
    paddingHorizontal: space.lg,
    paddingTop: 14,
    paddingBottom: Platform.OS === 'android' ? 28 : 34,
  },
  streamRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 10, paddingHorizontal: 2,
  },
  streamLeft: {flexDirection: 'row', alignItems: 'center', gap: 8},
  streamText: {...type.caption, fontWeight: '600', fontSize: 12},
  levelBarRow: {flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 22},

  // ── Capture Button ──
  captureBtn: {
    borderRadius: radius.xl, paddingVertical: 18,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: space.sm,
  },
  captureIcon: {fontSize: 20},
  captureLabel: {fontSize: 17, fontWeight: '800', color: '#FFFFFF', letterSpacing: 1},

  // ── Header right ──
  headerRight: {flexDirection: 'row', alignItems: 'center', gap: 10},
  introBtn: {
    width: 38, height: 38, borderRadius: radius.md,
    justifyContent: 'center', alignItems: 'center',
  },
  introBtnIcon: {fontSize: 18},

  // ── Alert Modal ──
  alertBackdrop: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: space['2xl'],
  },
  alertCard: {
    width: '100%', borderRadius: radius.lg, padding: space.xl,
  },
  alertTitle: {...type.heading, marginBottom: space.sm},
  alertMsg: {...type.body, lineHeight: 24, marginBottom: space.xl},
  alertBtn: {
    alignSelf: 'flex-end', borderRadius: radius.sm,
    paddingHorizontal: space.xl, paddingVertical: space.sm + 2,
  },
  alertBtnText: {...type.bodySm, color: '#FFFFFF', fontWeight: '700'},

  // ── Intro Modal ──
  introModalCard: {
    flex: 0.75,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  introModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  introModalTitle: {...type.heading, textAlign: 'center', flex: 1},
  introModalClose: {width: 50, alignItems: 'flex-end'},
  introModalCloseText: {...type.body, fontWeight: '600'},
  introLoading: {flex: 1, justifyContent: 'center', alignItems: 'center'},
  introLoadingText: {...type.body, color: '#6B7280'},
  introScroll: {flex: 1},
  introContent: {padding: space.lg, paddingBottom: 40},
  introText: {...type.body, lineHeight: 26, letterSpacing: 0.2},
  introEmpty: {flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 36},
  introEmptyIcon: {fontSize: 48, marginBottom: space.lg},
  introEmptyText: {...type.body, textAlign: 'center', lineHeight: 24},

  // Scroll FAB
  scrollFabWrap: {
    position: 'absolute', bottom: 110, right: space.lg,
    zIndex: 10,
  },
  scrollFab: {
    width: 44, height: 44, borderRadius: 22,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1,
  },
  scrollFabIcon: {fontSize: 16, color: '#FFFFFF', fontWeight: '800'},
});
