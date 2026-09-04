# macOS 系统音频采集说明（BlackHole 虚拟声卡）

macOS 没有面向用户态的系统音频回采 API（Electron/Chromium 的 `getDisplayMedia` 在 macOS 上拿不到系统音频轨，仅有部分新版 Chromium 支持"应用/窗口"源音频且受版本限制）。因此桌面端在 macOS 上采用业界标准方案：**虚拟声卡路由 + 普通输入设备采集**。

## 一次性配置（约 2 分钟）

1. 下载并安装 [BlackHole](https://existential.audio/blackhole/)（免费开源虚拟声卡，支持 Intel / Apple Silicon）。
2. Mac 打开「音频 MIDI 设置」（Spotlight 搜索 **Audio MIDI Setup**）。
3. 左下角 **+** 按钮 → 新建**多输出设备（Multi-Output Device）**：
   - 勾选你的扬声器/耳机 + `BlackHole 2ch`（两个都勾）。
   - 双击设备名后改个易识别的名字（如 `面试输出`）。
4. 系统设置 → 声音 → 输出：选择刚创建的多输出设备。
   - 效果：声音同时从扬声器/耳机与 BlackHole 输出；面试官的声音进入 BlackHole。
5. 回到「AI 面试助手」→ 面试页「系统音频源」下拉选择 `BlackHole 2ch`（无设备时点刷新）。

## 不需要的权限

- 无需「屏幕录制」TCC 权限（不截屏）。
- 仅需「麦克风」权限（BlackHole 按输入设备采集，App 首启会请求）。

## 验证

- 面试页「系统音频」电平条随播放声音波动（正常说话时 30%+）。
- 没有声音播放时系统音频轨静默属于正常现象（WASAPI loopback 同理由：无声即无帧）。

## 故障排查

| 现象 | 处理 |
|------|------|
| 系统音频源下拉为空 | 确认 BlackHole 已安装；点击「刷新设备」 |
| 电平条 0 但设备已选 | 确认系统声音输出已切到多输出设备；试播一首歌 |
| 只有自己的声音（回声） | 面试通话 App（腾讯会议/飞书）：「设备」→ 扬声器选 `BlackHole 2ch`（App 播放与系统输出一致即可） |
| 不想用黑盒方案 | 面试语音源是"窗口"时可尝试直接选窗口共享（新版 Chromium 支持窗口音频，选"整个屏幕"无音频） |

## Windows 说明

Windows 使用 WASAPI Loopback（主进程原生 addon）直接采集系统输出，无需任何安装；`pnpm dev` 会自动编译 addon（需 VS2022「使用 C++ 的桌面开发」工作负载，见 `scripts/ensure-native.cjs`）。
