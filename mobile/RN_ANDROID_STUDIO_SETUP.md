# React Native CLI Android Studio 稳定开发环境

> 适用项目：React Native `0.78.3` + React `19.0.0` 的 Android RN CLI 工程  
> 适用系统：Windows 10/11 64 位  
> 目标：能够通过 Android Studio 和 Gradle 稳定完成同步、编译、安装、调试、Debug APK 打包及日常开发  
> 基线日期：2026-07-20

---

## 1. 结论

下面这套组合可以支持 React Native `0.78.3` 在 Android Studio 中完成正常开发、Gradle 构建、模拟器/真机调试和 APK/AAB 打包：

| 组件 | 固定版本或要求 |
|---|---|
| Node.js | `22.23.1 LTS` |
| npm | 使用 Node 22 自带版本，不单独升级 |
| React | `19.0.0` |
| React Native | `0.78.3` |
| React Native Community CLI | `15.0.1` |
| JDK | `17`，建议 Microsoft OpenJDK 17 或 Eclipse Temurin 17 |
| Android Studio | `Quail 2 Stable 2026.1.2` |
| Android Gradle Plugin | `8.8.0`，由 RN 0.78.3 工具链管理 |
| Gradle Wrapper | `8.12` |
| Kotlin | `2.0.21` |
| Android SDK Platform | Android 15 / API 35 |
| Android SDK Build-Tools | `35.0.0` |
| Android NDK | `27.1.12297006` |
| CMake | `3.22.1` |
| Hermes | 开启 |
| New Architecture | 第一阶段关闭，稳定后再单独验证开启 |
| 模拟器 | Android 15 / API 35 / Google APIs / x86_64 |

兼容性依据：

1. RN 0.78 要求 Node 18.18 或更高版本，并推荐 JDK 17、Android SDK Platform 35 和 Build-Tools 35.0.0。
2. RN 0.78.3 的官方模板使用 AGP 8.8.0、Gradle 8.12、Kotlin 2.0.21 和 NDK 27.1.12297006。
3. Android Studio Quail 2 支持 AGP 7.1～9.3，因此可以打开和构建 AGP 8.8.0 工程。
4. Node 21 是已经停止维护的非 LTS 版本；Node 22 仍处于 LTS 支持周期，适合作为固定开发基线。

这套环境的关键不是“全部使用最新版”，而是让 Node、JDK、AGP、Gradle、SDK、NDK 和 RN 模板保持兼容并锁定版本。

---

## 2. 适用范围与限制

本文档针对已有 RN `0.78.3` 项目，目标是先建立一个可重复、可调试、可打包的稳定基线。

需要注意：

- RN `0.78.x` 在 2026 年已经停止官方维护，但仍可以在固定工具链下继续构建和开发。
- 为了降低排障变量，不应在建立基线时同步升级 RN、AGP、Gradle、Kotlin 和第三方原生依赖。
- Android Studio 可以使用较新的稳定版，但项目内的 AGP、Gradle 和 JDK 必须按本文档锁定。
- 本文档优先保证 Android Debug 开发流程；生产 Release 包还需要单独配置正式签名、版本号和发布参数。

---

## 3. 当前项目需要对齐的关键配置

### 3.1 Node.js

不要继续使用 Node `21.0.0`，固定为：

```text
Node.js 22.23.1 LTS
```

建议在项目根目录增加 `.nvmrc`：

```text
22.23.1
```

在 `package.json` 中增加或收紧 Node 版本：

```json
{
  "engines": {
    "node": ">=22 <23"
  }
}
```

不要全局安装 `react-native-cli`。所有 RN 命令都通过项目本地 CLI 执行：

```powershell
npx react-native doctor
npx react-native start
npx react-native run-android
```

### 3.2 Android NDK

RN `0.78.3` 应使用：

```gradle
ndkVersion = "27.1.12297006"
```

不要使用 NDK 30 作为该项目的构建版本。NDK 可以并存，无需卸载其他版本，只要 SDK Manager 安装 `27.1.12297006` 并在项目中明确指定即可。

### 3.3 Gradle Wrapper

`android/gradle/wrapper/gradle-wrapper.properties` 使用：

```properties
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://services.gradle.org/distributions/gradle-8.12-all.zip
networkTimeout=120000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
```

注意：

- 不需要安装全局 Gradle。
- Android Studio 和命令行都应使用项目自带的 `gradlew.bat`。
- 不要接受 Android Studio 提出的 AGP/Gradle 自动升级建议。

### 3.4 Android 构建参数

`android/build.gradle` 的核心版本应为：

```gradle
buildscript {
    ext {
        buildToolsVersion = "35.0.0"
        minSdkVersion = 24
        compileSdkVersion = 35
        targetSdkVersion = 35
        ndkVersion = "27.1.12297006"
        kotlinVersion = "2.0.21"
    }
}
```

系统内部音频采集使用 Android `AudioPlaybackCapture`，运行时需要 Android 10 / API 29 或更高版本。项目可以保留 `minSdkVersion = 24`，但内部音频采集功能必须在代码中继续进行 API 29 能力判断。

### 3.5 架构和 Hermes

建立稳定基线时，`android/gradle.properties` 使用：

```properties
android.useAndroidX=true
newArchEnabled=false
hermesEnabled=true
```

先关闭 New Architecture 的原因：

- 自定义音频模块使用传统 `ReactContextBaseJavaModule`，不依赖 TurboModule。
- 可以减少 Fabric、Codegen、CMake 和新架构兼容层带来的变量。
- Hermes 可以正常保留，它是 RN Android 的推荐 JavaScript 引擎。

当 Debug、Release 和原生模块都验证通过后，再单独将 `newArchEnabled` 改为 `true` 进行验证，不要和其他升级同时进行。

### 3.6 第三方原生依赖

RN `0.78.3` 建议至少固定以下版本：

```json
{
  "dependencies": {
    "react": "19.0.0",
    "react-native": "0.78.3",
    "react-native-gesture-handler": "2.27.2",
    "react-native-reanimated": "3.18.0",
    "react-native-safe-area-context": "5.8.0"
  },
  "devDependencies": {
    "@react-native-community/cli": "15.0.1",
    "@react-native-community/cli-platform-android": "15.0.1",
    "@react-native-community/cli-platform-ios": "15.0.1",
    "@react-native/babel-preset": "0.78.3",
    "@react-native/metro-config": "0.78.3"
  }
}
```

原因：

- Gesture Handler `2.28+` 要求 RN `0.79+`，因此 RN 0.78 应固定到 `2.27.2`。
- Reanimated `3.18.x` 支持 RN 0.78 的旧架构和新架构。
- 原生依赖尽量使用精确版本，不使用 `^` 或 `~` 自动漂移。
- 不要单独升级 Metro；Metro 版本应跟随 React Native。

如果使用 React Navigation Stack，入口文件第一行建议保留：

```javascript
import 'react-native-gesture-handler';
```

Reanimated 的 Babel 插件必须位于插件列表最后：

```javascript
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: ['react-native-reanimated/plugin'],
};
```

---

## 4. Windows 基础环境安装

### 4.1 项目路径

项目应放在短路径、纯英文目录中，例如：

```text
F:\RN\audio-capture
```

避免：

- 中文目录名
- 空格
- 过深目录
- OneDrive 同步目录
- 网络磁盘

启用 Git 长路径支持：

```powershell
git config --global core.longpaths true
```

即使启用了 Windows 长路径，也应保持项目路径简短，因为部分 CMake、Ninja 和 NDK 工具仍可能受到路径长度影响。

### 4.2 安装 Node 22

推荐使用 nvm-windows 管理 Node：

```powershell
nvm install 22.23.1
nvm use 22.23.1

node -v
npm -v
where.exe node
```

预期：

```text
v22.23.1
```

如果 `where.exe node` 返回多个 Node 安装目录，应清理旧 Node 21 安装或 PATH 冲突。

移除可能存在的全局旧 CLI：

```powershell
npm uninstall -g react-native-cli @react-native-community/cli
```

### 4.3 安装 JDK 17

推荐选择一种：

- Microsoft Build of OpenJDK 17
- Eclipse Temurin JDK 17

使用 winget 安装 Microsoft OpenJDK 17：

```powershell
winget install Microsoft.OpenJDK.17
```

安装完成后重新打开终端：

```powershell
java -version
where.exe java
```

必须显示 Java 17：

```text
openjdk version "17.x.x"
```

设置用户环境变量：

```text
JAVA_HOME=<JDK 17 安装目录>
Path 增加 %JAVA_HOME%\bin
```

不要让 Gradle 使用 JDK 21、23 或其他更高版本。

---

## 5. Android Studio 安装与配置

### 5.1 安装 Android Studio

安装：

```text
Android Studio Quail 2 Stable 2026.1.2
```

Android Studio 本身使用自带的 Embedded JBR 即可，不需要修改 IDE 启动运行时。

项目 Gradle JDK 单独配置为 JDK 17：

```text
File
→ Settings
→ Build, Execution, Deployment
→ Build Tools
→ Gradle
→ Gradle JDK
→ 选择安装的 JDK 17
```

同时确认：

```text
Gradle distribution：使用项目 Gradle Wrapper
Gradle Offline Mode：关闭
```

### 5.2 安装 Android SDK

打开：

```text
File
→ Settings
→ Languages & Frameworks
→ Android SDK
```

在 `SDK Platforms` 安装：

```text
Android 15.0
Android SDK Platform 35
```

在 `SDK Tools` 勾选 `Show Package Details`，安装：

```text
Android SDK Build-Tools 35.0.0
Android SDK Platform-Tools 最新稳定版
Android SDK Command-line Tools (latest)
Android Emulator
NDK (Side by side) 27.1.12297006
CMake 3.22.1
Google USB Driver（使用支持的 Android 真机时可选）
```

也可以在 PowerShell 中执行：

```powershell
$sdkManager = "$env:LOCALAPPDATA\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat"

& $sdkManager `
  "platforms;android-35" `
  "build-tools;35.0.0" `
  "platform-tools" `
  "cmdline-tools;latest" `
  "ndk;27.1.12297006" `
  "cmake;3.22.1" `
  "emulator"

& $sdkManager --licenses
```

### 5.3 Android 环境变量

设置用户环境变量：

```text
ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
```

将以下目录加入用户 `Path`：

```text
%ANDROID_HOME%\platform-tools
%ANDROID_HOME%\emulator
%ANDROID_HOME%\cmdline-tools\latest\bin
```

如果系统中已有 `ANDROID_SDK_ROOT`，应确保它与 `ANDROID_HOME` 指向同一个 SDK 目录，避免 Gradle 检测到两个不同路径。

重新打开 PowerShell 后检查：

```powershell
adb --version
sdkmanager.bat --version
```

Android Studio 通常会生成 `android/local.properties`。如果命令行提示找不到 SDK，可确认文件内容类似：

```properties
sdk.dir=C\:\\Users\\Administrator\\AppData\\Local\\Android\\Sdk
```

`local.properties` 是本机配置，不应提交到 Git。

---

## 6. 代理和依赖下载

不要在项目的 `android/gradle.properties` 中永久写死 Clash 代理端口，否则 Clash 未启动或端口变化时，Gradle 会完全无法联网。

如确实需要代理，将配置放在用户级文件：

```text
C:\Users\Administrator\.gradle\gradle.properties
```

示例：

```properties
systemProp.http.proxyHost=127.0.0.1
systemProp.http.proxyPort=<Clash 当前 mixed-port>
systemProp.https.proxyHost=127.0.0.1
systemProp.https.proxyPort=<Clash 当前 mixed-port>
```

也可以在 Android Studio 中设置：

```text
File
→ Settings
→ Appearance & Behavior
→ System Settings
→ HTTP Proxy
```

排障原则：

1. 使用代理时，确认 Clash 正在运行且端口一致。
2. 不使用代理时，删除用户级代理配置并重启 Gradle Daemon。
3. 不建议为了临时网络问题随意替换 Google Maven、Maven Central 或 Gradle 官方仓库。

---

## 7. 首次依赖安装与清理

### 7.1 修正原生依赖版本

在项目根目录执行：

```powershell
npm install --save-exact `
  react-native-gesture-handler@2.27.2 `
  react-native-reanimated@3.18.0 `
  react-native-safe-area-context@5.8.0
```

该命令会同步更新 `package.json` 和 `package-lock.json`。

以后安装依赖统一使用：

```powershell
npm ci
```

不要：

- 删除 `package-lock.json` 后随意重新解析依赖
- npm、Yarn、pnpm 混用
- 手动安装不同版本的 Metro
- 使用 `npm update` 批量更新原生依赖

### 7.2 切换 Node、NDK 或原生依赖后的清理

在项目根目录执行：

```powershell
Push-Location android
.\gradlew.bat --stop
Pop-Location

Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force android\.gradle -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force android\.cxx -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force android\app\.cxx -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force android\build -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force android\app\build -ErrorAction SilentlyContinue

npm cache verify
npm ci
```

不要把删除整个 `%USERPROFILE%\.gradle\caches` 作为常规步骤。只有明确发现用户级 Gradle 缓存损坏时，才进行该操作。

---

## 8. 构建前检查

### 8.1 工具版本检查

项目根目录执行：

```powershell
node -v
npm -v
java -version
adb --version
npx react-native doctor
```

预期核心结果：

```text
Node.js：v22.23.1
Java：17.x
Android SDK：可识别
Android Studio：可识别
ANDROID_HOME：可识别
```

### 8.2 Gradle 检查

```powershell
Push-Location android
.\gradlew.bat -version
Pop-Location
```

必须确认：

```text
Gradle 8.12
JVM 17.x
```

如果 Gradle 显示的 JVM 不是 17，应检查：

- Android Studio 的 Gradle JDK
- `JAVA_HOME`
- 系统 `Path`
- `%USERPROFILE%\.gradle\gradle.properties` 是否配置了 `org.gradle.java.home`

---

## 9. 第一次构建验收

先使用命令行验证 Gradle，不要一开始只依赖 Android Studio 的 Run 按钮。

```powershell
Push-Location android

.\gradlew.bat clean
.\gradlew.bat assembleDebug --stacktrace

Pop-Location
```

成功后应生成：

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

这一步成功说明以下链路已经打通：

- JDK 17
- Gradle 8.12
- AGP 8.8.0
- Kotlin 2.0.21
- Android SDK 35
- Build-Tools 35.0.0
- NDK 27.1.12297006
- React Native Android 原生依赖
- 自定义 Kotlin/Java 原生模块

如果 `assembleDebug` 没有通过，不应继续处理 Metro 或 UI 问题；先解决 Gradle 构建错误。

---

## 10. Android Studio 打开与运行

### 10.1 打开工程

使用 Android Studio 打开：

```text
<项目根目录>\android
```

等待以下步骤完成：

1. Gradle Wrapper 下载完成。
2. Gradle Sync 完成。
3. Android SDK 和 NDK 检测完成。
4. `app` Run Configuration 自动出现。

如果 Android Studio提示升级以下内容，先忽略：

- Android Gradle Plugin
- Gradle
- Kotlin
- compileSdk / targetSdk
- Gradle DSL

### 10.2 创建模拟器

在 Device Manager 创建：

```text
设备：Pixel 系列
系统镜像：Android 15 / API 35
镜像类型：Google APIs
ABI：x86_64
```

启动模拟器并检查：

```powershell
adb devices
```

应看到一个状态为 `device` 的设备，不应为 `offline` 或 `unauthorized`。

### 10.3 启动 Metro

在项目根目录单独打开一个 PowerShell：

```powershell
npx react-native start --reset-cache
```

第一次或修改 Babel/Metro 配置后使用 `--reset-cache`。日常开发可以使用：

```powershell
npm start
```

Metro 必须保持运行。

### 10.4 Android Studio Run/Debug

在 Android Studio 中：

1. 选择 `app` Run Configuration。
2. 选择 API 35 模拟器或已授权真机。
3. 点击 Run 安装并启动应用。
4. 点击 Debug 可调试 Kotlin/Java 原生代码。
5. 使用 Logcat 查看原生日志和崩溃堆栈。

使用真机时执行：

```powershell
adb reverse tcp:8081 tcp:8081
```

否则真机可能无法连接本机 Metro。

也可以通过命令行安装并启动：

```powershell
npx react-native run-android
```

Android Studio Run 和 `run-android` 二选一即可，不要同时重复安装应用。

---

## 11. JavaScript 与原生调试

### 11.1 JavaScript / TypeScript

推荐使用 React Native DevTools：

- Metro 终端按 `j` 打开调试器；或
- 打开应用 Developer Menu，选择 `Open Debugger`。

日常 JS/TS 开发验证：

1. 修改组件代码。
2. 确认 Fast Refresh 生效。
3. 查看 Metro 错误信息。
4. 在 React Native DevTools 中检查 Console、Network 和组件状态。

不要使用旧版“Remote JS Debugging”流程作为 RN 0.78 的主要调试方式。

### 11.2 Kotlin / Java 原生代码

在 Android Studio 中：

1. 使用 Debug 启动应用。
2. 在 Kotlin/Java 原生模块中设置断点。
3. 触发 JS 对 NativeModule 的调用。
4. 在 Debugger 中检查线程、参数和异常。
5. 使用 Logcat 过滤应用包名。

### 11.3 音频采集功能验证

内部音频采集至少需要 Android 10 / API 29，推荐直接使用 API 35 真机验证，因为模拟器对系统音频路由和 MediaProjection 的行为可能与真机不同。

验证项目：

- 麦克风权限能够弹出并授权。
- MediaProjection 授权界面能够正常出现。
- 麦克风采集可以启动和停止。
- 系统音频采集在支持的应用和设备上可以启动。
- PCM 文件能够生成并返回正确路径。
- 应用退到后台、取消授权或停止投屏时不会崩溃。

---

## 12. Android Studio 打包

### 12.1 Debug APK

命令行：

```powershell
Push-Location android
.\gradlew.bat assembleDebug
Pop-Location
```

产物：

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

Android Studio：

```text
Build
→ Build Bundle(s) / APK(s)
→ Build APK(s)
```

Debug APK 用于开发和内部测试，不用于应用商店发布。

### 12.2 Release APK / AAB

正式发布前必须创建正式 keystore，不允许继续使用 Debug keystore 作为 Release 签名。

Android Studio：

```text
Build
→ Generate Signed Bundle / APK
→ Android App Bundle 或 APK
→ 选择正式 keystore
→ release
```

命令行常用任务：

```powershell
Push-Location android
.\gradlew.bat assembleRelease
.\gradlew.bat bundleRelease
Pop-Location
```

常见产物：

```text
android\app\build\outputs\apk\release\app-release.apk
android\app\build\outputs\bundle\release\app-release.aab
```

生产发布还需要检查：

- 正式签名配置
- `versionCode`
- `versionName`
- ProGuard/R8 配置
- 权限说明
- Android 目标 API 政策
- Release 环境变量与服务地址

---

## 13. 日常开发固定流程

环境首次配置完成后，日常开发不需要反复清理缓存。

### 终端 A：Metro

```powershell
npm start
```

### Android Studio

1. 启动 API 35 模拟器或连接真机。
2. 确认 `adb devices` 正常。
3. 真机执行 `adb reverse tcp:8081 tcp:8081`。
4. 点击 Android Studio Run 或 Debug。
5. 使用 Fast Refresh 进行 JS/TS 开发。
6. 使用 Android Studio Debugger 和 Logcat 调试原生模块。

只有在以下情况才进行完整清理：

- 切换 Node 大版本
- 修改 JDK
- 修改 AGP/Gradle
- 修改 NDK/CMake
- 安装或移除原生依赖
- 修改 New Architecture 开关
- 出现明确的 Gradle/CMake 缓存异常

---

## 14. 常见问题定位

### 14.1 `Unsupported class file major version`

原因：Gradle 使用了错误的 Java 版本。

检查：

```powershell
java -version
Push-Location android
.\gradlew.bat -version
Pop-Location
```

确保 Gradle JVM 为 Java 17。

### 14.2 `SDK location not found`

检查：

- `ANDROID_HOME`
- Android Studio SDK Location
- `android/local.properties`

### 14.3 `NDK not installed` 或 CMake/Ninja 错误

确认 SDK Manager 安装：

```text
NDK 27.1.12297006
CMake 3.22.1
```

然后删除项目级 `.cxx` 和构建目录，再重新构建。

### 14.4 Gradle 或 Maven 下载失败

检查：

- Clash 是否启动
- mixed-port 是否和用户 Gradle 配置一致
- Android Studio HTTP Proxy
- `gradle-wrapper.properties` 的 `networkTimeout`
- 是否误开 Gradle Offline Mode

### 14.5 App 无法连接 Metro

执行：

```powershell
adb devices
adb reverse tcp:8081 tcp:8081
```

确认 Metro 正在项目根目录运行，并检查 8081 端口是否被其他进程占用。

### 14.6 Gesture Handler 构建或运行异常

确认：

```text
React Native 0.78.3
react-native-gesture-handler 2.27.2
```

入口文件第一行导入 Gesture Handler，并在更新后重置 Metro 缓存。

### 14.7 Reanimated 报错

确认：

- Reanimated 为 `3.18.0`
- Babel 插件存在且位于最后
- 没有同时安装不兼容的独立 `react-native-worklets`
- 修改 Babel 后执行 `npx react-native start --reset-cache`

### 14.8 Android Studio 提示升级 AGP

选择忽略。RN 0.78.3 当前基线使用 AGP 8.8.0，不要为了消除 IDE 提示直接升级项目构建工具链。

---

## 15. 验收清单

完成配置后，必须逐项通过：

### 环境

- [ ] `node -v` 输出 `v22.23.1`
- [ ] `java -version` 输出 Java 17
- [ ] `adb --version` 正常
- [ ] `npx react-native doctor` 核心项目通过
- [ ] `gradlew.bat -version` 显示 Gradle 8.12、JVM 17

### 构建

- [ ] Android Studio Gradle Sync 成功
- [ ] `gradlew.bat clean` 成功
- [ ] `gradlew.bat assembleDebug` 成功
- [ ] 生成 `app-debug.apk`
- [ ] Android Studio Build APK 成功

### 调试

- [ ] API 35 模拟器或真机状态为 `device`
- [ ] Android Studio Run 可以安装并启动应用
- [ ] Android Studio Debug 可以命中 Kotlin/Java 断点
- [ ] Logcat 可以看到应用日志
- [ ] Metro 可以连接应用
- [ ] Fast Refresh 正常
- [ ] React Native DevTools 可以打开

### 功能

- [ ] 麦克风权限正常
- [ ] MediaProjection 授权正常
- [ ] 麦克风采集正常
- [ ] 系统音频采集在 API 29+ 真机正常
- [ ] PCM 文件正常生成
- [ ] 应用停止采集和退出时不崩溃

### 发布准备

- [ ] 正式 Release 使用独立正式 keystore
- [ ] Release APK 或 AAB 能够生成
- [ ] Release 包可在测试设备安装和启动

全部通过后，即可认定 Android Studio 打包、调试和日常开发链路已经跑通。

---

## 16. 禁止事项

为了维持稳定环境，不要：

1. 使用 Node 21。
2. 使用 JDK 21/23 构建该项目。
3. 将 NDK 自动升级到最新版。
4. 全局安装 React Native CLI。
5. 手动升级 Metro。
6. 接受 Android Studio 的 AGP/Gradle/Kotlin 自动升级。
7. 删除 `package-lock.json` 后随意重新安装。
8. 混用 npm、Yarn 和 pnpm。
9. 在项目中永久写死本地代理端口。
10. 同时升级 RN、Gradle、AGP、NDK 和第三方原生库。
11. 将项目放在中文、空格或过深目录中。
12. 使用 Debug keystore 发布正式版本。

---

## 17. 官方参考

- React Native 0.78 环境配置：<https://reactnative.dev/docs/0.78/set-up-your-environment>
- React Native 0.78.3 Android 模板：<https://github.com/react-native-community/template/tree/0.78.3/template/android>
- React Native 版本支持状态：<https://reactnative.dev/releases/>
- Node.js 版本生命周期：<https://nodejs.org/en/about/previous-releases>
- Android Studio 与 AGP 兼容性：<https://developer.android.com/build/releases/about-agp>
- AGP 8.8 发布说明：<https://developer.android.com/build/releases/agp-8-8-0-release-notes>
- React Native Gesture Handler 兼容范围：<https://github.com/software-mansion/react-native-gesture-handler>
- Reanimated 3.x 兼容范围：<https://docs.swmansion.com/react-native-reanimated/docs/3.x/guides/compatibility/>
