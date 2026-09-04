/**
 * KnowledgeScreen — 知识库
 *
 * 按公司分类展示面经分享，支持搜索公司名，展开查看详情。
 */

import React, {useCallback, useMemo, useState} from 'react';
import {
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
  useColorScheme,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import SecondaryPage from '../components/SecondaryPage';
import {useTheme, space, radius, type} from '../theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ── Mock Data ──
interface QA {
  q: string;
  a: string;
}
interface Experience {
  position: string;
  time: string;
  preview: string;
  qa: QA[];
}
interface Company {
  name: string;
  count: number;
  experiences: Experience[];
}

const MOCK_DATA: Company[] = [
  {name: '阿里巴巴', count: 128, experiences: [
    {position: '前端开发', time: '2026-07-20', preview: '阿里一面主要考察 JS 基础和 React 原理，手写深拷贝和 Promise.all，二面侧重项目经验和架构设计……', qa: [
      {q: '实现一个深拷贝函数，处理循环引用', a: '使用 WeakMap 记录已拷贝对象，递归处理数组和普通对象，特殊类型（Date/RegExp/Map/Set）单独处理。循环引用时直接返回 WeakMap 中缓存的拷贝。'},
      {q: 'React Fiber 架构的工作原理', a: 'Fiber 是 React 16 引入的协调引擎，将渲染工作拆分为可中断的小单元。每个 Fiber 节点对应一个组件实例，通过链表结构（child/sibling/return）组织，利用 requestIdleCallback 实现时间切片。'},
    ]},
    {position: 'Java 后端', time: '2026-07-15', preview: '面试官很专业，从 JVM 调优问到分布式事务，还聊了 Spring Cloud 微服务架构的实际落地经验……', qa: [
      {q: 'JVM 内存模型和垃圾回收机制', a: 'JVM 内存分为堆、栈、方法区、程序计数器等。堆内存分新生代和老年代，使用可达性分析标记垃圾。常见 GC 算法包括标记清除、复制、标记整理，CMS 和 G1 是主流回收器。'},
    ]},
    {position: '前端开发', time: '2026-06-28', preview: '三面是交叉面，问了很多关于前端性能优化和监控的话题……', qa: [
      {q: '前端性能优化的关键指标有哪些', a: 'FCP（首次内容绘制）、LCP（最大内容绘制）、TTI（可交互时间）、CLS（累计布局偏移）。优化方向包括资源压缩、懒加载、CDN、缓存策略、代码分割等。'},
    ]},
  ]},
  {name: '腾讯', count: 96, experiences: [
    {position: '前端开发', time: '2026-07-22', preview: '腾讯的面试流程很规范，一面基础二面项目三面总监……', qa: [
      {q: 'Webpack 插件机制及手写一个 plugin', a: 'Webpack 插件基于 tapable 事件流机制，通过 compiler.hooks 在不同编译阶段注入逻辑。插件是一个包含 apply(compiler) 方法的类。'},
    ]},
    {position: 'C++ 开发', time: '2026-07-10', preview: '上来就是两道算法题，然后深入问了智能指针和虚函数表……', qa: [
      {q: '智能指针的实现与使用场景', a: 'unique_ptr 独占所有权，shared_ptr 引用计数共享所有权，weak_ptr 解决循环引用。智能指针通过 RAII 自动管理内存，避免手动 delete。'},
    ]},
  ]},
  {name: '字节跳动', count: 210, experiences: [
    {position: '前端开发', time: '2026-07-25', preview: '字节的面试节奏很快，每面都有算法题……', qa: [
      {q: '实现一个虚拟滚动列表', a: '计算可视区域高度和每项高度，只渲染可视范围内的 DOM 节点。通过 transform: translateY 偏移实现滚动效果，监听 scroll 事件动态更新渲染范围。'},
    ]},
    {position: 'Go 开发', time: '2026-07-18', preview: '三面技术面加一面 HR，技术面深挖 Go 协程调度……', qa: [
      {q: 'Go 协程调度原理 GMP 模型', a: 'G 代表 goroutine，M 代表操作系统线程，P 代表处理器。P 的数量由 GOMAXPROCS 决定，M 必须绑定 P 才能执行 G。当 G 阻塞时，M 会释放 P 给其他 M 使用。'},
    ]},
    {position: '前端开发', time: '2026-07-05', preview: '面试体验很好，面试官会给引导和提示……', qa: [
      {q: 'React Hooks 实现原理及闭包陷阱', a: 'Hooks 通过链表存储状态，每次渲染按调用顺序读取。闭包陷阱产生于异步回调捕获了旧的 state。解决方案：useRef 保持引用稳定，或用 useCallback/useEffect 正确声明依赖。'},
    ]},
  ]},
  {name: '美团', count: 75, experiences: [
    {position: 'Java 后端', time: '2026-07-12', preview: '美团的技术面很务实，围绕项目经验展开……', qa: [
      {q: 'Redis 缓存击穿/穿透/雪崩解决方案', a: '击穿：热点 key 过期时加互斥锁；穿透：布隆过滤器拦截不存在 key；雪崩：随机化过期时间 + 多级缓存 + 限流降级。'},
    ]},
    {position: '前端开发', time: '2026-06-30', preview: '问了移动端适配、小程序架构、前端监控等方面……', qa: [
      {q: '移动端 1px 边框问题怎么解决', a: '使用伪元素 + transform: scale(0.5) 实现 0.5px；或用 viewport + rem 方案；或用 border-image / box-shadow 模拟细线。'},
    ]},
  ]},
  {name: '华为', count: 55, experiences: [
    {position: 'C++ 开发', time: '2026-07-08', preview: '华为的面试偏底层，问了操作系统内存管理……', qa: [
      {q: '操作系统虚拟内存管理原理', a: '通过页表将虚拟地址映射到物理地址，使用 MMU 硬件加速。缺页中断时从磁盘换入页面。TLB 缓存热点映射，减少页表访问开销。'},
    ]},
  ]},
  {name: '百度', count: 62, experiences: [
    {position: '前端开发', time: '2026-07-16', preview: '百度面试官很 nice，从 SEO 优化聊到 PWA……', qa: [
      {q: '前端安全之 XSS 和 CSRF 防护', a: 'XSS：对用户输入做转义/过滤，设置 CSP 头，使用 HttpOnly Cookie。CSRF：使用 SameSite Cookie + CSRF Token + Referer 校验三重防护。'},
    ]},
  ]},
  {name: '京东', count: 48, experiences: [
    {position: 'Java 后端', time: '2026-07-02', preview: '京东的技术栈比较全面，面试问到了 DDD 落地经验……', qa: [
      {q: '数据库分库分表方案设计', a: '垂直拆分按业务模块，水平拆分按分片键（如 user_id）。常用中间件 ShardingSphere。需考虑跨分片查询、分布式 ID 生成、数据迁移等问题。'},
    ]},
  ]},
];

// ── Company Card ──
function CompanyCard({company, expanded, onToggle, onExpPress, dark}: {
  company: Company; expanded: boolean; onToggle: () => void;
  onExpPress: (exp: Experience) => void; dark: boolean;
}) {
  const t = useTheme(dark);
  return (
    <View style={[s.card, {backgroundColor: t.bgSurface, borderColor: t.divider}, t.shadowSm]}>
      <Pressable onPress={onToggle} android_ripple={{color: t.accent + '10'}} style={s.cardHead}>
        <View style={[s.accentBar, {backgroundColor: t.accent}]} />
        <View style={s.cardHeadContent}>
          <View style={s.cardHeadLeft}>
            <Text style={[s.companyIcon]}>🏢</Text>
            <View style={{flex: 1}}>
              <Text style={[s.companyName, {color: t.textPrimary}]}>{company.name}</Text>
              <Text style={[s.companyMeta, {color: t.textTertiary}]}>{company.count} 篇面经</Text>
            </View>
          </View>
          <Text style={[s.arrow, {color: t.textTertiary}]}>{expanded ? '▾' : '▸'}</Text>
        </View>
      </Pressable>
      {expanded && company.experiences.map((exp, i) => (
        <Pressable
          key={i}
          style={[s.expItem, i > 0 && {borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.divider}]}
          onPress={() => onExpPress(exp)}
          android_ripple={{color: t.accent + '10'}}>
          <View style={s.expTop}>
            <View style={[s.posBadge, {backgroundColor: t.accentLight}]}>
              <Text style={[s.posText, {color: t.accent}]}>{exp.position}</Text>
            </View>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
              <Text style={[s.expTime, {color: t.textTertiary}]}>{exp.time}</Text>
              <Text style={[s.chevron, {color: t.textTertiary}]}>›</Text>
            </View>
          </View>
          <Text style={[s.expPreview, {color: t.textSecondary}]} numberOfLines={2}>{exp.preview}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ── Main ──
export default function KnowledgeScreen(): React.JSX.Element {
  const dark = useColorScheme() === 'dark';
  const t = useTheme(dark);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Experience | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) { return MOCK_DATA; }
    const kw = search.trim();
    return MOCK_DATA.filter(c => c.name.includes(kw));
  }, [search]);

  const toggleExpand = useCallback((name: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }, []);

  return (
    <SafeAreaView style={[s.container, {backgroundColor: t.bg}]} edges={['top', 'bottom']}>
      {/* Search */}
      <View style={[s.searchWrap, {backgroundColor: t.bgSurface, borderColor: t.divider}, t.shadowSm]}>
        <Text style={s.searchIcon}>🔍</Text>
        <TextInput
          style={[s.searchInput, {color: t.textPrimary}]}
          placeholder="搜索公司名称"
          placeholderTextColor={t.textTertiary}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <Text style={[s.clearBtn, {color: t.textTertiary}]}>✕</Text>
          </Pressable>
        )}
      </View>

      {/* List */}
      <ScrollView
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {filtered.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>📭</Text>
            <Text style={[s.emptyTitle, {color: t.textPrimary}]}>未找到匹配的公司</Text>
            <Text style={[s.emptySub, {color: t.textTertiary}]}>换个关键词试试</Text>
          </View>
        ) : (
          filtered.map(company => (
            <CompanyCard
              key={company.name}
              company={company}
              expanded={expanded.has(company.name)}
              onToggle={() => toggleExpand(company.name)}
              onExpPress={setDetail}
              dark={dark}
            />
          ))
        )}
      </ScrollView>

      {/* Detail Modal */}
      {detail && (
        <SecondaryPage visible={!!detail} onClose={() => setDetail(null)} title="面经详情">
          <View style={[s.detailMeta, {backgroundColor: t.bgSurface, borderColor: t.divider}, t.shadowSm]}>
            <View style={s.detailRow}>
              <Text style={[s.detailLabel, {color: t.textTertiary}]}>岗位</Text>
              <View style={[s.posBadge, {backgroundColor: t.accentLight}]}>
                <Text style={[s.posText, {color: t.accent}]}>{detail.position}</Text>
              </View>
            </View>
            <View style={[s.detailDivider, {backgroundColor: t.divider}]} />
            <View style={s.detailRow}>
              <Text style={[s.detailLabel, {color: t.textTertiary}]}>时间</Text>
              <Text style={[s.detailVal, {color: t.textPrimary}]}>{detail.time}</Text>
            </View>
          </View>
          <Text style={[s.detailIntro, {color: t.textSecondary}]}>{detail.preview}</Text>
          <Text style={[s.qaTitle, {color: t.textPrimary}]}>面试真题</Text>
          {detail.qa.map((item, i) => (
            <View key={i} style={[s.qaCard, {backgroundColor: t.bgSurface, borderColor: t.divider}, t.shadowSm]}>
              <Text style={[s.qaQ, {color: t.accent}]}>Q{i + 1}. {item.q}</Text>
              <View style={[s.qaDivider, {backgroundColor: t.divider}]} />
              <Text style={[s.qaA, {color: t.textSecondary}]}>{item.a}</Text>
            </View>
          ))}
        </SecondaryPage>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {flex: 1},

  // Search
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: space.lg, marginTop: space.md, marginBottom: 4,
    borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14, height: 48,
  },
  searchIcon: {fontSize: 16, marginRight: 10},
  searchInput: {flex: 1, fontSize: 15},
  clearBtn: {fontSize: 18, padding: 6},

  // List
  list: {padding: space.lg, paddingBottom: 32, gap: 12},

  // Empty
  empty: {alignItems: 'center', marginTop: 80, gap: 8},
  emptyIcon: {fontSize: 48},
  emptyTitle: {...type.heading},
  emptySub: {...type.bodySm},

  // Card
  card: {borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden'},
  cardHead: {flexDirection: 'row', overflow: 'hidden'},
  accentBar: {width: 4},
  cardHeadContent: {
    flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 16,
  },
  cardHeadLeft: {flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1},
  companyIcon: {fontSize: 22},
  companyName: {fontSize: 16, fontWeight: '700', marginBottom: 2},
  companyMeta: {...type.caption},
  arrow: {fontSize: 18, fontWeight: '300'},

  // Experience items
  expItem: {paddingHorizontal: 16, paddingVertical: 14},
  expTop: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8},
  posBadge: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.sm,
  },
  posText: {fontSize: 12, fontWeight: '700'},
  expTime: {...type.caption},
  expPreview: {fontSize: 13, lineHeight: 22},
  chevron: {fontSize: 18, fontWeight: '300'},

  // Detail
  detailMeta: {
    borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  detailRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
  },
  detailLabel: {...type.bodySm},
  detailVal: {...type.bodySm, fontWeight: '600'},
  detailDivider: {height: StyleSheet.hairlineWidth, marginHorizontal: 16},
  detailIntro: {...type.body, lineHeight: 24, marginTop: 14},
  qaTitle: {...type.heading, marginTop: 20, marginBottom: 2},
  qaCard: {
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth,
    padding: 16, gap: 10,
  },
  qaQ: {fontSize: 14, fontWeight: '700', lineHeight: 22},
  qaDivider: {height: StyleSheet.hairlineWidth},
  qaA: {fontSize: 13, lineHeight: 22},
});
