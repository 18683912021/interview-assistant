# audio.capture.v1

## 音频规范

每条轨道统一为：

- PCM signed 16-bit little-endian
- 16,000 Hz
- 单声道
- 实时块：40ms / 1,280 bytes
- BOTH：MIC 与 SYSTEM 使用独立序列空间，不混音

## 控制消息

连接顺序：

1. `client_hello` → `ready`
2. `session_start` → `session_ready`
3. 每轨 `track_start` → `track_ready`
4. 实时 binary packets → `chunk_ack`
5. 每轨 `track_end`
6. `session_stopped`
7. 每轨 `file_start`
8. backfill binary packets → `chunk_ack`
9. 每轨 `file_end` → `file_complete`
10. `session_complete`

## 44-byte binary header

所有整数使用 big-endian，PCM payload 本身仍是 little-endian。

| Offset | Size | Field |
|---:|---:|---|
| 0 | 4 | Magic `ACP1` |
| 4 | 1 | Version `1` |
| 5 | 1 | Kind: `1=realtime`, `2=backfill` |
| 6 | 1 | Source: `1=mic`, `2=system` |
| 7 | 1 | Flags: bit 0 = final partial block |
| 8 | 16 | Session UUID bytes |
| 24 | 8 | Sequence (`int64`) |
| 32 | 8 | Capture offset microseconds (`int64`) |
| 40 | 4 | Payload length (`int32`) |
| 44 | N | PCM payload |

## Backpressure

- Kotlin AudioRecord 线程只负责本地 PCM 和有界原生队列。
- OkHttp 队列高水位 512KiB，低水位 128KiB。
- 实时过载时丢最旧网络块但不丢本地文件；sequence gap 明确可见。
- 停止后 backfill 不允许丢包，使用完整长度和 SHA-256 校验修复服务器 canonical 文件。

## 兼容模式

后端仍接受旧版首条消息 `{ "config": ... }` 和后续裸 PCM bytes，便于旧 PoC 联调；新 App 只使用 v1。
