# AI 面试助手 — 后端技术实现文档

## 项目概述

AI 面试助手是一个面向技术面试场景的实时 AI 辅助平台，支持 macOS/Windows/Android 三端。后端基于 Python 异步生态构建，承载了实时音频流处理、语音识别（ASR）、大模型流式回答、简历智能解析等核心能力，所有关键链路均为全异步非阻塞设计。

文档格式转换功能已移除，不需要安装 LibreOffice。保留 PDF / DOCX / TXT 简历的文本解析，以及基于简历和岗位材料的面试准备工具。

---

## 技术栈与架构选型

| 层级 | 技术选型 | 选型理由 |
|------|---------|---------|
| Web 框架 | FastAPI 0.115 + Uvicorn | 原生 async/await 支持，与 ASR/LLM 流式链路无缝衔接；Pydantic v2 做请求校验 |
| 通信协议 | WebSocket（实时音频）+ RESTful（业务接口） | WebSocket 承载双向流式音频和 LLM SSE 转发；REST 承载登录、简历、面试历史等 |
| 数据库 | PostgreSQL 16（生产） / SQLite（本地开发） | SQLAlchemy 2.0 异步引擎，通过 `LOCAL_DEV` 环境变量一键切换，本地零依赖开发 |
| 缓存 | Redis 7（生产） / 内存 dict 模拟（本地开发） | 验证码 TTL 存储、发送冷却控制；本地开发用 FakeRedis 实现相同接口，无需安装 Redis |
| LLM | DeepSeek-V4（Chat API，HTTP2 SSE） | 自建 httpx 原生 SSE 解析，不引入 OpenAI SDK，避免额外依赖 |
| ASR | 火山引擎 BigModel（WebSocket 双向流式） | 实时流式识别 + 自定义静音断句策略，不依赖厂商 VAD |
| 音频协议 | 自研二进制协议 ACP1 + JSON 控制帧 | 44 字节定长包头 + PCM payload，支持 realtime/backfill 双通道、序列追踪、SHA256 校验 |
| 容器化 | Docker Compose（app + PostgreSQL + Redis） | 一键部署，healthcheck 依赖编排 |

---

## 架构设计

### 整体分层

```
routers/          ← API 层（FastAPI Router），负责 HTTP/WS 接入、鉴权、参数校验
    ├── audio.py      核心 WebSocket：音频流接收 + LLM 查询 + ASR 转录分发
    ├── auth.py       邮箱验证码登录/注册/Token 管理
    ├── interview.py  面试历史 CRUD
    ├── resume.py     简历上传/解析/自我介绍生成
    ├── stt.py        离线语音转文字
    └── workspace.py  桌面工作区：岗位、简历版本、会话、设置、准备工具与复盘
services/         ← 业务逻辑层，无框架依赖，可独立单测
    ├── llm_service.py       DeepSeek 流式调用 + SSE 解析
    ├── stt_service.py       火山引擎离线 ASR（HMAC-SHA256 签名鉴权 + gzip 帧编码）
    ├── stt_streaming.py     火山引擎实时流式 ASR（静音断句 + 按需重连）
    ├── audio_service.py     音频会话管理（双通道接收 + 序列追踪 + 完整性校验）
    ├── auth_service.py      用户/Token/密码（PBKDF2-SHA256）业务逻辑
    ├── resume_service.py    PDF 解析（pdfplumber）+ LLM 自我介绍生成
    ├── email_service.py     SMTP 邮件（HTML 模板 + SSL/STARTTLS）
    ├── asr_text_corrector.py  双层 ASR 文本纠正引擎
    ├── workspace_llm.py    面试准备与复盘的模型调用
    ├── workspace_requests.py  请求取消与复盘并发控制
    └── tracks/              多语言赛道系统（JS/Python/Java/C++/C#/Go + 通用术语）
models/           ← Pydantic Schema + SQLAlchemy Model
db.py / redis.py  ← 数据库/缓存连接管理（支持生产/本地双模式）
```

### 核心数据流

```
[桌面客户端] ──WebSocket──→ audio.py ──→ AudioSession 管理
                                  ├──→ 实时 ASR（火山引擎流式）──→ asr_text_corrector 纠正
                                  │         └──→ transcription_queue ──→ WebSocket 推前端
                                  └──→ LLM 查询 ──→ DeepSeek SSE
                                            └──→ asyncio.Queue ──→ WebSocket 推前端
```

---

## 核心技术实现

### 1. 自研音频流协议（ACP1 v1）

设计了 44 字节定长二进制包头 + PCM payload 的私有协议，解决以下问题：

- **双通道设计**：`realtime`（实时低延迟）和 `backfill`（离线补传高可靠）两个独立通道，分别写入不同文件，最终通过 SHA256 校验合并为 canonical PCM
- **序列追踪与 ACK**：每个包带 session_id + sequence + capture_offset_us，服务端追踪丢包、计算 gap，每 10 帧降频发送 ACK
- **Pydantic v2 严格校验**：所有控制消息（ClientHello / SessionStart / TrackStart / FileStart 等 12 种类型）用 Pydantic model_validate 校验，支持 snake_case 与 camelCase 双命名兼容

```python
# 包头结构（44 bytes）
PACKET_HEADER = struct.Struct(">4sBBBB16sqqI")
# magic(4) + version(1) + kind(1) + source(1) + flags(1) + session_id(16) + sequence(8) + offset(8) + payload_len(4)
```

### 2. 实时流式 ASR 与静音断句

自研 `StreamingASRSession` 封装火山引擎 BigModel WebSocket 协议，实现自主静音断句策略：

- **不依赖厂商 VAD**：自研 RMS 语音检测（PCM16 RMS 阈值 800）和静音计时器（1.2s 阈值），区分麦克风底噪与系统数字静音
- **按需重连**：静音超时断句 → `is_final` 通知前端 → 主动断连；下次有声音时自动重建 WebSocket 连接，重连期间缓冲所有帧
- **防重连风暴**：5 秒冷却窗口，防止重连失败时疯狂重试
- **消抖策略**：连续 2 帧（80ms）有声才算真说话，过滤单帧气息/杂音
- **全零帧快判**：系统音频静音时是纯数字零，采样前 32 字节快速跳过，O(1) 判断

### 3. LLM 流式回答管线

自建 httpx HTTP2 SSE 解析，不引入 OpenAI SDK：

- **DeepSeek SSE 流式解析**：逐行解析 `data: {...}` 帧，提取 delta content 和 finish_reason
- **请求取消与隔离**：每个请求带 `request_id`，新请求直接 cancel 旧 `asyncio.Task`，前端按 id 过滤避免气泡错乱；快速连点时零延迟启动新回答
- **HTTP2 预热**：面试开始时异步预热 DeepSeek 链路，消除首包 ~1.1s 连接建立开销
- **分块透传**：LLM chunk 通过 `asyncio.Queue` 解耦收发，独立 sender task 保证 WebSocket 不被 LLM 流阻塞

### 4. 双层 ASR 文本纠正引擎

自研代码级文本纠正器，解决语音识别技术术语错误问题（如"闭包"→"必报"、"React"→"瑞爱的"）：

- **Layer 1 — 精确匹配**：按术语长度降序排列，O(n) 遍历 str.replace，微秒级延迟
- **Layer 2 — 拼音模糊兜底**：对中文片段提取拼音（pypinyin），与术语库拼音做 rapidfuzz 模糊匹配（阈值 72%），毫秒级延迟
- **术语库 ~1500 条**：覆盖通用计算机科学 + 6 种编程语言赛道，每个术语配 3-15 个 ASR 常见变体
- **自动变体生成**：对每个术语自动生成字母拼读版（React→R E A C T）、去空格版、去标点版
- **川渝方言纠错**：覆盖平翘舌不分/边鼻音不分/前后鼻音混淆等方言特征
- **中文黑名单洗白**：防止"特性"被误纠正为"attribute"、"事件"被误纠正为"Event"

### 5. 多语言赛道系统

插件化赛道架构，加新语言只需两步（新建 .py + 注册路径）：

- **6 个编程语言赛道**：JavaScript（~200 术语）、Python（~150 术语）、Java（~200 术语）、C++、C#、Go
- **通用术语层**：~300 条跨语言共享术语（数据结构/算法/网络/安全/设计模式/数据库）
- **分层 Prompt 注入**：`system_prompt_extra`（赛道角色） + `resume_intro_extra`（简历侧重） + `terms`（术语表）
- **运行时懒加载**：赛道词典延迟加载，按 track_key 缓存避免重复加载

### 6. 双环境开发策略

通过 `LOCAL_DEV` 环境变量实现零依赖本地开发：

- **SQLite vs PostgreSQL**：同一套 SQLAlchemy 异步引擎接口，本地用 aiosqlite，生产用 asyncpg + 连接池（pool_size=10, max_overflow=20）
- **FakeRedis vs Redis**：自实现 `_FakeRedis` 类（dict + TTL 过期模拟），接口与 redis.asyncio 完全一致，覆盖 get/set ex nx/delete/ttl 五个方法
- **环境自动检测**：`LOCAL_DEV=true` 一键切换，无需修改代码

### 7. 简历解析与面试准备

- **简历上传**：工作区接收不超过 10 MB 的 PDF、DOCX、TXT 文件；解析在线程池中运行。PDF 通过 `pdfplumber` 提取文字，DOCX 通过 Python 标准库 `ZipFile` / `ElementTree` 读取正文，TXT 使用 UTF-8 或 GB18030 解码。
- **内容与版本**：检查空文件、损坏文件及文字长度；文本按用户保存为不可变简历版本，可关联到面试快照。扫描版 PDF 没有 OCR，无法提取文字时需要改用粘贴文本。
- **准备工具**：`/api/workspace/tools/{tool}` 提供自我介绍、项目讲述、岗位分析和答题练习，使用问题、简历和岗位原文组织回答，要求区分真实经历与通用建议。
- **旧接口兼容**：旧简历路由继续提供 PDF 解析与自我介绍；桌面工作区使用 `workspace.py` 中的简历和工具接口。

### 8. 认证与安全

- **邮箱验证码**：6 位数字码，Redis 存储 5 分钟 TTL，30 秒发送冷却，HTML 精美邮件模板
- **Token 管理**：SHA256 哈希存储，15 天有效期，5% 概率触发过期 Token 清理
- **密码安全**：PBKDF2-SHA256（10 万次迭代 + 16 字节随机 salt）
- **SMTP**：支持 SSL（465）和 STARTTLS（587），QQ 邮箱/163/Gmail 通用

---

## 性能数据

| 指标 | 数值 |
|------|------|
| WebSocket 音频帧延迟 | <200ms（200ms 分片 + 网络） |
| ASR 转录首字延迟 | <500ms（启用 first_char_accel） |
| LLM 首 token 延迟 | <2s（含 HTTP2 握手；预热后 <1s） |
| ASR 文本纠正延迟 | Layer1 <100μs, Layer2 <5ms |
| 静音断句响应 | 1.2s 无声音触发 is_final |
| 单个 ASR Session 内存 | <5MB |
| Docker 镜像体积 | ~200MB（python:3.12-slim 基础） |

---

## 工程实践亮点

- **全异步非阻塞**：FastAPI + SQLAlchemy async + httpx HTTP2 + websockets + aioredis，所有 I/O 链路无同步阻塞
- **生产者-消费者解耦**：音频流 → ASR Session → asyncio.Queue → sender task → WebSocket，各环节独立协程，反压可控
- **优雅关闭**：shutdown 事件依次取消 sender/ASR/LLM 任务，清空队列，关闭 WebSocket，释放连接池
- **全局异常捕获**：sys.excepthook + FastAPI exception_handler 双层兜底，生产环境不会因未捕获异常崩溃
- **日志分层**：DEBUG 级别全量日志 + 第三方库日志降噪（websockets/httpcore/httpx 设为 WARNING）
- **兼容性设计**：新旧协议共存（ACP1 v1 + Legacy raw PCM），Pydantic validation_alias 兼容 snake_case 和 camelCase
- **ACK 降频**：每 10 帧发送一次确认，避免高频 ACK 锁死 WebSocket 写端

---

## 项目文件结构

```
backend/
├── Dockerfile              # python:3.12-slim, uvicorn 8010
├── docker-compose.yml      # app + postgres:16 + redis:7，healthcheck 依赖
├── requirements.txt        # 后端直接依赖，精确版本；PDF 简历解析保留 pdfplumber
├── pytest.ini
├── app/
│   ├── main.py             # FastAPI 应用入口，startup/shutdown 生命周期
│   ├── db.py               # SQLAlchemy 异步引擎（SQLite/PostgreSQL 双模式）
│   ├── redis.py            # Redis 客户端（aioredis / FakeRedis 双模式）
│   ├── models/
│   │   ├── db_models.py    # 4 个表：User / Resume / Token / Interview
│   │   └── schemas.py      # 12 个 Pydantic 控制消息模型 + 音频协议定义
│   ├── routers/
│   │   ├── audio.py        # 主 WebSocket 端点（~560 行）
│   │   ├── auth.py         # 邮箱验证码认证（7 个端点）
│   │   ├── interview.py    # 面试历史（4 个端点）
│   │   ├── resume.py       # 简历上传/查询（3 个端点）
│   │   ├── stt.py          # 离线语音转文字（1 个端点）
│   │   └── workspace.py    # 桌面岗位、简历、会话、设置、工具与复盘
│   └── services/
│       ├── llm_service.py          # DeepSeek 流式 SSE
│       ├── stt_service.py          # 火山引擎离线 ASR（HMAC-SHA256 签名）
│       ├── stt_streaming.py        # 火山引擎实时流式 ASR（~400 行）
│       ├── audio_service.py        # 音频会话 + 双通道追踪（~450 行）
│       ├── auth_service.py         # 认证逻辑
│       ├── email_service.py        # SMTP 邮件
│       ├── resume_service.py       # PDF 解析 + LLM 自我介绍
│       ├── asr_text_corrector.py   # 双层 ASR 文本纠正（~200 行）
│       ├── workspace_llm.py       # 准备任务和复盘模型请求
│       ├── workspace_requests.py  # 请求取消与复盘并发控制
│       └── tracks/                 # 多语言赛道
│           ├── common.py           # 通用术语（~300 条）
│           ├── javascript.py       # 前端赛道（~200 条）
│           ├── python.py           # Python 赛道（~150 条）
│           ├── java.py             # Java 赛道（~200 条）
│           ├── cpp.py / csharp.py / go.py
│           └── __init__.py         # 赛道加载/合并/查询
```
