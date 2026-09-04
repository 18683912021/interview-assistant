/**
 * SecondaryPage —— 二级页面通用壳
 *
 * 提供：Modal 滑入 + 顶部导航栏（固定） + 可滚动内容区
 * 每个用到的地方不用再写 Modal/Nav/ScrollView 组合。
 *
 * 用法：
 *   <SecondaryPage visible={show} onClose={close} title="升级会员">
 *     <PlanCards />
 *   </SecondaryPage>
 *
 *   带右侧操作：
 *   <SecondaryPage visible={show} onClose={close} title="面试历史"
 *     headerRight={<Text onPress={clear}>清空</Text>}>
 *     <HistoryList />
 *   </SecondaryPage>
 */

import React from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useTheme, space, radius, type} from '../theme';

const SCREEN_H = Dimensions.get('window').height;

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
  /** 内容自己处理滚动（如 FlatList）时设为 true */
  noScroll?: boolean;
}

export default function SecondaryPage({visible, onClose, title, children, headerRight, noScroll}: Props) {
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);
  const scrollH = SCREEN_H - 50 - (StatusBar.currentHeight ?? 24);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={[styles.root, {backgroundColor: t.bg}]} edges={['top']}>
        <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />

        {/* ── Nav ── */}
        <View style={[styles.nav, {backgroundColor: t.bgSurface, borderBottomColor: t.divider}, t.shadowSm]}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.navLeft}>
            <Text style={[styles.navBack, {color: t.accent}]}>‹</Text>
          </Pressable>
          <Text style={[styles.navTitle, {color: t.textPrimary}]}>{title}</Text>
          <View style={styles.navRight}>
            {headerRight}
          </View>
        </View>

        {/* ── Body ── */}
        {noScroll ? (
          <View style={{flex: 1}}>{children}</View>
        ) : (
          <ScrollView
            style={{height: scrollH}}
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},

  // Nav
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    height: 50, paddingHorizontal: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navLeft: {width: 56, alignItems: 'flex-start', paddingVertical: 4},
  navBack: {fontSize: 28, fontWeight: '300', lineHeight: 30},
  navTitle: {...type.bodyLg, fontWeight: '700', textAlign: 'center', flex: 1},
  navRight: {width: 56, alignItems: 'flex-end'},

  // Glow
  glowWrap: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden'},
  glowBlob: {position: 'absolute', width: 280, height: 280, borderRadius: 140, opacity: 0.08},
  glowTop: {top: -80, right: -80},
  glowBottom: {bottom: -100, left: -100, width: 240, height: 240, borderRadius: 120, opacity: 0.05},

  // Body
  body: {padding: space.lg, paddingBottom: 48, gap: 16},
});
