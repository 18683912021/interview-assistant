# Storybook 改造方案（改造后的结构 + 哪些能用 / 哪些不能用）

> 配套阅读：[Storybook入门指南.md](./Storybook入门指南.md)（概念与安装）
> 本文回答两个问题：**改造完成后项目长什么样？** 和 **哪些文件能进 Storybook、哪些不能？**

---

## 一、改造完成后，你的项目长这样

图例：✅ 能用（推荐进陈列室） ｜ ⚠️ 能用但有讲究 ｜ ❌ 不能用（不是 UI 零件，或依赖 Electron / 网络）

```
audio-capture/
│
├── .storybook/                        ✅ 新增：Storybook 配置（init 自动生成）
│   ├── main.ts                        │   主配置：框架、插件、故事文件扫描范围
│   └── preview.tsx                    │   全局配置：加载 index.css + 明暗主题切换
│
├── src/
│   ├── stories/                       ❌ 删除：init 送的示例组件和示例故事（教学样板）
│   │
│   ├── components/                    ✅ 绿区：8 个纯 UI 组件，全部上陈列室
│   │   ├── Avatar.tsx
│   │   ├── Avatar.stories.tsx                 ← 新增（下面每个组件都配一个）
│   │   ├── ConversationBubble.tsx
│   │   ├── ConversationBubble.stories.tsx     ← 新增
│   │   ├── MicLevelBar.tsx
│   │   ├── MicLevelBar.stories.tsx            ← 新增
│   │   ├── PulsingDot.tsx
│   │   ├── PulsingDot.stories.tsx             ← 新增
│   │   ├── Toast.tsx
│   │   ├── Toast.stories.tsx                  ← 新增
│   │   ├── AppAlert.tsx
│   │   ├── AppAlert.stories.tsx               ← 新增
│   │   ├── SecondaryPage.tsx
│   │   ├── SecondaryPage.stories.tsx          ← 新增
│   │   ├── SeparatorLine.tsx
│   │   └── SeparatorLine.stories.tsx          ← 新增
│   │
│   ├── screens/                       ❌ 红区：8 个页面，暂不进陈列室
│   │   ├── AgreementScreen.tsx               （原因见第三节）
│   │   ├── AuthScreen.tsx
│   │   ├── InterviewHistoryScreen.tsx
│   │   ├── InterviewScreen.tsx
│   │   ├── OverlayScreen.tsx
│   │   ├── ProfileScreen.tsx
│   │   ├── SubscriptionScreen.tsx
│   │   └── ToolsScreen.tsx
│   │
│   ├── hooks/                         ❌ 红区（不是 UI；useAudioCapture 依赖 Electron）
│   │   ├── useAudioCapture.ts         │   —— 直接调 window.electronAPI?.audio，浏览器里没有
│   │   └── useKeyboardShortcuts.ts    │   —— 全局键盘监听，跟具体组件无关
│   │
│   ├── api/                           ❌ 红区：HTTP 请求层（打到后端 47.108.205.102:8010）
│   │   ├── auth.ts  client.ts  interview.ts  resume.ts
│   │
│   ├── stream/ws-client.ts            ❌ 红区：WebSocket 长连接
│   ├── platform/storage.ts            ❌ 红区：Electron 存储
│   ├── types/electron.d.ts            ❌ 红区：只是类型声明，没有界面
│   │
│   ├── store/                         ⚠️ 灰区：不进陈列室，但能当"数据工厂"用
│   │   ├── interview-reducer.ts       │   逻辑层不能展示；但 reducer 是纯函数，
│   │   └── types.ts                   │   可以在故事里用它生成"真实形状"的假消息
│   │
│   ├── theme/tokens.ts                ⚠️ 灰区：纯设计变量，被 index.css 引用后间接生效
│   ├── utils/AuthContext.ts           ⚠️ 灰区：纯 React Context，可当"包装盒"包在故事外面
│   │
│   ├── App.tsx  /  main.tsx           ❌ 红区：应用入口（组装页面和路由），不是零件
│   └── index.css  /  config.ts        ⚠️ index.css 会被 preview.tsx 引入；config.ts 是配置
│
├── storybook-static/                  ✅ 新增：build-storybook 的构建产物（已自动 gitignore）
│
├── package.json                       ✅ 修改：新增 2 个脚本 + 一批 devDependencies
├── vite.config.ts                     ➖ 不用动（@ 别名 Storybook 自动复用）
├── tailwind.config.js                 ➖ 不用动（content 已覆盖 src/**，故事文件里的类能被生成）
└── docs/Storybook入门指南.md           ✅ 本文档的"概念课"
```

---

## 二、哪些能用 Storybook（绿区）—— 8 个组件 + 每个写哪些故事

判断依据一句话：**只看 props 就能把样子摆出来的纯界面零件，就能上**。你的 8 个组件全部符合。

| 组件 | 建议写的故事（每个状态一个展位） | 备注 |
|---|---|---|
| **ConversationBubble** 对话气泡 | 加载中 ｜ AI 流式输出 ｜ 用户已答 ｜ 面试官提问 ｜ 出错可重试 | 全项目状态最多、最值得写，入门指南里有完整模板 |
| **MicLevelBar** 音量条 | 静音 ｜ 低音量 ｜ 中等音量 ｜ 高音量 ｜ 爆音 | 用不同 `level` 值摆一排，一眼看出刻度手感 |
| **Toast** 轻提示 | 普通 ｜ 成功 ｜ 警告 ｜ 失败 | 不同 `type` + 时长 |
| **AppAlert** 提示条 | 错误 ｜ 警告 ｜ 成功 | 看 props 有哪些种类 |
| **Avatar** 头像 | 面试官 ｜ AI ｜ 用户 ｜ 无头像/占位 | 不同角色或空值 |
| **PulsingDot** 呼吸圆点 | 动画中 ｜ 停止 | 确认动画节奏是否合适 |
| **SecondaryPage** 次级页壳 | 带返回 ｜ 不带返回 | 页面壳子，注意别引入真实页面内容 |
| **SeparatorLine** 分隔线 | 默认样式 | 最简单，1 个故事就够 |

**可以顺手一起用的"灰区"文件（不写故事，但帮大忙）：**

- `store/interview-reducer.ts` —— 纯函数，放在故事里**造假数据**，保证假消息和真实消息长得一模一样；
- `theme/tokens.ts` —— 被 `index.css` 引入后自动生效，故事里不用管；
- `utils/AuthContext.ts` —— 如果某组件要读 Context，用它当包装盒包一层即可，本身零成本。

---

## 三、哪些不能用 Storybook（红区）—— 以及为什么

| 文件 / 目录 | 为什么不能上 | 通俗解释 |
|---|---|---|
| **screens/ 全部 8 个页面** | 依赖 `useAudioCapture`（内部调 `window.electronAPI`）、后端 HTTP 接口、WebSocket | Storybook 是普通浏览器：没有 preload 注入的 Electron 功能，也不该连你的真实后端。页面是"组装层"——组件调好后再在真实应用里组装 |
| **hooks/useAudioCapture.ts** | 直接调用 `window.electronAPI?.audio`（见文件第 23 行） | 浏览器里 `window.electronAPI` 是 `undefined`，一跑就报错 |
| **hooks/useKeyboardShortcuts.ts** | 全局键盘监听，不属于任何具体零件 | 逻辑型 hook，没有"样子"可展示 |
| **api/ 四个文件** | 发 HTTP 请求到 `47.108.205.102:8010` | 网络层，Storybook 不启动也不该依赖真实后端 |
| **stream/ws-client.ts** | WebSocket 长连接 | 同上，网络层 |
| **platform/storage.ts** | 走 Electron 的存储能力 | 浏览器里没有对应实现 |
| **types/electron.d.ts** | 只是类型声明，没有界面 | 无 UI 可展示 |
| **App.tsx / main.tsx** | 应用入口：路由 + 全局组装 | 是"整个餐厅"，不是"一道菜" |

### 三句话判断标准（以后新写的文件自己判断）

1. **只靠 props 就能摆出样子的纯 UI 零件 → 能用**（放进 `components/` 并写故事）；
2. **要 Electron 窗口能力、真实后端、真实网络才能跑 → 不能用**（别硬塞，浏览器里没有这些东西）；
3. **逻辑层（请求、存储、状态、类型）→ 不进陈列室**，但可以作为"数据工厂 / 包装盒"在故事里帮忙造假数据。

> 💡 以后如果真想给某个页面也做故事：把页面依赖的 Electron / 网络能力抽成 props 或 Context，再在故事里用包装盒塞假实现（mock）就能跑。**但项目现阶段不建议为此重构**——先把 8 个组件的故事写好，收益已经很大。

---

## 四、改造步骤清单（照顺序做，约 30 分钟）

| 步骤 | 做什么 | 命令 / 文件 |
|---|---|---|
| 1 | 初始化 Storybook | `pnpm dlx storybook@latest init` |
| 2 | 删除示例故事 | `rm -rf src/stories`（或手动删） |
| 3 | 配置全局样式 + 明暗切换 | `.storybook/preview.ts` 重命名为 `preview.tsx`，写入入门指南第七节的代码 |
| 4 | 给 8 个组件各写故事 | `src/components/*.stories.tsx` × 8（照入门指南第六节模板） |
| 5 | 启动验证 | `pnpm storybook` → 打开 http://localhost:6006，检查：左侧 8 个组件都在、明暗切换生效、点气泡 Actions 有日志 |
| 6 | （可选）生成静态站 | `pnpm build-storybook` → 产物在 `storybook-static/`，可打包发给同事/设计师看 |

---

## 五、改造前后文件变化清单

| 类型 | 文件 | 说明 |
|---|---|---|
| ✅ 新增 | `.storybook/main.ts` | init 自动生成，一般不用改 |
| ✅ 新增 | `.storybook/preview.tsx` | 手写：引入 `index.css` + 明暗主题切换 |
| ✅ 新增 | `src/components/*.stories.tsx` × 8 | 每个组件一个故事文件 |
| ✅ 新增 | `storybook-static/` | 构建产物，已自动加入 `.gitignore`，不管它 |
| 🔧 修改 | `package.json` | 自动加上 `storybook` / `build-storybook` 两个脚本 + `@storybook/react-vite` 等 devDependencies |
| ❌ 删除 | `src/stories/` | init 送的示例组件和故事 |
| ❌ 删除 | `.storybook/preview.ts` | 重命名为 `preview.tsx`（要写 JSX） |
| ➖ 不动 | `vite.config.ts` | 别名 `@` 被 Storybook 自动复用 |
| ➖ 不动 | `tailwind.config.js` | `content` 已覆盖 `src/**`，故事文件的样式类能正常生成 |
| ➖ 不动 | 全部业务代码 | `components/` 组件本体、`screens/`、`api/`、`store/` 等一律不碰 |

> 核心原则：**Storybook 只加东西，不改动你现有代码**。装完删掉示例、写完故事，随时可以 `pnpm dev` 回到正常开发，两者互不干扰。

---

## 总结（记住 4 句）

1. 改造 = 新增 `.storybook/` 配置 + 8 个 `.stories.tsx`，**现有代码一行不用改**；
2. **能用**：`components/` 里 8 个纯组件（每个状态一个故事）；
3. **不能用**：`screens/` 页面、`useAudioCapture`、`api/`、`stream/`、`platform/`（依赖 Electron 或网络，浏览器里没有）；
4. 逻辑层文件（store 的 reducer、AuthContext、tokens）不上陈列室，但可以在故事里当"假数据工厂"帮忙。

官方参考：[storybook.org.cn 文档](https://storybook.org.cn/docs)
