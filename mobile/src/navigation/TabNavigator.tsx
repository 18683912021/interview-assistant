/**
 * TabNavigator — 轻量底部 Tab 导航
 *
 * 零原生依赖，纯 JS 实现。
 * 所有 Tab 页面保持挂载（display: none），确保面试页 WebSocket 不中断。
 * 面试进行中锁 Tab，点击非面试 Tab 弹出顶部提示而不跳转。
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Animated, Platform, Pressable, StyleSheet, Text, View, useColorScheme} from 'react-native';

import InterviewScreen from '../InterviewScreen';
import ToolsScreen from '../screens/ToolsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import {useTheme, space, radius, type} from '../theme';
import {isInterviewActive, onInterviewActiveChange} from '../utils/interviewState';

interface TabDef {
  key: string;
  label: string;
  icon: string;
  screen: React.ComponentType;
}

const TABS: readonly TabDef[] = [
  {key: 'interview',  label: '面试',   icon: '🎯', screen: InterviewScreen},
  {key: 'tools', label: '工具箱', icon: '🧰', screen: ToolsScreen},
  {key: 'profile',   label: '我的',   icon: '👤', screen: ProfileScreen},
];

export default function TabNavigator(): React.JSX.Element {
  const [activeKey, setActiveKey] = useState(TABS[0]!.key);
  const [interviewLocked, setInterviewLocked] = useState(false);
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return onInterviewActiveChange(active => setInterviewLocked(active));
  }, []);

  const showToast = useCallback(() => {
    if (toastTimer.current) { clearTimeout(toastTimer.current); }
    Animated.timing(toastOpacity, {toValue: 1, duration: 200, useNativeDriver: true}).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastOpacity, {toValue: 0, duration: 400, useNativeDriver: true}).start();
    }, 2000);
  }, [toastOpacity]);

  const onTabPress = useCallback((key: string) => {
    if (key === 'interview' || !interviewLocked) {
      setActiveKey(key);
    } else if (isInterviewActive()) {
      showToast();
    }
  }, [interviewLocked, showToast]);

  return (
    <View style={styles.root}>
      {/* ── Toast ── */}
      <Animated.View
        style={[styles.toast, {backgroundColor: t.accent, opacity: toastOpacity}]}
        pointerEvents="none">
        <Text style={styles.toastText}>面试进行中，请先结束当前面试</Text>
      </Animated.View>

      {/* ── Screen Area ── */}
      {TABS.map(tab => (
        <View
          key={tab.key}
          style={tab.key === activeKey ? styles.screenVisible : styles.screenHidden}>
          {tab.key === 'profile' ? (
            <ProfileScreen isFocused={activeKey === 'profile'} />
          ) : tab.key === 'interview' ? (
            <InterviewScreen />
          ) : (
            <tab.screen />
          )}
        </View>
      ))}

      {/* ── Bottom Tab Bar ── */}
      <View style={[styles.bar, {backgroundColor: t.bgSurface, borderTopColor: t.divider}, t.shadowMd]}>
        {TABS.map(tab => {
          const active = tab.key === activeKey;
          return (
            <Pressable
              key={tab.key}
              style={styles.tab}
              onPress={() => onTabPress(tab.key)}
              android_ripple={{color: t.accent + '20', borderless: false}}>
              {active && <View style={[styles.indicator, {backgroundColor: t.accent}]} />}
              <Text style={[styles.tabIcon, active && styles.tabIconActive]}>
                {tab.icon}
              </Text>
              <Text
                style={[
                  styles.tabLabel,
                  {color: active ? t.accent : t.textTertiary},
                ]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},

  toast: {
    position: 'absolute',
    top: 8,
    left: 16,
    right: 16,
    zIndex: 100,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  toastText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  screenVisible: {flex: 1},
  screenHidden: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0, pointerEvents: 'none'},

  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: Platform.OS === 'android' ? 6 : 20,
    paddingTop: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    overflow: 'hidden',
  },
  indicator: {
    position: 'absolute',
    top: 0,
    width: 24,
    height: 3,
    borderRadius: 1.5,
  },
  tabIcon: {fontSize: 22, opacity: 0.45},
  tabIconActive: {opacity: 1},
  tabLabel: {...type.caption, fontWeight: '700', marginTop: 2},
});
