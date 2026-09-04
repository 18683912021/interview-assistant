# Audio Capture — React Native CLI Android

纯 React Native CLI Android 工程，用于在 Android Studio 中测试和打包麦克风、系统播放音频及双轨采集。

## 固定环境

- Node.js `22.23.1`
- npm `10.9.8`
- React Native `0.78.3`
- React `19.0.0`
- JDK `17`
- Gradle `8.12`
- AGP `8.8.0`
- Kotlin `2.0.21`
- Android SDK / target SDK `35`
- NDK `27.1.12297006`
- New Architecture：关闭
- Hermes：开启

完整环境说明见仓库根目录 `RN_ANDROID_STUDIO_SETUP.md`。

## 安装

```powershell
nvm use 22.23.1
npm ci
npm run verify:config
```

## Android Studio

1. 使用 Android Studio 打开 `fe-app/audio-capture/android`。
2. Gradle JDK 选择 JDK 17。
3. 使用项目 Gradle Wrapper，不接受 AGP/Gradle 自动升级。
4. 等待 Gradle Sync 完成。
5. 启动 API 35 模拟器或连接 Android 真机。
6. 项目根目录单独启动 Metro：

```powershell
npm start
```

7. Android Studio 选择 `app` 后点击 Run/Debug。

真机连接 Metro：

```powershell
adb reverse tcp:8081 tcp:8081
```

## 构建

```powershell
cd android
.\gradlew.bat assembleDebug
.\gradlew.bat assembleRelease
.\gradlew.bat bundleRelease
```

产物：

```text
android/app/build/outputs/apk/debug/app-debug.apk
android/app/build/outputs/apk/release/app-release-unsigned.apk
android/app/build/outputs/bundle/release/app-release.aab
```

Release 不使用 debug keystore。正式签名通过用户级 Gradle properties 或环境变量提供：

```text
AUDIO_CAPTURE_UPLOAD_STORE_FILE
AUDIO_CAPTURE_UPLOAD_STORE_PASSWORD
AUDIO_CAPTURE_UPLOAD_KEY_ALIAS
AUDIO_CAPTURE_UPLOAD_KEY_PASSWORD
```

密钥和口令不得提交到仓库。

## 功能

- MIC、SYSTEM、BOTH 三种采集模式
- Android 10+ MediaProjection 系统音频授权
- 前台采集服务和通知栏 Stop
- 16kHz / PCM16LE / mono 原生规范化
- 双轨实时电平和可视化
- 每轨 PCM 文件及 WAV 文件
- FileProvider 系统分享
- Native OkHttp 实时 40ms WebSocket 推流
- 慢网有界队列和 dropped 统计
- 停止后完整 PCM backfill 与 SHA-256 校验

## 后端

后端目录：`agent_app/workspace/be/poc-audio-capture`

```powershell
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8010
```

模拟器默认连接：

```text
ws://10.0.2.2:8010/api/ws/audio/stream
```

Release 只允许 `wss://`。

协议见 `docs/AUDIO_PROTOCOL_V1.md`。

## 验证

```powershell
npm run typecheck
npm run lint
npm test -- --runInBand
npm run verify:config

cd android
.\gradlew.bat testDebugUnitTest
.\gradlew.bat lintDebug
.\gradlew.bat assembleDebug
.\gradlew.bat assembleRelease
.\gradlew.bat bundleRelease
```

## 采集文件

采集完成后文件保存在设备 `/data/data/com.poc.audiocapture/files/captures/{sessionId}/`，每条轨道一个 `.pcm` + 一个 `.wav`。

**拉取到项目目录**（方便 Agent 读取）：

```powershell
powershell -File scripts/pull-captures.ps1
```

文件会同步到 `captures/` 目录（已加入 .gitignore）。

**其他方式**：App 内点「分享 WAV / 分享 PCM」按钮通过系统分享发送，或手动 `adb pull`。

## Android 平台限制

- SYSTEM/BOTH 仅 API 29+ 可用。
- 被采集应用可以通过 Android capture policy 禁止系统音频回采。
- DRM、通话、语音通信和受保护媒体可能返回静音，这是系统限制，不是 App 必然故障。
- MediaProjection 以一次会话授权使用；Android 14/15 每次新会话都会重新请求。
- 系统音频最终效果必须以真机验证，模拟器只适合 UI、MIC 和基础网络测试。
