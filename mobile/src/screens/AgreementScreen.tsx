/**
 * AgreementScreen — 服务协议 & 隐私政策
 *
 * 从 AuthScreen 的协议链接唤起，以 Modal 形式展示。
 */

import React from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';

import {useTheme, space, radius, type} from '../theme';

interface Props {
  type: 'service' | 'privacy';
  onClose: () => void;
}

export default function AgreementScreen({type, onClose}: Props) {
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);

  const title = type === 'service' ? '服务协议' : '隐私政策';

  return (
    <SafeAreaView style={[styles.root, {backgroundColor: t.bg}]} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={[styles.header, {borderBottomColor: t.divider}]}>
        <View style={styles.headerPlaceholder} />
        <Text style={[styles.headerTitle, {color: t.textPrimary}]}>{title}</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.6}>
          <Text style={[styles.closeText, {color: t.accent}]}>关闭</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}>

        {type === 'service' ? <ServiceContent t={t} /> : <PrivacyContent t={t} />}

        {/* Footer */}
        <Text style={[styles.updateDate, {color: t.textTertiary}]}>
          更新日期：2026年7月24日
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Section helper ──
function Section({title, children, t}: {title: string; children: React.ReactNode; t: any}) {
  return (
    <View style={sectionStyles.wrap}>
      <Text style={[sectionStyles.title, {color: t.textPrimary}]}>{title}</Text>
      <Text style={[sectionStyles.body, {color: t.textSecondary}]}>{children}</Text>
    </View>
  );
}

function ServiceContent({t}: {t: any}) {
  return (
    <>
      <Text style={[styles.intro, {color: t.textSecondary}]}>
        欢迎使用 AI面试助手。请您在使用本服务前仔细阅读以下条款。使用本服务即表示您已阅读、理解并同意本协议全部内容。
        如您不同意任何条款，请立即停止使用。
      </Text>

      <Section t={t} title="一、服务说明">
        AI面试助手是一款基于人工智能技术的面试辅助工具，提供语音转文字、AI 回答建议、面试知识库等功能。
        本服务仅供学习、练习和参考之用，{'\n\n'}
        <Text style={{fontWeight: '700', color: t.danger}}>
          重要提示：本服务不构成任何形式的面试保证或承诺，AI 生成的回答建议仅为参考，
          用户应结合自身实际情况独立思考和作答。
        </Text>
      </Section>

      <Section t={t} title="二、免责声明">
        1. AI 回答建议由大语言模型生成，可能存在事实性错误、偏见或不完整，开发者不对其准确性、完整性、时效性作任何保证。{'\n\n'}
        2. 语音转文字功能依赖第三方 ASR 服务，受网络环境、口音、背景噪音等因素影响，识别结果可能存在错误或延迟。{'\n\n'}
        3. 用户因使用或依赖本服务产生的任何直接或间接损失（包括但不限于面试失败、信息泄露、商业机会损失等），开发者不承担任何责任。{'\n\n'}
        4. 本服务可能因系统维护、网络故障、第三方服务中断等原因暂时不可用，开发者不保证服务的持续稳定性和可用性。
      </Section>

      <Section t={t} title="三、用户义务">
        1. 用户应合法合规使用本服务，不得利用本服务进行作弊、欺诈等违法活动。{'\n\n'}
        2. 用户不得对面试过程进行全程录音或录像并传播，应遵守相关法律法规和面试单位的规定。{'\n\n'}
        3. 用户应自行判断 AI 建议的合理性，不应盲目依赖。
      </Section>

      <Section t={t} title="四、知识产权">
        1. 本应用的软件代码、界面设计、Logo 等知识产权归开发者所有。{'\n\n'}
        2. AI 生成的内容不视为开发者的作品，其知识产权归属适用相关法律法规和 AI 服务提供商的政策。
      </Section>

      <Section t={t} title="五、协议变更">
        开发者有权根据业务发展和法律法规变化对本协议进行修改。修改后的协议将在本页面发布，继续使用即视为同意修改后的条款。
      </Section>

      <Section t={t} title="六、联系方式">
        如对本协议有任何疑问，请联系开发者。
      </Section>
    </>
  );
}

function PrivacyContent({t}: {t: any}) {
  return (
    <>
      <Text style={[styles.intro, {color: t.textSecondary}]}>
        我们深知个人信息对您的重要性，并会尽力保护您的隐私安全。
        本隐私政策说明了我们如何收集、使用和保护您的信息。
      </Text>

      <Section t={t} title="一、信息收集">
        1. 账号信息：手机号码（用于注册和登录）。{'\n\n'}
        2. 使用数据：面试记录、对话历史（存储在本地设备，不上传服务器）。{'\n\n'}
        3. 语音数据：为提供语音转文字服务，音频数据会传输至第三方 ASR 服务商进行处理。
        <Text style={{fontWeight: '700'}}>音频数据不会被存储或用于其他目的。</Text>{'\n\n'}
        4. 设备信息：设备型号、操作系统版本等基础信息。
      </Section>

      <Section t={t} title="二、信息使用">
        1. 提供和改进面试辅助服务。{'\n\n'}
        2. 优化 AI 模型回答质量。{'\n\n'}
        3. 保障服务安全和防范风险。{'\n\n'}
        我们不会将您的个人信息出售给第三方。
      </Section>

      <Section t={t} title="三、数据存储">
        1. 您的对话历史和面试记录主要存储在本地设备中。{'\n\n'}
        2. 上传的简历文件仅用于生成个性化建议，不会被分享或公开。{'\n\n'}
        3. 您可以随时在设置中清除本地数据。
      </Section>

      <Section t={t} title="四、第三方服务">
        本服务集成了第三方语音识别和 AI 大模型服务。这些第三方服务提供商可能收集和处理您的语音数据和提问内容，
        其数据处理方式受各自隐私政策约束。我们建议您同时阅读相关第三方的隐私政策。
      </Section>

      <Section t={t} title="五、您的权利">
        1. 您有权查阅、更正、删除您的个人信息。{'\n\n'}
        2. 您有权撤回同意并注销账号。{'\n\n'}
        3. 如对隐私保护有任何疑问，可联系我们处理。
      </Section>
    </>
  );
}

// ── Styles ──
const styles = StyleSheet.create({
  root: {flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerPlaceholder: {width: 50},
  headerTitle: {
    ...type.heading,
    textAlign: 'center',
    flex: 1,
  },
  closeBtn: {
    width: 50,
    alignItems: 'flex-end',
  },
  closeText: {
    ...type.body,
    fontWeight: '600',
  },
  body: {flex: 1},
  bodyContent: {padding: space.lg, paddingBottom: 40},
  intro: {
    ...type.body,
    lineHeight: 24,
    marginBottom: space['2xl'],
  },
  updateDate: {
    ...type.caption,
    textAlign: 'center',
    marginTop: space['2xl'],
    marginBottom: space.lg,
  },
});

const sectionStyles = StyleSheet.create({
  wrap: {marginBottom: space.xl},
  title: {
    ...type.body,
    fontWeight: '700',
    marginBottom: space.sm,
  },
  body: {
    ...type.bodySm,
    lineHeight: 22,
  },
});
