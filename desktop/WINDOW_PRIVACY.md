# 窗口与屏幕共享

从 0.5.10 起：

- 主窗口与回答浮窗在首次显示前调用 `setContentProtection(true)`，新建浮窗继承同样的策略。
- macOS 使用 accessory 激活策略与 `LSUIElement`，不在程序坞显示；Windows 使用 `skipTaskbar`。
- 主界面顶部始终提供“隐藏窗口”和“退出程序”，登录、网络错误和面试页面也可操作。
- 隐藏会同时收起主窗口和回答浮窗，采集继续。`⌘⇧H` / `Ctrl+Shift+H` 可隐藏或恢复。快捷键被其他应用占用时，界面不会显示不可用的快捷键；菜单栏 / 托盘仍可打开主窗口。
- 关闭主窗口会退出程序。退出先停止原生采集，等待渲染端保存本地草稿，再刷新磁盘存储、关闭浮窗、销毁托盘、释放快捷键。不依赖远端网络保存成功。保存失败或渲染进程无响应时，提示返回应用或仍然退出。
- 关闭回答浮窗只关闭浮窗。未结束面试保存为待恢复的本地草稿，已结束面试保持只读。

## 支持边界

窗口保护请求成功不代表会议软件一定排除了窗口。Electron 官方说明：

- Windows 10 2004 及更新版本通过 `WDA_EXCLUDEFROMCAPTURE` 排除窗口；较旧版本可能显示黑块。
- macOS 的 `NSWindowSharingNone` 不能阻止使用 ScreenCaptureKit 的新式采集软件。

因此 macOS 应优先只共享其他应用的指定窗口，并在共享预览中检查；需要确定不显示时，使用“隐藏窗口”，此时本机也不再显示回答。默认保护不能替代会议软件实测，也不代表隐藏托盘图标、进程或系统权限指示。

参考：[Electron 窗口保护](https://www.electronjs.org/docs/latest/api/browser-window#winsetcontentprotectionenable-macos-windows)、[激活策略](https://www.electronjs.org/docs/latest/api/app#appsetactivationpolicypolicy-macos)。

## 回归检查

运行 `pnpm typecheck`、`pnpm test`、`pnpm lint --quiet`。编译主进程后，运行 `pnpm exec electron scripts/smoke-app-lifecycle.cjs`，使用独立临时配置检查真实窗口保护标志、程序坞、隐藏/恢复、关闭退出及退出前存储。该检查不录音、不访问账号、不证明第三方屏幕共享的排除效果。

## 小窗口与置顶（0.5.11）

- 面试中，顶部“小窗口”将同一主窗口缩成 420 × 740 竖屏，最小 360 × 560；不重载渲染进程、不重启采集。对话和回答用标签切换。
- 普通窗口可以独立置顶。小窗口强制置顶，恢复时还原原来的尺寸、最大化/全屏状态和普通窗口置顶选择。切换串行执行，离开面试页自动恢复大窗。
- 小窗口开启时关闭旧回答浮窗，并暂停其打开入口，避免同时出现两种浮窗。隐藏/恢复不改变窗口模式；关闭仍走保存草稿后退出的流程。
- macOS 置顶同时开启所有工作区与 `visibleOnFullScreen`，应用保持 accessory 类型，避免切换时重新出现 Dock 运行图标。系统此前固定或“最近使用”的 Dock 项目需单独移除；运行时隐藏不会删除系统历史入口。
- Windows 使用原生 always-on-top 与 skipTaskbar，可覆盖普通及最大化应用。独占全屏、UAC 安全桌面、锁屏不承诺覆盖；不会提高至系统安全窗口级别。
- 窗口置顶不等同于共享排除；ScreenCaptureKit 限制仍适用。

验证：`node scripts/run-smoke-app.cjs` 在真实 Electron 中校验置顶、竖屏尺寸、还原、隐藏恢复、Mac Dock 与退出保存；Windows CI 同样执行，不开启麦克风或系统录音。单元测试另外覆盖全屏异步切换、重复切换、显示器移除和置顶状态隔离。具体 IDE/会议应用的全屏显示与共享预览需分别检查。
