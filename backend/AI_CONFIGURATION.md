# AI 服务配置和连接诊断

实时回答、准备工具和复盘共同使用 `app.services.ai_config`。默认调用 DeepSeek 的 OpenAI 兼容协议，模型为 `deepseek-flash`，显式关闭 thinking。旧 `deepseek-v4-flash` 名称归一到当前名称。

推荐在后端配置 `DEEPSEEK_API_KEY`，可选 `DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com/v1`）、`DEEPSEEK_MODEL`。已有 `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic` 无需修改；程序兼容这些旧变量名，并转换为 DeepSeek 的 chat-completions 地址。它不代表支持向任意 Anthropic 服务发送 OpenAI 协议请求。

工具和复盘可通过 `WORKSPACE_LLM_BASE_URL`、`WORKSPACE_LLM_MODEL` 覆盖公共配置。地址不得含用户名、密码或查询参数。不要把密钥放在 URL 中。

默认不继承启动终端的 `HTTP_PROXY` / `HTTPS_PROXY`，避免终端残留的本机代理使已配置密钥的 AI 服务无法连接。如部署网络必须使用代理，明确设置 `AI_PROXY_URL`（HTTP/HTTPS 代理 URL），或设置 `AI_TRUST_ENV=true` 选择继承环境代理。显式代理优先。语音服务的代理设置独立使用 `ASR_PROXY_URL` / `ASR_TRUST_ENV`。

流式 SSE 支持 HTTP/1.1；缺少可选 `h2` 依赖时自动回退，不会因为缺少 HTTP/2 包而在开始面试时退出。

`GET /health` 仅确认进程存活，同时返回 `ai.configured` 和 `ai.reason_code`，不会访问供应商。它不等于模型可用。

`GET /api/diagnostics/ai` 需要本项目的 Bearer 登录认证；它在最多 8 秒内调用非生成接口 `GET /models`，不发送简历、问题或其他用户材料。返回 `configured`、`reachable`、`ready`、`reason_code`、`message`、`model`、`base_url` 和 `proxy_mode`。可选 `scope=workspace` 检查工具配置，或 `probe=false` 只检查配置、不联网。`reachable=true` 只表示已收到服务响应；只有 `ready=true` 表示密钥及模型列表检查通过，仍不代表所有生成请求都会成功。模型列表检查不能核实余额；生成时会单独解释余额不足。

诊断未就绪返回 HTTP 200 和明确的 `ready=false`；HTTP 401 专用于本项目登录失效。供应商的密钥错误、余额不足、限流、网络和超时会转换为可操作信息，不返回供应商原始响应正文、密钥或代理凭据。供应商 401 不会被当成本项目退出登录。

修改配置后需让运行中的后端重新加载配置；开发环境的 `uvicorn --reload` 会在源代码修改后加载新版本。诊断必须针对 Electron 实际连接的端口；隔离测试服务禁用供应商密钥时应显示未配置。

协议依据：[首次 API 调用](https://api-docs.deepseek.com/)、[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、[模型列表](https://api-docs.deepseek.com/api/list-models/)、[错误码](https://api-docs.deepseek.com/quick_start/error_codes/)。
