# poc-audio-capture 功能迁移矩阵

| 原项目能力 | 新 RN CLI 实现 | 处理方式 |
|---|---|---|
| MIC / SYSTEM / BOTH | `AudioCaptureScreen` + `AudioCaptureService` | 保留；BOTH 始终为双轨 |
| RECORD_AUDIO 权限 | JS `PermissionsAndroid` + Native 二次校验 | 修正拒绝和重复点击状态 |
| MediaProjection 授权 | `AudioCaptureModule.requestProjectionConsent` | 重写；每个 SYSTEM/BOTH 会话一次性授权 |
| Android 10 支持检测 | `getCapabilities()` | 保留；API 24–28 只开放 MIC |
| 状态灯 | `StatusLight` | 保留并扩展 preparing/finalizing/error |
| 计时器 | `Timer` | 修正为 Native UTC 开始时间，不依赖累加计时 |
| 双路音量 | Native 10Hz 事件 + `VolumeBar`/`AudioVisualizer` | 保留；移除随机假波形 |
| PCM 文件 | `CaptureFileStore` | 重写；`.part` → 原子 `.pcm` |
| WAV 文件 | `WavWriter` | 新增可播放、可分享 WAV |
| 文件路径展示 | `FileInfo` | 保留并增加大小、时长、SHA-256 |
| adb pull 提示 | FileProvider 系统分享 | 修正私有目录无法直接 pull 的问题 |
| WebSocket URL/连接状态 | `StreamingControl` | 保留 |
| “实时”发送 | Native OkHttp 40ms PCM 帧 | 修正旧版停止后伪实时发送 |
| 停止后文件上传 | Native 64KiB backfill | 保留并增加长度/SHA-256 校验 |
| 发送统计 | queued/transport/ACK/dropped/backfill | 扩展并区分客户端与服务端确认 |
| Expo/EAS 残留 | 无 | 删除 |
| React Navigation 单页壳 | 无 | 删除无用户价值依赖 |
| CLI 20 postinstall 补丁 | CLI 15.0.1 官方模板 | 删除 |
| 本机 Gradle ZIP | Gradle 8.12 HTTPS Wrapper | 修正为可移植构建 |
