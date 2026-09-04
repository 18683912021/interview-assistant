import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  Dimensions,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';

import type {ConversationBubbleStatus} from '../hooks/useAudioCaptureController';
import {useTheme, space, radius, type} from '../theme';

interface Props {
  role: 'interviewer' | 'user' | 'ai';
  text: string;
  status: ConversationBubbleStatus;
  timestamp: number;
  onPress?: () => void;
  dark: boolean;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) { return '刚刚'; }
  const sec = Math.floor(diff / 1000);
  if (sec < 5) { return '刚刚'; }
  if (sec < 60) { return `${sec}秒前`; }
  const min = Math.floor(sec / 60);
  if (min < 60) { return `${min}分钟前`; }
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ── 轻量内联 Markdown 渲染（只用 Text，天然换行不溢出） ──
function RichText({text, t}: {text: string; t: ReturnType<typeof useTheme>}) {
  // 拆分为段落，再逐段解析粗体/行内代码/代码块
  const blocks = text.split(/(```[\s\S]*?```)/g);
  return (
    <Text style={{fontSize: 14, color: t.textPrimary, lineHeight: 22, flexShrink: 1}}>
      {blocks.map((block, bi) => {
        if (block.startsWith('```') && block.endsWith('```')) {
          const code = block.slice(3, -3).replace(/^\n/, '');
          return (
            <Text key={bi} style={{fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', backgroundColor: t.divider, color: t.textPrimary}}>
              {'\n' + code + '\n'}
            </Text>
          );
        }
        // 行内：**bold** 和 `code`
        const parts = block.split(/(\*\*.*?\*\*|`.*?`)/g);
        return (
          <Text key={bi}>
            {parts.map((part, pi) => {
              if (part.startsWith('**') && part.endsWith('**')) {
                return <Text key={pi} style={{fontWeight: '800'}}>{part.slice(2, -2)}</Text>;
              }
              if (part.startsWith('`') && part.endsWith('`')) {
                return <Text key={pi} style={{fontSize: 13, backgroundColor: t.divider, color: t.accent}}>{part.slice(1, -1)}</Text>;
              }
              return <Text key={pi}>{part}</Text>;
            })}
          </Text>
        );
      })}
    </Text>
  );
}

const ConversationBubble = React.memo(function ConversationBubble({
  role,
  text,
  status,
  timestamp,
  onPress,
  dark,
}: Props) {
  const t = useTheme(dark);
  const isInterviewer = role === 'interviewer';
  const isUser = role === 'user';
  const isAI = role === 'ai';
  const clickable = !isAI && onPress != null;

  const screenH = Dimensions.get('window').height;
  const innerScrollRef = useRef<ScrollView>(null);
  const [visibleLen, setVisibleLen] = useState(
    !isAI || status === 'done' || status === 'error' ? text.length : 0,
  );
  const rafRef = useRef<number | null>(null);
  const pressScale = useRef(new Animated.Value(1)).current;

  // ── Typing animation（动态速度：小积压匀速丝滑，大积压加速追赶） ──
  useEffect(() => {
    if (!isAI || status === 'done' || status === 'error') {
      setVisibleLen(text.length);
      return;
    }
    if (status === 'loading') {
      setVisibleLen(0);
      return;
    }

    let active = true;
    const BASE_SPEED = 5; // 基础速度：5 字/帧 ≈ 300 字/秒
    const MAX_SPEED = 15; // 极限速度：15 字/帧 ≈ 900 字/秒（大 chunk 追赶）

    const step = () => {
      if (!active) { return; }
      setVisibleLen(prev => {
        if (prev >= text.length) { return prev; }
        const backlog = text.length - prev;
        // 积压 ≤20：匀速 5 字/帧，视觉丝滑
        // 积压 >20：加速迎头赶上，最多 15 字/帧
        const speed = backlog <= 20 ? BASE_SPEED : Math.min(MAX_SPEED, BASE_SPEED + Math.ceil((backlog - 20) / 8));
        return Math.min(prev + speed, text.length);
      });
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      active = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [status, text.length, isAI]);

  // 组件卸载时兜底清理
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const showLoading = status === 'loading';
  const showError = status === 'error';
  const partialText = text.slice(0, visibleLen);
  const isTyping = isAI && status === 'streaming' && visibleLen < text.length;

  // ── Press animation ──
  // ── 点击气泡 → 触觉 + 视觉反馈 ──
  const handleBubblePress = () => {
    if (!clickable || !onPress) { return; }
    if (Platform.OS === 'android') { Vibration.vibrate(10); }
    onPress();
  };

  const handlePressIn = () => {
    if (!clickable) { return; }
    Animated.spring(pressScale, {toValue: 0.97, useNativeDriver: true, damping: 20, stiffness: 400}).start();
  };
  const handlePressOut = () => {
    if (!clickable) { return; }
    Animated.spring(pressScale, {toValue: 1, useNativeDriver: true, damping: 15, stiffness: 300}).start();
  };

  // ── Bubble style ──
  let bubbleBg: string;
  let bubbleBorder: string;
  let textColor: string;
  let avatar: string;

  if (isInterviewer) {
    bubbleBg = t.bubbleInterviewer;
    bubbleBorder = t.divider;
    textColor = t.textPrimary;
    avatar = '🎙️';
  } else if (isUser) {
    bubbleBg = t.bubbleUser;
    bubbleBorder = t.bubbleUserBorder;
    textColor = '#14532D';
    avatar = '👤';
  } else {
    bubbleBg = t.bubbleAI;
    bubbleBorder = t.bubbleAIBorder;
    textColor = t.textPrimary;
    avatar = '🤖';
  }

  const content = (
    <View style={[styles.rowContent, isUser && styles.rowContentRight]}>
      {/* Avatar */}
      <View style={[styles.avatar, {backgroundColor: bubbleBg, borderColor: bubbleBorder}]}>
        <Text style={styles.avatarText}>{avatar}</Text>
      </View>

      {/* Bubble body */}
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: bubbleBg,
            borderColor: isAI ? bubbleBorder : 'transparent',
            borderWidth: isAI ? 1.5 : 0,
            borderStyle: isAI ? 'dashed' : 'solid',
          },
          isInterviewer && styles.bubbleLeft,
          isUser && styles.bubbleRight,
          isAI && styles.bubbleLeft,
          showError && {borderColor: t.danger, borderStyle: 'dashed'},
          t.shadowSm,
        ]}>
        {/* Timestamp */}
        <View style={styles.labelRow}>
          <Text style={[styles.timestamp, {color: t.textTertiary}]}>
            {relativeTime(timestamp)}
          </Text>
        </View>

        {/* Content */}
        {showLoading ? (
          <LoadingDots color={t.accent} />
        ) : isAI ? (
          <ScrollView
            ref={innerScrollRef}
            style={{maxHeight: screenH / 2.5}}
            showsVerticalScrollIndicator={true}
            nestedScrollEnabled={true}
            keyboardShouldPersistTaps="handled">
            <RichText text={partialText} t={t} />
            {isTyping ? <Text style={[styles.cursor, {color: t.accent}]}>|</Text> : null}
          </ScrollView>
        ) : (
          <Text style={[styles.text, {color: textColor}]}>
            {partialText}
            {isTyping ? <Text style={[styles.cursor, {color: t.accent}]}>|</Text> : null}
          </Text>
        )}
      </View>
    </View>
  );

  const alignmentStyle = isUser ? styles.rowRight : styles.rowLeft;

  if (clickable) {
    return (
      <Animated.View style={[styles.row, alignmentStyle, {transform: [{scale: pressScale}]}]}>
        <TouchableOpacity
          onPress={handleBubblePress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          activeOpacity={0.85}
          style={styles.touchableArea}>
          {content}
        </TouchableOpacity>
      </Animated.View>
    );
  }

  return (
    <View style={[styles.row, alignmentStyle]}>
      {content}
    </View>
  );
});

export default ConversationBubble;

// ── Loading Dots ──
function LoadingDots({color}: {color: string}) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % 3), 300);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={styles.loadingRow}>
      {[0, 1, 2].map(i => (
        <AnimatedDot key={i} active={frame === i} color={color} index={i} />
      ))}
    </View>
  );
}

function AnimatedDot({active, color, index}: {active: boolean; color: string; index: number}) {
  const anim = useRef(new Animated.Value(active ? 1 : 0.4)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: active ? 1 : 0.4,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [active, anim]);

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          backgroundColor: color,
          opacity: anim,
          transform: [{scale: anim}],
        },
      ]}
    />
  );
}

// ── Styles ──
const styles = StyleSheet.create({
  row: {
    paddingHorizontal: space.md,
    marginBottom: 6,
  },
  rowLeft: {alignItems: 'flex-start'},
  rowRight: {alignItems: 'flex-end'},
  touchableArea: {maxWidth: '90%'},

  rowContent: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    maxWidth: '90%',
  },
  rowContentRight: {
    flexDirection: 'row-reverse',
  },

  // Avatar
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    marginBottom: 2,
  },
  avatarText: {fontSize: 16},

  // Bubble
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    flexShrink: 1,
  },
  bubbleLeft: {
    borderBottomLeftRadius: radius.sm,
  },
  bubbleRight: {
    borderBottomRightRadius: radius.sm,
  },

  // Label row
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
    gap: 6,
  },
  label: {
    ...type.caption,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  timestamp: {
    ...type.caption,
    marginLeft: 'auto',
  },

  // Text
  text: {
    ...type.body,
    letterSpacing: 0.2,
  },
  cursor: {
    fontWeight: '300',
  },

  // Loading
  loadingRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 2,
    gap: 5,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

});
