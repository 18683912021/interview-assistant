# 桌面工作区开发与联调

产品说明、完整操作步骤、截图及打包配置见 [桌面端 README](../README.md)。本文保留开发时需要核对的接口和生命周期约定，避免把旧版本行为当作现状。

## 运行与配置

先启动后端，再在 `desktop` 执行 `pnpm install --frozen-lockfile` 和 `pnpm dev`。开发默认 `127.0.0.1:8010`，线上包须显式设置 `VITE_API_BASE`、`VITE_STREAM_URL`。可选 `VITE_STREAM_DIRECT_IP` 只改变实时连接的地址解析，保留域名、Host、TLS SNI 和证书校验；250ms 后并行尝试正常 DNS，选中连接后才发送会话和音频。

登录、注册和密码重设依赖后端 SMTP；资料解析、工具、复盘与回答依赖后端服务。前端不持有供应商密钥，不在服务异常时伪造演示答案。

桌面页面使用 `file://`，Origin 为 `null`；后端需允许该源和开发源，使用 Bearer token，不依赖跨域 Cookie。独立 Web 部署另在 `CORS_ORIGINS` 添加准确的源地址。

## 音频与权限

Mac 默认 `__screen_capture__`：Electron 屏幕通道获取系统声音，与截图共用录屏权限，视频轨道取得后关闭，音频路径不保存或上传画面。保留可选虚拟输入及旧 Core Audio tap 实现。Windows 通过 WASAPI loopback 采集默认或指定输出，显式选择的输出不会自动跟随默认设备改变。

准备页统一检查必填项、麦克风、系统音频和截图权限，面试中不临时弹系统授权。设备检查与正式采集复用实现；检查只在本机进行，静音不等于无权限。设备拔出、默认输出变化或失败应暂停，停止旧资源后允许继续。

麦克风优先 `echoCancellation: {exact: 'all'}`、降噪并关闭自动增益，系统音频保留原声。仅在不支持该 AEC 模式时回退；权限/占用错误不能被回退掩盖。设备 ID 留在本机并区分平台，不将 Mac 输入 ID 同步成 Windows 输出 ID。

Mac ad-hoc 更新可能使旧 TCC 授权失效。应用提供重启与重新申请本应用录屏权限入口，固定重置本应用标识，不修改其他应用授权，不直接写 TCC 数据库。系统授权由用户完成。Electron 显示采集拒绝回调使用 `null`，不能传空对象导致 `Invalid capture constraints`。

## 对话、回答与保存契约

- 实时 WebSocket 使用 Bearer 鉴权和已保存的工作区会话；音频为 PCM16、16kHz、单声道、40ms 帧，协议见 [音频协议](../../mobile/docs/AUDIO_PROTOCOL_V1.md)。
- 中间句用稳定 ID 与递增 revision 更新原气泡，只有供应商确认后标记完成。手动拆句按用户换行，不按英文句点盲拆。
- 回答由 request_id 独立归档；同问题、偏好和源版本已有回答时复用。编辑问题可连续多次生成，原答案保留生成时的快照。
- 前端回答接口使用 NDJSON 增量；不要把供应商 SSE 原样当成客户端协议。当前四种方式为 `conversational / structured / written / coding`，篇幅预算见后端 `llm_service.py`。
- 结束面试后禁止继续现场答案生成，历史详情提供查看、导出和复盘。
- 保存快照带 `expected_revision`（新建为 0）。本机待同步副本不应因为响应丢失就覆盖服务器更新；恢复时先重试原版本。
- 删除墓碑拒绝迟到保存，不能为清理历史直接删除墓碑表。服务端已删除但录音清理失败时允许重试清理。
- 注册/重设验证码分别使用 `purpose=register/reset_password`；不得复用登录验证码场景。

## 窗口与布局

主窗口隐藏 Dock/任务栏入口并保留菜单栏/托盘恢复；界面提供隐藏和退出。主窗口关闭前停止采集、保存草稿后退出，回答浮窗关闭不退出主应用。小窗口使用同一个页面和采集会话，自动置顶；恢复时还原进入前的尺寸和置顶状态。高缩放屏幕按实际工作区限制最小尺寸。

小窗口保留回答方式、补充问题和采集操作；设备设置等操作恢复大窗处理。任务栏和操作区固定，中间对话/回答单独滚动。合并提问显示勾选框、已选底色和数量。

共享保护覆盖窗口内 DOM 提示，避免原生 `title`、独立提示窗或系统通知泄露内容；OS 授权框、托盘菜单不属于窗口保护。不同采集软件可能忽略保护标记，需要在真实会议中核对。

## 回归检查

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm exec tsc -p electron/tsconfig.json
node scripts/run-smoke-app.cjs
node scripts/ensure-screenshot.cjs
node scripts/smoke-screenshot.cjs
```

窗口冒烟使用临时用户目录和本地空白页，不接入音频、网络或用户记录。OCR 使用合成中英文与代码图片，验证取消/重试。Windows 原生构建与安装包校验见 [Windows 构建说明](windows-build.md)；真实声卡、外放回声与会议共享仍需要平台实机检查。

文档转换和 LibreOffice 路由已移除；简历保留 PDF/DOCX/TXT 解析。不要恢复已移除的桌面转换依赖。
