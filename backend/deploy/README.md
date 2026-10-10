# 现有服务器原地发布

本目录用于已审阅的 Linux 部署：项目 `/www/wwwroot/interview-assistant`，systemd 单元 `interview-assistant.service`，一个 uvicorn worker 监听 `127.0.0.1:8010`，PostgreSQL 16 容器 `iv-interview-pg`，Redis 容器 `iv-interview-redis`，nginx 站点 `interview.iyouzi.cc`。脚本不重建容器、不修改 systemd/nginx，不覆盖 `.env` 或 `data/`。

`release.sh` 是发布操作本身，会在 `deploy` 阶段停止并重启服务。先审阅本次候选代码、生产配置与迁移，再在已经授权的维护窗口运行。不要用 `bash -x`，也不要把私有日志、环境文件、容器配置或数据库备份贴进聊天。

## 目录与步骤

以发布编号 `20261010-workspace-v050` 为例：

```text
/www/wwwroot/interview-assistant/
  .env                         # 原样保留
  data/                        # 原样保留；PostgreSQL bind mount 不做文件复制
  app/                         # 对外运行的代码
  .venv -> .deploy-releases/<编号>/venv
  .deploy-releases/<编号>/
    source/app/
    source/requirements.txt
    venv/                      # 固定绝对路径，创建后不移动
    prepare.log                # 私有构建及导入日志
    status
  .app-previous-<编号>/         # 快速回退代码
  .venv-previous-<编号>/        # 旧 venv 或旧链接，恢复时移回原处

/www/backups/interview-assistant/<编号>/  # 目录权限 700
  code-config.tar.gz
  environment.env
  systemd-unit.snapshot
  systemd-properties.snapshot
  container-config.snapshot.json
  postgresql.dump              # 停止 API 写入后 pg_dump -Fc
  postgresql.dump.list
  audio-captures.tar.gz         # 停止 API 后归档，仅包含应用音频文件
  SHA256SUMS
```

先上传只含后端代码与依赖清单的候选包并验证 SHA-256。不要上传本机 `.env`、`.venv`、`data`、缓存或前端资源。可将候选包解压到 `.deploy-releases/<编号>/source/`，也可让 `prepare` 从独立目录复制 `app/` 和 `requirements.txt`。

```bash
# 脚本放在已审阅的运维目录，以下示例使用 /root/interview-deploy/release.sh。
# 不传 SOURCE 时使用候选目录中已有的 source/，也可复用已创建的新 venv。
INTERVIEW_PYTHON=/usr/bin/python3.11 \
  bash /root/interview-deploy/release.sh prepare 20261010-workspace-v050

# SOURCE 为 app/ 和 requirements.txt 的父目录；二选一。
# bash /root/interview-deploy/release.sh prepare <新编号> /root/interview-candidate/backend

# 完成迁移预演、检查维护窗口后执行：
bash /root/interview-deploy/release.sh deploy 20261010-workspace-v050
```

`prepare` 在最终位置安装 `requirements.txt` 中锁定的直接依赖，运行 `pip check`，保存全部解析后的依赖版本，并使用生产 `.env` 做模块导入及版本校验。导入不运行 FastAPI lifespan，因此不会迁移数据库、调用 AI、发送验证码或启动 ASR。传递依赖的准确版本保存在 `requirements.resolved.txt`；现有 requirements 并非带哈希的完整传递依赖锁文件。

`deploy` 重新核对候选代码与 `.env` 摘要、systemd 工作目录和启动路径、容器存活状态，以及应用数据库名与容器默认数据库名。先保存代码、配置、unit、nginx 配置、容器配置，再停止 API，生成并检查 PostgreSQL 逻辑备份，之后才替换 `app` 和 `.venv`。PostgreSQL 的用户、密码在容器内读取；密码不放到宿主机命令参数。若使用 `POSTGRES_PASSWORD_FILE`，同样在容器内读取。

数据库备份使用容器默认 `POSTGRES_DB`，与应用数据库不一致时脚本拒绝部署，需要先人工审阅备份目标。它不备份整个数据库集群的其他库/角色；现有容器和角色保持不变。停止 API 后另外归档 `data/audio-captures`（若存在），不打包仍在运行的 `data/pgdata` 或 `data/redisdata`；代码、数据库及音频归档都记录 SHA-256。Redis 保持运行，验证码和 TTL 不被清空。

发布后的新进程启动会运行事务性增量迁移。脚本等待 `/health` 返回 `status=ok` 且 `version=0.5.0`；这只是应用存活检查，不能替代业务联调。随后应验证公网 HTTPS、鉴权、用户历史归属、迁移记录、流式回答和 WebSocket 反代。检查只读统计即可，不输出简历、对话或账号明细。

## 腾讯普通版主服务与火山备用

实时语音通过后端 `ASR_PROVIDER` 显式选择，未设置时保持旧版 `volcengine`。
生产接入腾讯时，在服务器私有 `.env` 设置：

```dotenv
ASR_PROVIDER=tencent
TENCENT_ASR_APP_ID=<数字 AppID>
TENCENT_ASR_SECRET_ID=<SecretId>
TENCENT_ASR_SECRET_KEY=<SecretKey>
ASR_TRUST_ENV=false
```

腾讯固定使用 **普通通用引擎 `16k_zh`**，不调用大模型，不自动开通后付费。
虽然请求地址包含 `/asr/v2/`，实际引擎仍是普通版；以 `engine_model_type` 为准。
鉴权在服务器完成，密钥及签名 URL 不下发桌面、不写入日志或 Git。
腾讯连接默认直连；若已有 `ASR_PROXY_URL`，它仍会生效，部署前应确认代理出口区域。

保留原有 `VOLC_API_KEY` 和 `VOLC_ASR_RESOURCE_ID`。需切回时，只修改 `.env`
中的 `ASR_PROVIDER=volcengine`，执行 `systemctl restart interview-assistant.service`。
恢复腾讯则改回 `tencent` 并重启。切换前结束正在采集的面试，桌面恢复采集后使用新服务；
无需重新打包。备用为运维切换，不在识别途中自动换供应商，避免重复气泡、时间戳错位及火山并发再次耗尽。

两路来源分别建立连接；10 人双音源需 20 路。腾讯每包 200ms，握手或短暂断线后
也按音频实时速率发送，避免积压音频瞬间发送触发限流。`slice_type=0/1` 更新同一气泡，
`slice_type=2` 确认该句；流结束 `final=1` 仅确认连接收尾。重连使用新 `voice_id`。
暂停/结束会发送尾部音频和 end，等待供应商确认；不会把未确认草稿伪装成最终结果。

腾讯错误：4002 鉴权、4003 未开通、4004 时长用尽、4005 欠费、4006 并发满、6001 区域/代理不匹配。
以上错误给出明确提示并释放连接，不循环重试消耗额度。
参考：[普通版 WebSocket 契约](https://cloud.tencent.com/document/product/1093/48982)。

## 火山备用的并发与错误排查

每位用户选择「麦克风 + 系统音频」时会建立 **2 路**火山实时 ASR 连接；单音源占 1 路。供应商配额由使用同一项目/服务资源的调用共享，不能按桌面在线人数计算。容量至少按 `双音源面试人数 × 2 + 单音源面试人数` 估算，并为重连和其他调用预留余量；准确信息以豆包语音控制台的服务详情为准。

`45000292` 不能只凭数字判断是余额不足：返回信息为 `quota exceeded for types: concurrency` 表示并发额度已满，`audio_duration_lifetime` 则表示时长额度受限。后端分别返回 `E_ASR_CONCURRENCY` / `E_ASR_QUOTA`，桌面端暂停采集并显示具体提示。此类错误不会自动循环重试；拒绝的连接会立即关闭。其他用户已经正常识别的连接继续工作。

服务器日志记录错误码、分类、音源、资源 ID、请求 ID 和供应商 `X-Tt-Logid`，不记录密钥、原始错误正文或面试内容。可用这些信息排查配额，或向供应商提交工单。

默认资源仍为 `volc.seedasr.sauc.duration`（2.0 小时版）；小时版也支持并发，容量取决于已开通的配额。需要扩容时，先在[豆包语音控制台](https://console.volcengine.com/speech/app)查看对应项目的服务详情，再调整该服务的并发额度。不要为解决并发问题改成按句返回的 `bigmodel_nostream`，那会丢失逐字流式显示。

如果实际购买了其他服务类型，可以在生产 `.env` 设置 `VOLC_ASR_RESOURCE_ID` 后重启后端，支持以下值：

- `volc.seedasr.sauc.duration` / `volc.seedasr.sauc.concurrent`：2.0 小时版 / 并发版。
- `volc.bigasr.sauc.duration` / `volc.bigasr.sauc.concurrent`：1.0 小时版 / 并发版。

仅修改这个变量不会增加供应商额度，也不会自动开通付费服务。资源必须与对应项目实际开通的服务匹配。参考：[官方流式 ASR 接口](https://docs.volcengine.com/docs/DoubaoVoice/LargemodelstreamingautomaticspeechrecognitionAPI?lang=zh)、[控制台服务与配额说明](https://docs.volcengine.com/docs/DoubaoVoice/QuickStartNewConsole?lang=zh)。

## 数据库迁移预演

建议先对生产库做在线逻辑备份，将它恢复到**名称唯一、专供本次预演的临时数据库**，让候选代码只连接该副本执行迁移。临时连接必须通过明确的 `DATABASE_URL` 覆盖，并且保留 `LOCAL_DEV=false`，不要启动监听生产端口的第二套 API。迁移本身不调用邮件、AI 或 ASR；供应商连接检查应与迁移分开记录。

检查旧表记录数、迁移登记、workspace 会话归属与数量，再次执行迁移确认幂等。预演数据仍包含真实业务内容，应在私有目录和受控数据库中处理。该流程不由脚本自动创建或删除数据库；预演副本的创建、名称、清理需在本次操作记录中明确。部署时仍需在停止旧 API 后另做一份最新备份，不能把较早的预演备份当作停机备份。

## 应用回滚

部署、启动或健康检查失败时，脚本尝试恢复旧 `app`、旧 `.venv`、旧 requirements 并启动服务。手动回退最新发布：

```bash
bash /root/interview-deploy/release.sh rollback 20261010-workspace-v050
```

脚本拒绝对并非当前运行版本的旧编号执行回退。发布锁覆盖 prepare、deploy 和 rollback；不要另开终端同时手动变更这些路径。

回滚只恢复代码和运行环境，**不自动恢复数据库、不删除新表、不清除迁移记录**。当前 workspace 迁移保留旧表；应用回退后新增的 workspace 记录也继续保留。自动恢复数据库会丢失备份后发生的写入，必须作为独立的事故恢复操作审阅。需要恢复数据库时，先保存故障现场并验证备份，再由操作者确定停机和恢复目标，不能直接向运行中的生产库使用 `pg_restore --clean`。

不要在验收完成前清理 `.app-previous-*`、`.venv-previous-*`、旧 release 或 `/www/backups/...`。Python venv 启动器包含绝对路径，所以新 venv 始终留在最终 release 目录；旧 venv 仅临时保留在回滚位置，恢复时必须移回原 `.venv` 路径。`kill -9`、机器断电或磁盘故障不能依赖 shell 自动恢复，应根据保存的目录和私有日志人工复原。
