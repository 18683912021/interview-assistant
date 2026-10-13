# AI 面试助手 · Android 1.1

React Native 0.78.3 / React 19 / Kotlin，和桌面端共用 `/api/workspace` 数据与认证。
现有原生工程仅支持 Android；仓库没有 iOS 工程，不能生成 IPA。

## 产品与权限

- 手机采用五个入口：面试、资料、准备、记录、设置。
- 现场面试：手机切换对话 / 答案，宽度达到 760pt 显示 40% / 60% 双栏。查看答案不阻塞逐句转写。
- **只采集麦克风**，不使用 MediaProjection，不申请录屏、通话或系统播放音频权限。
- Android 麦克风前台服务必须从可见页面启动；通知栏可暂停，移除任务后停止服务。
- 单麦克风没有声纹分离：按当前「对方 / 我」标记，可长按修正；不要把默认标记当成声纹识别结果。
- 同一手机的电话、会议应用可能独占麦克风。适合现场场景或用另一设备外放声音；不能承诺抓取私密通话。
- 手动选句 / 合并提问；自然口述、结构化要点、标准书面；继续补例子与解释。结束面试后只能查看已有答案、生成复盘。
- 资料分简历、个人经历、准备草稿；AI 草稿不当作真实经历，编辑后明确核实才保存为事实资料。
- 四个准备工具：自我介绍、项目梳理、岗位分析、回答练习。移除旧文档转换和未接支付的订阅入口。
- 历史分页、搜索、详情、复盘、分享文字及录音清理；列表标题和筛选固定。
- 云端保存使用 revision 乐观锁，本机保留待同步快照；不会覆盖跨端冲突。登录过期或冲突时保留本机内容。

## 开发

```sh
nvm use 22.23.1
npm ci
npm run verify:config
npm start
# 另一个终端
npm run android
```

JDK 17 或 Android Studio 自带 JBR，SDK 35，NDK 27.1.12297006，Gradle 8.12。
本机 Android SDK 通过未提交的 `android/local.properties` 指定。
项目内旧有 Gradle 代理设置保留；若代理未启动，可在构建命令添加
`-Dhttp.proxyHost= -Dhttps.proxyHost=`，或在用户级 Gradle 设置配置可用代理。

```sh
npm run typecheck
npm run lint
npm test -- --runInBand
cd android
bash gradlew testDebugUnitTest lintDebug assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Release 内嵌 JS 和 Hermes，无须 Metro。正式 release 签名继续通过外部变量提供：
`AUDIO_CAPTURE_UPLOAD_STORE_FILE` / `AUDIO_CAPTURE_UPLOAD_STORE_PASSWORD` /
`AUDIO_CAPTURE_UPLOAD_KEY_ALIAS` / `AUDIO_CAPTURE_UPLOAD_KEY_PASSWORD`。
不要把密钥提交到仓库；使用测试签名的 APK 会单独注明，仅作安装联调。

## 技术约定

- 语音 WebSocket 通过 `Authorization: Bearer` 认证；先保存所属账号面试，再用同一 UUID 启动 `audio.capture.v1` 会话。
- 40ms / 16kHz / 单声道 PCM16LE。每次恢复建立新连接；保留 utterance_id / revision，更新同一句而不是重复插入。
- 等服务端 `session_stopped` 确认（有界超时）再断开，保存末句；中断的句子标记待确认。
- React Native 0.78 使用原生 XHR 增量事件读取 NDJSON，不依赖浏览器 ReadableStream。分包拼接、终止事件、取消及部分输出均显式处理。
- 后端已记录实时音频，移动端不再重复 backfill；停止后删除本段本机 PCM/WAV 临时文件。
- 本轮仅修改 mobile，桌面端和服务端协议保持不变。

## 验证边界

自动化覆盖断句修订、恢复后句子编号、用户编辑、流式传输边界、面试结束只读、同步失败保留、认证页面。
模拟器不能替代真机：需用 Android 真机检查蓝牙耳机、来电抢占、锁屏、厂商省电策略和长时间录音。

参考：[RN Networking](https://reactnative.dev/docs/network)、[Android 麦克风前台服务限制](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start)。
