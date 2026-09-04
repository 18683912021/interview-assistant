# Storybook 入门指南（写给完全没接触过的你）

> 这份文档专门为你的项目（React 19 + Vite + TypeScript + Tailwind 的 Electron 应用）写的。
> 假设你完全没接触过 Storybook。每一步都可以照抄照做，10 分钟跑起来。

---

## 〇、先记一句话

> **Storybook = 你项目的"组件陈列室"。**
> 它是个跑在浏览器里的独立小工具，专门让你**不用启动整个应用**，就能单独看、单独调每一个界面零件（组件）。

记住这句话就够了，下面全是解释它。

---

## 一、Storybook 到底是个啥？（用大白话讲）

### 它的名字就是最好的解释

"Storybook" 翻译过来就是**故事书**。它的核心概念叫 **story（故事）**：

- 你项目里的每个界面零件（对话气泡、音量条、头像……）叫**组件**，就是积木块；
- 每个组件在真实使用中会有**好几种样子**（状态）：加载中、输出了、出错了……
- **每一种样子，就是"一个故事"**。把组件的所有故事写下来，就成了一本"故事书"（Storybook）。

### 打个比方：你是厨师，它是试菜间

以前你想看看自己做的"对话气泡"好不好看，必须**把整个餐厅（整个 Electron 应用）开起来**，点进去找到那个页面，还要想办法把气泡"弄成出错的样子"才能看到——费劲吧？

Storybook 就是一个**试菜间**：

- 你想看哪道菜，单独端出来看，**餐厅不用开门营业**；
- 想试试"盐多放点"（参数改一改），在面板里拧一下就行，菜立即重新上；
- 想同时看"正常版"和"烧糊版"（出错状态），并排摆着看。

### 再打个比方：它是手机里的"应用商店"

Storybook 本体很小，它的**插件（addon）**就像手机 App：想要什么功能，点一下装上就行（自动调参数、记录点击事件、自动生成文档……）。你项目装好后默认自带一整套常用插件，**暂时不用你操心装什么**。

### 注意一件事：它不是测试工具

它不写"对错判断"，跑不了测试用例。它是**给你人看的**——帮你把组件做好、看清楚、留个说明书。你的项目里管自动测试的是 Vitest，两者各管各的，不冲突。

---

## 二、用它到底图啥？（对你来说的 4 个实在好处）

1. **省时间。** 你的 `pnpm dev` 要同时启动 Vite + TypeScript 编译 + Electron 窗口，很重。改一个气泡样式也要等整套起来。Storybook 只开一个浏览器页面，**秒开**。
2. **能看到"平时看不到的样子"。** 比如 `ConversationBubble` 的"流式打字"、"出错重试"状态，真实使用里难得一见；在 Storybook 里**每个状态都是独立按钮，点一下就看**。
3. **改完立刻刷新。** 存一下文件，浏览器马上变，不用手动刷新。
4. **顺手攒下说明书。** 以后你（或别人）想看某个组件怎么用、有哪些状态，打开 Storybook 翻一翻就懂，不用读源码。

---

## 三、你的项目能不能用？——能！天生合适

先对号入座看你的技术栈：

| 你项目里的东西 | Storybook 认不认 |
|---|---|
| React 19 | ✅ 认（Storybook 10 对 React 19 是官方一流支持） |
| Vite 6 | ✅ 认（零配置，自动识别） |
| TypeScript | ✅ 认，还有类型提示 |
| Tailwind 3 | ✅ 认（接一行代码，见第六节） |
| framer-motion（动画） | ✅ 认，不用管 |

**关键看你的组件目录**：[src/components/](../src/components/) 里的 8 个组件（`ConversationBubble`、`Avatar`、`MicLevelBar`、`PulsingDot`、`Toast`、`AppAlert`、`SecondaryPage`、`SeparatorLine`）**全是纯界面零件**——不碰 Electron 内部功能、不依赖网络。这种组件放进陈列室最完美。

⚠️ 唯一要注意的：你的 `useAudioCapture.ts` 和 `screens/` 里的页面用到了 Electron 的能力（`window.electron` 之类）。**Storybook 是普通浏览器，没有这些**。所以规矩很简单：**只给 `components/` 里的纯组件写故事，别给页面写**（详见第七节）。

---

## 四、安装（照抄就行，约 5 分钟）

在你项目目录打开终端（`agent_app/workspace/fe/audio-capture`），输入：

```bash
pnpm dlx storybook@latest init
```

它会自动帮你干活：

1. 认出你是"React + Vite"项目，自动装上配套的东西（`@storybook/react-vite` 和常用插件）；
2. 在你的 `package.json` 里自动加上两个"快捷命令"（脚本）：
   - `pnpm storybook` —— 启动陈列室（开发用）
   - `pnpm build-storybook` —— 生成一个静态网页版（以后想发给别人看用）
3. 生成两个配置文件：`.storybook/main.ts`（主设置）和 `.storybook/preview.ts`（全局设置）；
4. 在 `src/stories/` 里放几个**示例组件和示例故事**——那是人家送的"教学样板"，**可以直接删掉**，留着也不碍事。

然后启动：

```bash
pnpm storybook
```

等几秒，浏览器会自己打开 **http://localhost:6006**。

> 小提示：初始化过程如果问"要不要装 eslint 插件"，选装（你有 ESLint，装了更规范）。

---

## 五、第一次打开，你会看到什么？（界面导览）

Storybook 页面长得像"文件管理器 + 展示台"：

```
┌────────────────────────────────────────────────────────────┐
│ 工具栏（明暗切换、设备尺寸、插件入口……）                       │
├──────────────┬─────────────────────────────────────────────┤
│ 左侧：目录     │ 中间：展示台                                  │
│              │                                             │
│ ▶ 业务组件    │    ┌─────────────────────────┐              │
│   ▶ 对话气泡   │    │    👤 你                 │              │
│     • 加载中   │    │    我会用 React 和 TS…   │              │
│     • 流式输出 │    │                          │              │
│     • 用户已答 │    │  （当前选中的"故事"在这里）│              │
│     • 出错重试 │    └─────────────────────────┘              │
│   ▶ 音量条    │                                             │
│              │  右侧：两个小面板                              │
│              │  [Controls] 拧参数用的，调完立即变             │
│              │  [Actions]  记录你点的按钮触发了什么事件         │
└──────────────┴─────────────────────────────────────────────┘
```

三个区域说明：

| 区域 | 是什么 | 小白怎么玩 |
|---|---|---|
| **左侧目录** | 你的组件树（分组/文件夹形式） | 点哪个"故事"，中间就显示哪个 |
| **中间展示台** | 当前故事的"实物展示" | 就盯着它看，也可以直接点它（比如点气泡试交互） |
| **右侧面板** | `Controls`（参数调节器）+ `Actions`（事件记录器） | Controls 里拧参数，中间立即变化；Actions 里看回调被触发 |

**新手第一个动作**：装好后，随便点左侧目录里的一个示例故事，再在右边 Controls 面板里改几个参数，看中间的变化——你就懂它是什么了。

---

## 六、用你自己的组件写第一个"故事"（手把手）

**约定**：给哪个组件写故事，文件就放在它旁边，叫 `<组件名>.stories.tsx`。比如：

```
src/components/ConversationBubble.tsx           ← 组件本体（已存在）
src/components/ConversationBubble.stories.tsx   ← 它的故事书（新建）
```

新建文件 `src/components/ConversationBubble.stories.tsx`，内容照抄：

```tsx
// 第 1 行～第 7 行：导入需要的东西
//   Meta / StoryObj 是 Storybook 的类型（带类型提示的说明书）
//   ConversationBubble 就是要展示的组件
//   ConversationMessage 是消息的类型（字段在哪定义就 import 谁）
import type { Meta, StoryObj } from '@storybook/react';
import ConversationBubble from './ConversationBubble';
import type { ConversationMessage } from '../store/types';

// meta：这个组件的"总说明书"——告诉 Storybook 展示谁、放在目录哪个位置
const meta = {
  title: '业务组件/对话气泡',   // 在左侧目录里的位置（斜杠 = 文件夹层级）
  component: ConversationBubble, // 要展示的组件
  tags: ['autodocs'],            // 自动生成一页图文说明书
} satisfies Meta<typeof ConversationBubble>;

export default meta;
type Story = StoryObj<typeof meta>;

// 先做一份"消息"的底料，各个故事在此基础上改
// （字段和 src/store/types.ts 里完全一致：id / role / text / status / timestamp）
const base: ConversationMessage = {
  id: '1',
  text: '',
  timestamp: Date.now(),
};

// 下面每个 export 就是"一个故事"（一个展位、一种状态）

export const 加载中: Story = {
  args: { message: { ...base, role: 'ai', status: 'loading', text: '' } },
};

export const AI流式输出: Story = {
  args: {
    message: {
      ...base,
      role: 'ai',
      status: 'streaming',
      text: '你好，我是面试助手。可以先简单介绍一下你自己吗？',
    },
  },
};

export const 用户已答: Story = {
  args: {
    message: { ...base, role: 'user', status: 'done', text: '我会用 React 和 TypeScript 写业务组件。' },
    onTriggerLLM: (id) => console.log('触发 LLM:', id), // 传给组件的事件回调
  },
};

export const 出错可重试: Story = {
  args: {
    message: { ...base, role: 'ai', status: 'error', text: '网络出错了，请稍后重试。' },
    onRetryLLM: (id) => console.log('重试:', id),
  },
};
```

保存文件，回到 Storybook 页面：

1. 左侧出现 **业务组件 → 对话气泡**，下面挂着 4 个故事；
2. 点"用户已答"→ 中间出现气泡；
3. 点右侧 **Actions 面板**，再点一下中间的气泡 → 面板里打印出 `触发 LLM: 1`。这就是"点气泡触发 AI 回调"被现场记录下来了；
4. 再点 **Controls 面板**，把文字改一改 → 中间立即变。爽不爽？

**以后写新组件照这个模板抄**：顶部"说明书"（meta）→ 一份底料（base）→ 每个状态一个故事。3 分钟一个。

---

## 七、把 Tailwind 样式接进来（否则组件是"裸"的）

你的组件样式全靠 Tailwind，Storybook 默认不认识它，必须手动接一行。

### 第 1 步：让 Storybook 加载你的全局样式

打开 `.storybook/preview.ts`，改成：

```ts
// .storybook/preview.ts
import '../src/index.css';
```

这一行的意思是："把项目的样式表也带给陈列室"。

### 第 2 步：加一个"明暗主题"切换按钮（可选但很推荐）

你的项目是**暗色模式 + 亮色模式**两套皮肤（Tailwind 的 `dark:` 前缀 + CSS 变量）。想让 Storybook 也能切着看，需要给每个故事外面**套一个"包装盒"**，按当前选的主题给盒子加 `dark` 类。

注意：下面代码里有 HTML 标签，所以文件要叫 `.storybook/preview.tsx`（把 `.ts` 重命名成 `.tsx`）：

```tsx
// .storybook/preview.tsx
import type { Decorator } from '@storybook/react';
import '../src/index.css';

// 在顶部工具栏加一个"主题"下拉按钮
export const globalTypes = {
  theme: {
    description: '明暗主题',
    toolbar: {
      title: '主题',
      icon: 'contrast',
      items: [
        { value: 'light', title: '浅色' },
        { value: 'dark', title: '深色' },
      ],
      dynamicTitle: true,
    },
  },
};

// 给每个故事套一层"包装盒"：深色模式时加 dark 类 + 深色背景
export const decorators: Decorator[] = [
  (Story, context) => {
    const isDark = context.globals.theme === 'dark';
    return (
      <div
        className={isDark ? 'dark' : ''}
        style={{
          padding: 24,
          minHeight: '100vh',
          background: isDark ? '#141416' : '#F7F8FA',
        }}
      >
        <Story />
      </div>
    );
  },
];
```

保存后，Storybook 顶部工具栏多了一个"主题"按钮，点一下全体变暗/变亮，跟真实应用效果完全一致。

---

## 八、看到这些词别慌（小词典）

| 词 | 大白话 | 对应例子里哪部分 |
|---|---|---|
| **Story（故事/展位）** | 组件的一种状态展示，一个文件可以有多个 | `加载中`、`用户已答`……每个 export |
| **Meta（说明书）** | 告诉 Storybook"展示谁、放哪个目录" | 文件顶部的 `meta` 常量 |
| **Args（参数）** | 传给组件的属性值，故事之间各不相同 | `args: { message: {...} }` |
| **Controls（调参面板）** | Storybook 自动生成的"拧参数"界面 | 右侧第一个面板 |
| **Actions（事件记录）** | 记录组件里触发的回调 | 右侧第二个面板 |
| **Decorator（包装盒）** | 给故事套一层外壳（主题、背景、假数据） | 第七节的 `decorators` |

全部记住前，记住 3 个就够：**故事 = 状态，参数 = 属性，包装盒 = 外套**。

---

## 九、Electron 项目的 3 个大坑（必读）

1. **`window.electron` 在 Storybook 里不存在。** Storybook 是普通浏览器，没有你的 preload 脚本。所以：
   - ✅ 只给 `src/components/` 的**纯组件**写故事（现在这些全都合格）；
   - ⚠️ 别给 `screens/` 页面写故事（它们依赖 `useAudioCapture`、WebSocket、Electron）；
   - 真遇到需要的组件，用"包装盒"塞一个假实现（mock）进去，但最好还是别让组件碰这些。
2. **故事里别发网络请求。** 保持组件"只收数据、不管数据从哪来"——这本来就是好习惯，数据由外面传进来。
3. **`@/` 快捷路径能用。** Storybook 会自动读取你的 `vite.config.ts`，所以组件里 `import xxx from '@/yyy'` 在陈列室里照样工作，不用担心。

---

## 十、日常工作怎么用？（3 步走）

```
写新功能时：
1. 先在 Storybook 里搭组件：把每个状态都摆出来，调样式、调交互，调到满意
2. 再进 screens/ 页面里接数据、接线
3. 最后才跑 pnpm dev 看真实集成效果
```

这样你**不用频繁启动整套 Electron 应用**，只有最后一步才需要。顺便养成两个习惯：

- 新写一个组件 → 顺手写它的 `.stories.tsx`（抄第六节模板）；
- 改动一个组件 → 在 Storybook 里把所有故事点一遍，确认没改坏其他状态。

---

## 十一、卡住了怎么办？（问题速查）

| 症状 | 原因 / 解决办法 |
|---|---|
| 启动后页面空白 | 检查 `.storybook/preview.ts(x)` 里的 `import '../src/index.css'` 在不在；浏览器按 F12 看报错 |
| 组件没有样式（"裸奔"） | Tailwind 没接上——看第七节第 1 步 |
| 报错 `window is not defined` 之类 | 组件碰了 Electron 功能，不属于纯组件，按第九节处理 |
| 改了代码没反应 | 正常是自动刷新；真不刷新就手动刷新浏览器，或重启 `pnpm storybook` |
| 端口 6006 被占用 | 换个端口：`pnpm storybook --port 6007` |
| 想调整目录分组 | 改每个故事 `title` 里的文字，用 `/` 分层级（如 `'业务组件/对话气泡'`） |

---

## 最后总结（记住 3 句）

1. **Storybook = 组件陈列室**：不用启动整个应用，单独看、单独调每个组件；
2. **一个状态 = 一个故事**，写在组件旁边的 `<名字>.stories.tsx` 里；
3. **你的纯组件目录天生适合它**，装好、接上 Tailwind、开写。

想了解更多，官方有**中文站**：[storybook.org.cn](https://storybook.org.cn/docs)（入门教程：https://storybook.org.cn/tutorials/intro-to-storybook/），照着它的"任务清单"小项目练一遍，概念就全通了。
