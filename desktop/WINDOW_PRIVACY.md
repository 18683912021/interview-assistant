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
