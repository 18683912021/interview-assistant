# 桌面工作区运行说明

开发默认连接 `127.0.0.1:8010`。先启动 FastAPI、PostgreSQL 和 Redis，再在 desktop 运行 `pnpm dev`。

- `VITE_API_BASE`：HTTP API 的完整源地址，例如 `https://interview.example.com`，不含 `/api`。开发未设置时使用 Vite 同源代理。
- `VITE_STREAM_URL`：完整实时地址，例如 `wss://interview.example.com/api/ws/audio/stream`。Electron 主进程直连该地址。
- `VITE_STREAM_DIRECT_IP`：可选，填写同一实时服务的部署 IP。只改变实时连接的 DNS lookup，保留域名、Host、TLS SNI 和证书校验；250 ms 后并行尝试正常 DNS，选中一个连接后才发送会话和音频。开发环境不设置，服务器迁移后更新此项或留空。它不修改系统代理/DNS，也不控制 HTTP API 路由。
- `VITE_API_HOST`：兼容旧配置，仅填写主机名，默认 `127.0.0.1`。

打包前应在构建环境设置生产 API 和 WebSocket 地址。非本机部署必须使用 HTTPS / WSS；Electron 会拒绝明文公网 WebSocket。省略地址会连接本机服务，不会自动连接任何在线生产账户。

登录、注册和重设密码依赖后端 SMTP 配置。资料解析依赖后端对应文件解析库。工具与复盘依赖服务端模型配置；未配置时显示服务端错误，不展示演示答案。

macOS 默认使用 Electron 的系统音频回环，需要系统的屏幕与系统音频录制权限；应用会明确确认电脑播放声音的采集范围，视频轨道取得后立即关闭，画面不会保存或上传。Electron 43 使用官方的 ScreenCaptureKit 兼容路径，避免系统选择器仅返回画面的问题。也可以在设置中手动选择已配置声音路由的虚拟输入。Windows 使用 WASAPI 回环，可在设置中选择默认输出或具体扬声器/耳机；请选择会议软件实际播放声音的输出。麦克风测试只在本机读取输入，离开设置页时释放设备。设备、系统权限和实际音频路由仍需在对应操作系统上验证。

麦克风与系统音频使用不同的处理配置：麦克风优先请求 `echoCancellation: {exact: 'all'}`，消除外部会议软件等系统播放声音的回声，并启用降噪、关闭自动增益；系统音频保留原声。仅在设备明确不支持该回声模式时回退为常规 AEC，并在面试状态栏及输入测试结果中显示实际模式和耳机建议。权限、设备占用等错误不会被回退掩盖。设置中的测试与正式面试共用采集实现；选中同一个输入（包括可解析的默认设备别名）会在开始前报错，不用文本去重或静音整条麦克风轨道来删除重复内容。

Electron 43.4.0 对应 Chromium 150，支持标准 `all` 模式，无需额外开关。macOS 的全系统回声消除可能另外请求「系统音频录制」权限；开发启动时授权对象可能是负责启动应用的终端。已允许屏幕录制不代表这项权限已允许。全系统 AEC 的模式协商成功与实际声学效果应分别验证；不同音量、扬声器位置和双人同时说话仍需实机验收。Chromium 默认给此模式的麦克风增加约 170ms 的参考对齐延迟，独立的系统音频转写轨道不经此处理。来源：[Chromium 150 AEC 模式选择](https://chromium.googlesource.com/chromium/src/+/refs/tags/150.0.7871.224/third_party/blink/renderer/platform/mediastream/media_stream_audio_processor_options.cc)、[平台与延迟定义](https://chromium.googlesource.com/chromium/src/+/refs/tags/150.0.7871.224/media/base/media_switches.cc)、[W3C 回声消除定义](https://www.w3.org/TR/mediacapture-streams/#dom-echocancellationmodeenum)。

面试期间切换导航与退出账号受到保护；停止采集后仍需等待记录同步成功。音频设备 ID 仅保存在本机，并按平台区分，避免将 Mac 的输入 ID 用作 Windows 输出 ID。旧 Mac 本机选择会继续读取。回答、主题等账户偏好仍通过设置保存接口同步。

桌面打包后页面使用 `file://`，API 请求的 Origin 为 `null`。后端默认允许该 Origin 及本机 5173 开发地址，使用 Bearer token 鉴权，不启用跨域 Cookie。部署独立 Web 前端时，通过后端 `CORS_ORIGINS` 追加准确的站点源地址（逗号分隔）；桌面客户端仍需保留 `null`。

实时回答显式关闭深度思考并按内容流式显示。首字耗时显示实际收到正文的时间，不包含状态提示。界面不承诺固定延迟；真实延迟需要使用目标网络、语音服务和模型进行实测。

接口升级注意：新版 WS 要求 Authorization Bearer 和已保存的 Workspace 会话；保存快照需 `expected_revision`（新建为 0）。发送注册/重设密码验证码时须分别传 `purpose=register/reset_password`。旧移动端尚未适配这些新契约，本次不应单独把新后端替换到仍使用旧协议的线上环境。

已移除文档转换路由和桌面 LibreOffice 下载/转换能力，保留 PDF、DOCX、TXT 简历解析。旧历史会在数据库首次升级时复制到新版工作区，原表保留；旧系统仅保存的生成后自我介绍不能当作原始简历，需重新上传。

Windows 兼容补充（2026-10-10）：默认输出切换、设备拔出或采集失败会停止音频并暂停面试，用户确认设备后继续；显式选定的输出不会跟随系统默认输出改变。暂停后的设备弹窗会在插拔设备或返回窗口时刷新，不可用的原设备会明确标出。系统采集保留静音包时长，按实际位深解码，并连续转换到 16 kHz 单声道，避免分包重采样损失时长及多声道中央声道遗漏。未播放任何声音时 WASAPI 可能完全没有数据包，这种场景的断句和服务端空闲行为仍需 Windows 实机验收。

当前 Windows 安装目标是 x64。在 Windows x64 环境安装 Node.js、pnpm、Python 及 Visual Studio C++/Windows SDK 构建工具后，执行 `pnpm install`、`pnpm ensure:native`、`pnpm build`。原生模块按锁定的 Electron 版本与目标架构编译，默认加载验证不会打开声音设备。`beforePack` 会校验目标、源码及二进制；缺少匹配产物时会阻止打包，不能将 Mac 上运行通过等同于 Windows 构建成功。显式硬件检查 `pnpm exec electron scripts/smoke-addon.cjs --hardware` 会播放测试音并采集系统声音，执行前需清除 `ELECTRON_RUN_AS_NODE`，只应在准备好的测试环境执行。

Windows 主窗口使用 Electron `loadFile` 处理安装路径中的盘符、空格和中文；Windows 悬浮窗使用不透明无边框窗口以保留缩放能力，Mac 继续使用原透明窗口。安装器不再包含 LibreOffice 清理脚本，卸载不删除用户偏好或系统里独立安装的软件。

参考：[Microsoft WASAPI 设备路由](https://learn.microsoft.com/en-us/windows/win32/coreaudio/stream-routing-implementation-considerations)、[静音包与 GetBuffer](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudiocaptureclient-getbuffer)、[Electron 原生模块](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)、[透明窗口限制](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles)。本轮验证结果及未覆盖项见 [兼容验证记录](windows-compatibility-results-2026-10-10.json)。

协议核对来源：[DeepSeek 对话补全](https://api-docs.deepseek.com/api/create-chat-completion/)、[火山引擎流式语音识别](https://docs.volcengine.com/docs/DoubaoVoice/bidirectional-streaming-automatic-speech-recognition-websocket?lang=zh)。识别中的句子使用稳定 ID 和递增 revision 更新同一气泡，只有供应商确认的句段才标为完成；回答以 request_id 独立归档。

第二轮补充：气泡下的「修正 / 拆句」支持按用户输入的换行拆成多句，不按英文句点自动截断。原问题与原回答保留其生成时的版本；修正后可重新提问。重复点击同版本、已有回答的气泡只打开该回答，不再发起模型请求。历史详情支持关键词搜索、筛选有回答的原句与定位来源，未确认尾句在历史和文本导出中仍带标记。

本机尚未同步的副本会显示在历史列表。恢复后先重试原版本，再发送后续编辑，避免把丢失响应当作保存失败重复覆盖。损坏的单份副本保留原文件，其他完好副本仍可读取。账号退出会清理工具的内存草稿；切换页面或工具不会丢失本次登录期间的草稿。

后端新增 `004_deleted_workspace_interviews` 迁移与删除记录，用于拒绝迟到的保存请求，不能通过删除该表来清理历史。删除进行中的会话会通知当前进程停止采集；其他工作进程通过低频权限检查停止。若记录已删除但录音文件清理失败，接口返回明确的待清理错误，可重复删除重试清理。复盘按会话版本缓存，重复生成请求不会并行消耗模型调用。
