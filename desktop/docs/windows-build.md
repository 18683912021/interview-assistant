# Windows 安装包构建

使用仓库中的 [Windows 构建工作流](../../.github/workflows/desktop-windows.yml)，在 GitHub 的 `windows-2022` x64 环境编译 WASAPI 并生成 NSIS 安装包。Mac 本地构建流程保持独立，不上传或复用 Mac 的 `node_modules`、`dist-*` 或原生产物。请以对应提交的 Actions 运行结果判断构建是否通过；本地检查不能替代 Windows 编译和设备验收。

## 首次启用与执行

1. 将经维护者确认的桌面代码和工作流推送到 **`main`**。仓库是公开的，推送会公开这些代码并启动构建；仅 `main` 上涉及 `desktop/**` 或本工作流的推送会触发。
2. 打开仓库 **Actions → Build Windows desktop installer** 查看运行。失败后可用 **Re-run jobs** 重试；修复构建问题并推送 `main` 也会再运行。工作流进入默认分支后，还可用 **Run workflow** 手动执行，或运行 `gh workflow run desktop-windows.yml --ref main`。[GitHub 手动运行要求](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)
3. 所有检查通过后，在该次运行的 **Artifacts** 下载 `interview-assistant-windows-x64-…`，其中包含安装程序、`SHA256SUMS.txt` 和 `build-metadata.json`。产物保留 3 天。

仅需仓库写入者触发运行，不需要应用密钥、SMTP 配置、后端 `.env` 或签名私钥。工作流权限为 `contents: read`，不会推送代码、创建 Release 或部署服务器；Actions 固定到经官方仓库核对的 commit SHA。

## 构建与校验

固定 Node.js **22.23.1**、pnpm **9.15.0**，使用 Python **3.12**；Windows runner 自带 Visual Studio 与 Windows SDK。桌面及原生目录均用 `--frozen-lockfile` 安装依赖，依次运行类型检查、测试、Lint、Vite、Electron TypeScript、WASAPI 编译和 NSIS 打包。生产地址仅在 renderer 构建时注入：

```text
VITE_API_BASE=https://interview.iyouzi.cc
VITE_STREAM_URL=wss://interview.iyouzi.cc/api/ws/audio/stream
VITE_STREAM_DIRECT_IP=47.108.205.102
```

`ensure-native.cjs --platform=win32 --arch=x64` 校验 Electron 版本、PE 架构、源码与二进制哈希，并在当前 Electron 下执行默认的**仅加载验证**，不打开设备、不播放或上传声音。打包后的 `.node` 再与验证过的二进制比对 SHA-256；任何失败均不上传安装包。元数据记录代码提交、版本、地址、检查与原生哈希，并明确 `hardwareAudioValidated: false`。

Windows 开发机也可在 `desktop` 执行同样步骤：

```powershell
pnpm install --frozen-lockfile
pnpm --dir electron/audio/native install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm lint --quiet
$env:VITE_API_BASE = 'https://interview.iyouzi.cc'
$env:VITE_STREAM_URL = 'wss://interview.iyouzi.cc/api/ws/audio/stream'
$env:VITE_STREAM_DIRECT_IP = '47.108.205.102'
pnpm exec vite build
pnpm exec tsc -p electron/tsconfig.json --noEmitOnError
node scripts/ensure-native.cjs --platform=win32 --arch=x64
pnpm exec electron-builder --win nsis --x64 --publish never
```

当前包未签名，Windows 可能显示未知发布者提示。安装、设备切换、麦克风与系统声音、外放消回声仍需 Windows 实机验收；CI 加载成功不代表这些项目通过。校验下载文件可运行 `Get-FileHash '<安装包.exe>' -Algorithm SHA256`，与 `SHA256SUMS.txt` 对照。

依据：[Builder 跨平台原生限制](https://www.electron.build/v26/docs/features/multi-platform-build/)、[Windows runner 工具清单](https://github.com/actions/runner-images/blob/main/images/windows/Windows2022-Readme.md)、[GitHub Actions 计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions)。公开仓库的标准 runner 运行分钟免费；产物存储受账户额度约束，本工作流不启用依赖缓存，并将产物保留期设为 3 天。
