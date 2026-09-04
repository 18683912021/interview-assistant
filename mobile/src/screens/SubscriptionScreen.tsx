/**
 * 续费 / 套餐选择页
 */

import React from 'react';
import {StyleSheet, Text, View, useColorScheme} from 'react-native';

import SecondaryPage from '../components/SecondaryPage';
import {useTheme, space, radius, type} from '../theme';

interface Plan {
  key: string;
  name: string;
  desc: string;
  price: number;
  originalPrice: number;
  discount: string;
  unit: string;
  duration: string;
  popular?: boolean;
  icon: string;
  color: string;
  perks: string[];
}

const PLANS: Plan[] = [
  {key: '1h', name: '尝鲜体验', desc: '适合快速练习', price: 60, originalPrice: 90, discount: '6.7折', unit: '¥', duration: '1 小时', icon: '⚡', color: '#6366F1', perks: ['1 小时面试时长', 'AI 实时建议', '面试历史记录', '基础赛道支持']},
  {key: '2h', name: '进阶特训', desc: '深度模拟面试', price: 100, originalPrice: 160, discount: '6.3折', unit: '¥', duration: '2 小时', icon: '🎯', color: '#8B5CF6', perks: ['2 小时面试时长', 'AI 实时建议', '面试历史记录', '全赛道支持']},
  {key: '4h', name: '高效冲刺', desc: '密集备战方案', price: 188, originalPrice: 300, discount: '6.3折', unit: '¥', duration: '4 小时', icon: '🚀', color: '#4F46E5', popular: true, perks: ['4 小时面试时长', 'AI 实时建议', '面试历史记录', '全赛道支持', '优先队列']},
  {key: 'monthly', name: '包月畅练', desc: '不限时长随心练', price: 400, originalPrice: 800, discount: '5折', unit: '¥', duration: '/ 月', icon: '💎', color: '#7C3AED', perks: ['30 天不限时长', 'AI 实时建议', '面试历史记录', '全赛道支持', '优先队列', '专属客服']},
  {key: 'quarterly', name: '季度进阶', desc: '系统化面试训练', price: 800, originalPrice: 1888, discount: '4.2折', unit: '¥', duration: '/ 季', icon: '👑', color: '#A855F7', perks: ['90 天不限时长', 'AI 实时建议', '面试历史记录', '全赛道支持', '优先队列', '专属客服', '模拟面试报告']},
  {key: 'yearly', name: '年度王者', desc: '终极面试解决方案', price: 2000, originalPrice: 7200, discount: '2.8折', unit: '¥', duration: '/ 年', icon: '🌟', color: '#D946EF', perks: ['365 天不限时长', 'AI 实时建议', '面试历史记录', '全赛道支持', '最优先队列', '1v1 专属客服', '模拟面试报告', '简历深度优化']},
];

function PlanCard({plan, dark}: {plan: Plan; dark: boolean}) {
  const t = useTheme(dark);
  return (
    <View style={[planStyles.card, {backgroundColor: t.bgSurface, borderColor: plan.popular ? plan.color : t.divider}, t.shadowMd, plan.popular && {borderWidth: 2}]}>
      {plan.popular && <View style={[planStyles.pop, {backgroundColor: plan.color}]}><Text style={planStyles.popText}>🔥 最受欢迎</Text></View>}
      <View style={planStyles.hd}>
        <View style={[planStyles.iconW, {backgroundColor: plan.color + '18'}]}><Text style={planStyles.icon}>{plan.icon}</Text></View>
        <View style={{flex: 1, gap: 2}}>
          <Text style={[planStyles.name, {color: t.textPrimary}]}>{plan.name}</Text>
          <Text style={[planStyles.desc, {color: t.textTertiary}]}>{plan.desc}</Text>
        </View>
      </View>
      <View style={planStyles.priceRow}>
        <View style={{flexDirection: 'row', alignItems: 'baseline'}}>
          <Text style={[planStyles.currency, {color: plan.color}]}>{plan.unit}</Text>
          <Text style={[planStyles.price, {color: plan.color}]}>{plan.price}</Text>
          <Text style={[planStyles.dur, {color: t.textTertiary}]}>{plan.duration}</Text>
        </View>
        <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 8}}>
          <Text style={[planStyles.orig, {color: t.textSecondary}]}>¥{plan.originalPrice}</Text>
          <Text style={[planStyles.badge, {backgroundColor: plan.color, color: '#FFFFFF'}]}>{plan.discount}</Text>
        </View>
      </View>
      <View style={[planStyles.perks, {backgroundColor: dark ? '#FFFFFF05' : plan.color + '06', borderColor: t.divider}]}>
        {plan.perks.map((p, i) => <View key={i} style={planStyles.perkRow}><Text style={planStyles.perkCheck}>✓</Text><Text style={[planStyles.perkText, {color: t.textSecondary}]}>{p}</Text></View>)}
      </View>
      <View style={[planStyles.cta, {backgroundColor: plan.color}]}><Text style={planStyles.ctaText}>立即订阅</Text></View>
    </View>
  );
}

export default function SubscriptionScreen({visible, onClose}: {visible: boolean; onClose: () => void}) {
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);
  return (
    <SecondaryPage visible={visible} onClose={onClose} title="升级会员">
      <View style={glow.glowWrap} pointerEvents="none">
        <View style={[glow.glowBlob, glow.glowTop, {backgroundColor: '#8B5CF6'}]} />
        <View style={[glow.glowBlob, glow.glowBottom, {backgroundColor: '#6366F1'}]} />
      </View>
      <View style={s.hero}>
        <Text style={[s.heroTitle, {color: t.textPrimary}]}>选择适合你的 <Text style={{color: '#8B5CF6'}}>面试方案</Text></Text>
        <Text style={[s.heroSub, {color: t.textSecondary}]}>每一次练习，都在靠近你的 dream offer</Text>
      </View>
      {PLANS.map(p => <PlanCard key={p.key} plan={p} dark={dark} />)}
      <Text style={[s.footer, {color: t.textTertiary}]}>所有套餐一经购买立即生效 · 暂不支持退款</Text>
    </SecondaryPage>
  );
}

const s = StyleSheet.create({
  hero: {paddingTop: 8, paddingBottom: 4},
  heroTitle: {fontSize: 24, fontWeight: '800', letterSpacing: 0.5, lineHeight: 34},
  heroSub: {...type.body, lineHeight: 24, marginTop: 6},
  footer: {...type.caption, textAlign: 'center'},
});

const planStyles = StyleSheet.create({
  card: {borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: 22, overflow: 'hidden'},
  pop: {position: 'absolute', top: 0, right: 0, paddingHorizontal: 14, paddingVertical: 5, borderBottomLeftRadius: radius.md},
  popText: {fontSize: 11, fontWeight: '700', color: '#FFFFFF'},
  hd: {flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16},
  iconW: {width: 48, height: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center'},
  icon: {fontSize: 24},
  name: {fontSize: 17, fontWeight: '700'},
  desc: {...type.bodySm},
  priceRow: {flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16},
  currency: {fontSize: 18, fontWeight: '700', marginRight: 2},
  price: {fontSize: 36, fontWeight: '800', letterSpacing: -1},
  dur: {...type.bodySm, marginLeft: 4},
  orig: {fontSize: 15, textDecorationLine: 'line-through' as const, fontWeight: '500'},
  badge: {paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm, fontSize: 12, fontWeight: '800', overflow: 'hidden'},
  perks: {borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8, marginBottom: 16},
  perkRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  perkCheck: {fontSize: 12, fontWeight: '700', color: '#10B981'},
  perkText: {...type.bodySm, lineHeight: 20},
  cta: {height: 50, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center'},
  ctaText: {fontSize: 16, fontWeight: '700', color: '#FFFFFF', letterSpacing: 1},
});

const glow = StyleSheet.create({
  glowWrap: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden'},
  glowBlob: {position: 'absolute', width: 280, height: 280, borderRadius: 140, opacity: 0.07},
  glowTop: {top: -80, right: -80},
  glowBottom: {bottom: -100, left: -100, width: 240, height: 240, borderRadius: 120, opacity: 0.04},
});
