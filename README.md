# AI 面试助手（AI Interview Copilot）

实时听觉辅助面试工具：面试中通过系统音频回采捕捉面试官语音 → ASR 转写 → LLM 生成回答 → 自动记录整场面试，配合简历/JD 知识库与面试情报押题。

> 2026-09-04 从 CoAgent 多 Agent 协作工作区迁出独立管理（原 `fe-app/audio-capture`、`agent_app/workspace/fe/audio-capture`、`agent_app/workspace/be/poc-audio-capture`）。旧路径的完整 git 历史保留在 CoAgent 仓库中。

## 目录结构

| 目录 | 端 | 技术栈 |
|------|-----|--------|
| `mobile/` | Android App | React Native 0.78.3（纯 CLI）+ Kotlin 原生采集模块 |
| `desktop/` | PC 桌面端（主力） | Electron 43 + React 19 + Vite + Tailwind + WASAPI/macOS 虚拟声卡音频采集（macOS 需 BlackHole） |
| `backend/` | 后端服务 | FastAPI + SQLAlchemy async（Postgres/Redis）+ 火山豆包 ASR + DeepSeek LLM |

## 环境要求

| 组件 | 版本 |
|------|------|
| Node.js | 22.23.1（`.nvmrc`） |
| npm | 10.9.8（mobile）；pnpm 9.15.0（desktop） |
| Python | 3.12（backend） |
| Android（mobile） | JDK 17 / Gradle 8.12 / AGP 8.8 / SDK 35 / NDK 27.1，详见 `mobile/RN_ANDROID_STUDIO_SETUP.md` |

## 快速开始

### backend（先起服务）

```bash
cd backend
python -m pip install -r requirements.txt
# 准备 .env（参考后文密钥清单，不进 git）
uvicorn app.main:app --host 0.0.0.0 --port 8010
```

- 端口 `8010`：REST API + `/api/ws/audio/stream` WebSocket（40ms PCM16 16kHz mono 帧，协议见 `mobile/docs/AUDIO_PROTOCOL_V1.md`）
- 本地开发默认 `LOCAL_DEV=true`（SQLite + 内存存储，免 Docker）；生产用 `docker-compose.yml`（Postgres + Redis）

### desktop

```bash
cd desktop
pnpm install          # 必须用 pnpm；node_modules 不可跨位置移动
pnpm dev              # vite + tsc watch + launch-electron（含原生 addon 自动编译）
```

后端地址：`src/config.ts` 读取 `VITE_API_HOST`（默认 `interview.iyouzi.cc`，生产走 HTTPS/WSS 经 nginx 反代），可写 `desktop/.env` 覆盖。dev 模式仍直连本地后端（`ws://…:8010`）。

### mobile（Android）

```bash
cd mobile
npm ci
npm start             # Metro
# Android Studio 打开 android/，JDK 17，Run
```

后端地址：`src/config.ts` 的 `TEST_HOSTS`（company / local / android / server），按联调环境改 `ACTIVE_HOST`。

## 密钥（.env 不进 git）

| 文件 | 用途 |
|------|------|
| `desktop/.env` | `VITE_API_HOST`（后端地址）、`ANTHROPIC_MODEL` |
| `backend/.env` | DeepSeek（`ANTHROPIC_*`）、火山豆包（`VOLC_API_KEY`）、SMTP（验证码邮件）、`DATABASE_URL`/`REDIS_URL` |

## 部署（生产服务器）

服务器（阿里云 47.108.205.102）采用宝塔面板 + systemd + nginx 反代：

```bash
cd backend
docker compose up -d --build     # 仅兜底/回滚参考；正式迁移见下
```

- 代码：`/www/wwwroot/interview-assistant/`（`app/` + `.venv` + `data/`，数据均在项目目录内）
- 服务：`systemd` 单元 `interview-assistant.service`（`Restart=always`，监听 `127.0.0.1:8010`，由 nginx 对外）
- 数据库：Postgres 16 + Redis 7（docker 容器 `iv-interview-pg` / `iv-interview-redis`，bind mount 到 `data/`，仅监听 `127.0.0.1`）
- 站点：宝塔「网站」→ `interview.iyouzi.cc`（nginx conf 由宝塔管理，反代配置在 `/www/server/panel/vhost/nginx/extension/interview.iyouzi.cc/`，WebSocket 经 `/api/ws/` 传递 Upgrade 头）
- 证书：ZeroSSL（acme.sh 签发，因服务器直连 Let's Encrypt 被墙；crontab 已有每日自动续期；如需恢复 LE 可用宝塔面板「SSL」一键申请替换）
- 密钥：`.env` 不进 git，服务器已从旧部署容器迁移

## 文档索引

- `mobile/RN_ANDROID_STUDIO_SETUP.md` — Android 开发环境搭建
- `mobile/docs/AUDIO_PROTOCOL_V1.md` — 音频流协议 v1（两端 WebSocket 帧约定）
- `mobile/docs/MIGRATION_MATRIX.md` — 移动端/桌面端功能迁移对照
- `desktop/docs/macOS音频采集说明.md` — macOS 系统音频采集（BlackHole 虚拟声卡）配置与故障排查
- `desktop/docs/Storybook*.md` — 组件库入门与改造方案
