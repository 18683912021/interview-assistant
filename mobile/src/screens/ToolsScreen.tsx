/**
 * ToolsScreen — 工具箱
 */

import React, {useCallback, useState} from 'react';
import {ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useTheme, space, radius, type} from '../theme';
import {useAppAlert} from '../components/AppAlert';
import SecondaryPage from '../components/SecondaryPage';
import {API_BASE} from '../config';
import {getProgLang} from '../config';
import {AudioCapture} from '../native';
import {getToken} from '../utils/token';

const QUESTIONS: Record<string, string[]> = {
  JavaScript: ['闭包的原理和实际应用场景', '原型链是什么', '事件循环机制：宏任务与微任务', 'Promise.all 和 Promise.race 的实现', '防抖和节流的区别及手写实现', '深拷贝的实现思路', '跨域方案详解', 'React Hooks 底层实现原理', 'Vue 3 响应式系统', 'Webpack loader 和 plugin 的区别'],
  Java: ['HashMap 底层实现', 'JVM 内存模型和垃圾回收', 'Spring AOP 和 IOC 原理', 'MySQL B+树索引优化', 'Redis 缓存穿透/击穿/雪崩', '线程池核心参数', '分布式锁实现', '消息队列可靠性', '微服务注册与发现', '分库分表方案'],
  Python: ['GIL 及多线程影响', '装饰器原理及场景', 'Django 中间件流程', 'Python 内存管理', 'asyncio 工作原理', 'Pandas 性能优化', 'Django ORM N+1', 'Flask vs FastAPI', '*args **kwargs', 'GC 分代回收'],
  'C#': ['DI 生命周期', 'EF Core 性能优化', 'async/await 实现', 'LINQ 延迟执行'],
  'C++': ['虚函数表原理', '智能指针实现', 'RAII 资源管理', 'move 语义'],
  Go: ['GMP 调度模型', 'channel 底层', 'GC 优化', 'interface 结构'],
};

// ── 工具详情页（Word↔PDF） ──
function ConvertDetail({visible, onClose, title, tool, acceptType, accent}: {
  visible: boolean; onClose: () => void; title: string;
  tool: 'word2pdf' | 'pdf2word'; acceptType: string; accent: string;
}) {
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);
  const {showAlert} = useAppAlert();
  const [phase, setPhase] = useState<'idle' | 'converting' | 'done'>('idle');
  const [download, setDownload] = useState<{blob: Blob; name: string} | null>(null);
  const [saveName, setSaveName] = useState('');
  const [useLLM, setUseLLM] = useState(false);
  const allowed = acceptType === 'pdf' ? ['pdf'] : ['docx'];

  const start = useCallback(async () => {
    if (phase !== 'idle') { return; }
    try {
      const result = await AudioCapture.pickDocument(
        acceptType === 'pdf'
          ? ['application/pdf']
          : ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      );
      if (!result?.uri) { return; }
      const ext = (result.name ?? '').toLowerCase();
      if (!allowed.some(a => ext.endsWith(a))) {
        showAlert({title: '格式错误', message: `仅支持 .${allowed.join(' / .')} 文件`});
        return;
      }

      setPhase('converting');
      const base64Data = await AudioCapture.readFileBase64(result.uri);
      if (!base64Data) { throw new Error('读取文件失败'); }

      const token = await getToken();
      const endpoint = tool === 'word2pdf' ? 'word-to-pdf' : (useLLM ? 'pdf-to-word-llm' : 'pdf-to-word');
      const res = await fetch(`${API_BASE}/api/tools/${endpoint}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
        body: JSON.stringify({filename: result.name, data: base64Data}),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || '转换失败');
      }

      const blob = await res.blob();
      const outName = result.name.replace(/\.[^.]+$/, '') + (tool === 'word2pdf' ? '.pdf' : '.docx');
      setDownload({blob, name: outName});
      setSaveName(outName);
      setPhase('done');
    } catch (err: any) {
      setPhase('idle');
      showAlert({title: '转换失败', message: err.message || '请检查文件格式'});
    }
  }, [phase, allowed, tool, showAlert]);

  const handleDownload = useCallback(async () => {
    if (!download || !saveName.trim()) { return; }
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]!);
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(download.blob);
      });
      console.log('[Tools] saving:', saveName.trim(), b64.length);
      const path = await AudioCapture.saveFile(saveName.trim(), b64);
      console.log('[Tools] saved to:', path);
      showAlert({title: '保存成功', message: '文件已保存到 Downloads 目录'});
    } catch (err: any) {
      console.error('[Tools] save failed:', err.message || err);
      showAlert({title: '保存失败', message: err.message || '请重试'});
    }
  }, [download, saveName, showAlert]);

  if (phase === 'idle') {
    return (
      <SecondaryPage visible={visible} onClose={onClose} title={title}>
        <View style={dt.idle}>
          <View style={[dt.iconW, {backgroundColor: accent + '15'}]}><Text style={dt.icon}>📄</Text></View>
          <Text style={[dt.idleTitle, {color: t.textPrimary}]}>{title}</Text>
          <Text style={[dt.idleDesc, {color: t.textSecondary}]}>点击下方按钮选择文件，自动开始转换</Text>
          {tool === 'pdf2word' && (
            <Pressable
              style={[dt.llmToggle, {backgroundColor: useLLM ? '#10B981' : t.bg, borderColor: useLLM ? '#10B981' : t.divider}]}
              onPress={() => setUseLLM(!useLLM)}>
              <Text style={[dt.llmToggleText, {color: useLLM ? '#FFFFFF' : t.textSecondary}]}>
                {useLLM ? 'AI 增强' : '普通模式'}
              </Text>
            </Pressable>
          )}
          <Pressable style={[dt.pickBtn, {backgroundColor: accent}, t.shadowMd]} onPress={start}>
            <Text style={dt.pickBtnText}>选择文件</Text>
          </Pressable>
        </View>
      </SecondaryPage>
    );
  }

  if (phase === 'converting') {
    return (
      <SecondaryPage visible={visible} onClose={onClose} title={title}>
        <View style={dt.idle}>
          <ActivityIndicator size="large" color={accent} />
          <Text style={[dt.idleTitle, {color: t.textPrimary, marginTop: 16}]}>转换中…</Text>
          <Text style={[dt.idleDesc, {color: t.textSecondary}]}>请稍候，这可能需要几秒钟</Text>
        </View>
      </SecondaryPage>
    );
  }

  return (
    <SecondaryPage visible={visible} onClose={onClose} title={title}>
      <View style={dt.idle}>
        <View style={[dt.iconW, {backgroundColor: '#10B981' + '15'}]}><Text style={dt.icon}>✅</Text></View>
        <Text style={[dt.idleTitle, {color: t.textPrimary}]}>转换完成</Text>
        <View style={[dt.inputW, {backgroundColor: t.bg, borderColor: t.divider}]}>
          <TextInput
            style={[dt.input, {color: t.textPrimary}]}
            value={saveName}
            onChangeText={setSaveName}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <Pressable style={[dt.pickBtn, {backgroundColor: accent}, t.shadowMd]} onPress={handleDownload}>
          <Text style={dt.pickBtnText}>保存到本地</Text>
        </Pressable>
        <Pressable style={dt.redo} onPress={() => { setPhase('idle'); setDownload(null); setSaveName(''); }}>
          <Text style={[dt.redoText, {color: t.textSecondary}]}>重新上传</Text>
        </Pressable>
      </View>
    </SecondaryPage>
  );
}

const dt = StyleSheet.create({
  idle: {flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 36, gap: 14},
  iconW: {width: 72, height: 72, borderRadius: 20, justifyContent: 'center', alignItems: 'center'},
  icon: {fontSize: 32},
  idleTitle: {fontSize: 18, fontWeight: '700'},
  idleDesc: {fontSize: 14, textAlign: 'center', lineHeight: 22},
  pickBtn: {paddingHorizontal: 36, paddingVertical: 14, borderRadius: radius.lg, marginTop: 8},
  pickBtnText: {fontSize: 16, fontWeight: '700', color: '#FFFFFF'},
  inputW: {borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: 14, height: 44, width: '80%', justifyContent: 'center'},
  input: {fontSize: 15, textAlign: 'center'},
  redo: {paddingVertical: 8},
  redoText: {fontSize: 14},
  llmToggle: {paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, marginTop: 8},
  llmToggleText: {fontSize: 13, fontWeight: '600'},
});

// ── Main ──
export default function ToolsScreen(): React.JSX.Element {
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);
  const [tool, setTool] = useState<string | null>(null);
  const [qIdx, setQIdx] = useState(-1);
  const lang = getProgLang();
  const pool = (QUESTIONS[lang] ?? QUESTIONS['JavaScript'])!;

  const rollQuestion = useCallback(() => {
    let next = Math.floor(Math.random() * pool.length);
    if (pool.length > 1 && next === qIdx) { next = (next + 1) % pool.length; }
    setQIdx(next);
  }, [pool, qIdx]);

  return (
    <SafeAreaView style={[s.container, {backgroundColor: t.bg}]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.hero}>
          <Text style={[s.heroTitle, {color: t.textPrimary}]}>工具箱</Text>
          <Text style={[s.heroSub, {color: t.textSecondary}]}>面试备战，轻松高效</Text>
        </View>

        <Pressable style={[s.card, {backgroundColor: t.bgSurface, borderColor: t.divider}, t.shadowSm]} onPress={rollQuestion} android_ripple={{color: t.accent + '10'}}>
          <View style={[s.accentBar, {backgroundColor: '#10B981'}]} />
          <View style={s.cardBody}>
            <View style={[s.iconW, {backgroundColor: '#10B981' + '15'}]}><Text style={s.icon}>🎲</Text></View>
            <View style={{flex: 1}}>
              <Text style={[s.cardTitle, {color: t.textPrimary}]}>随机出题 · {lang}</Text>
              <Text style={[s.cardDesc, {color: t.textTertiary}]}>{qIdx >= 0 ? pool[qIdx] : '点击抽一道面试题练手'}</Text>
            </View>
            <Text style={[s.arrow, {color: t.textTertiary}]}>🎯</Text>
          </View>
        </Pressable>

        <Pressable style={[s.card, {backgroundColor: t.bgSurface, borderColor: t.divider}, t.shadowSm]} onPress={() => setTool('word2pdf')} android_ripple={{color: t.accent + '10'}}>
          <View style={[s.accentBar, {backgroundColor: '#6366F1'}]} />
          <View style={s.cardBody}>
            <View style={[s.iconW, {backgroundColor: '#6366F1' + '15'}]}><Text style={s.icon}>📄</Text></View>
            <View style={{flex: 1}}><Text style={[s.cardTitle, {color: t.textPrimary}]}>Word → PDF</Text><Text style={[s.cardDesc, {color: t.textTertiary}]}>支持 .docx 格式</Text></View>
            <Text style={[s.arrow, {color: t.textTertiary}]}>›</Text>
          </View>
        </Pressable>

        <Pressable style={[s.card, {backgroundColor: t.bgSurface, borderColor: t.divider}, t.shadowSm]} onPress={() => setTool('pdf2word')} android_ripple={{color: t.accent + '10'}}>
          <View style={[s.accentBar, {backgroundColor: '#8B5CF6'}]} />
          <View style={s.cardBody}>
            <View style={[s.iconW, {backgroundColor: '#8B5CF6' + '15'}]}><Text style={s.icon}>📝</Text></View>
            <View style={{flex: 1}}><Text style={[s.cardTitle, {color: t.textPrimary}]}>PDF → Word</Text><Text style={[s.cardDesc, {color: t.textTertiary}]}>将 .pdf 文件转换为 .docx</Text></View>
            <Text style={[s.arrow, {color: t.textTertiary}]}>›</Text>
          </View>
        </Pressable>

        <View style={[s.divider, {backgroundColor: t.divider}]} />
        <View style={s.sectionLabel}><Text style={[s.sectionText, {color: t.textTertiary}]}>简历工具</Text></View>

        <Pressable style={[s.card, {backgroundColor: t.bgSurface, borderColor: t.divider}, t.shadowSm]} android_ripple={{color: t.accent + '10'}}>
          <View style={[s.accentBar, {backgroundColor: '#F59E0B'}]} />
          <View style={s.cardBody}>
            <View style={[s.iconW, {backgroundColor: '#F59E0B' + '15'}]}><Text style={s.icon}>📐</Text></View>
            <View style={{flex: 1}}><Text style={[s.cardTitle, {color: t.textPrimary}]}>简历格式优化</Text><Text style={[s.cardDesc, {color: t.textTertiary}]}>自动调整字体、间距、页边距</Text></View>
            <Text style={[s.arrow, {color: t.textTertiary}]}>›</Text>
          </View>
        </Pressable>
        <Pressable style={[s.card, {backgroundColor: t.bgSurface, borderColor: t.divider}, t.shadowSm]} android_ripple={{color: t.accent + '10'}}>
          <View style={[s.accentBar, {backgroundColor: '#EC4899'}]} />
          <View style={s.cardBody}>
            <View style={[s.iconW, {backgroundColor: '#EC4899' + '15'}]}><Text style={s.icon}>🎨</Text></View>
            <View style={{flex: 1}}><Text style={[s.cardTitle, {color: t.textPrimary}]}>简历样式优化</Text><Text style={[s.cardDesc, {color: t.textTertiary}]}>智能配色、版式美化、模板推荐</Text></View>
            <Text style={[s.arrow, {color: t.textTertiary}]}>›</Text>
          </View>
        </Pressable>
        <Pressable style={[s.card, {backgroundColor: t.bgSurface, borderColor: t.divider}, t.shadowSm]} android_ripple={{color: t.accent + '10'}}>
          <View style={[s.accentBar, {backgroundColor: '#8B5CF6'}]} />
          <View style={s.cardBody}>
            <View style={[s.iconW, {backgroundColor: '#8B5CF6' + '15'}]}><Text style={s.icon}>✍️</Text></View>
            <View style={{flex: 1}}><Text style={[s.cardTitle, {color: t.textPrimary}]}>简历内容优化</Text><Text style={[s.cardDesc, {color: t.textTertiary}]}>AI 润色项目描述、提炼技术亮点</Text></View>
            <Text style={[s.arrow, {color: t.textTertiary}]}>›</Text>
          </View>
        </Pressable>
      </ScrollView>

      <ConvertDetail visible={tool === 'word2pdf'} onClose={() => setTool(null)} title="Word → PDF" tool="word2pdf" acceptType="docx" accent="#6366F1" />
      <ConvertDetail visible={tool === 'pdf2word'} onClose={() => setTool(null)} title="PDF → Word" tool="pdf2word" acceptType="pdf" accent="#8B5CF6" />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {flex: 1},
  content: {padding: space.lg, paddingBottom: 40, gap: 12},
  hero: {paddingTop: 8, paddingBottom: 4, gap: 4},
  heroTitle: {fontSize: 22, fontWeight: '800', letterSpacing: 0.5},
  heroSub: {...type.body},
  divider: {height: StyleSheet.hairlineWidth, marginVertical: 4},
  sectionLabel: {paddingTop: 4, paddingBottom: 2, paddingHorizontal: 4},
  sectionText: {...type.caption, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase'},
  card: {flexDirection: 'row', alignItems: 'center', borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden'},
  accentBar: {width: 4, alignSelf: 'stretch'},
  cardBody: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, paddingRight: 16, paddingVertical: 14},
  iconW: {width: 44, height: 44, borderRadius: 13, justifyContent: 'center', alignItems: 'center', marginLeft: 14, marginVertical: 16},
  icon: {fontSize: 24},
  cardTitle: {fontSize: 15, fontWeight: '700', marginBottom: 2},
  cardDesc: {...type.bodySm},
  arrow: {fontSize: 20, fontWeight: '300'},
});
