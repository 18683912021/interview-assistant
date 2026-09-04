"""火山引擎实时流式语音识别会话。

端点: bigmodel（双向流式）
鉴权: X-Api-Key + X-Api-Resource-Id

帧结构（大端序）:
  4 字节 Header     [version|hdr_size] [type|flags] [ser|comp] [reserved]
  [4 字节 Sequence]  可选，flags 指示是否携带
  4 字节 PayloadSize uint32
  Payload

断句策略：1 秒无音频帧 → 发送 is_final=True 告知前端 → 断开 ASR 连接。
下次收到音频帧时再重建连接，新会话从零开始不夹带旧句。
断句完全自主，不依赖火山引擎 VAD。
"""

import asyncio
import gzip
import json
import logging
import ssl
import struct
import time
import uuid
from io import BytesIO

import websockets

logger = logging.getLogger("stt_streaming")

WS_ENDPOINT = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel"
RESOURCE_ID = "volc.seedasr.sauc.duration"

HDR = 4
SEQ = 4
SIZ = 4

SILENCE_CHECK_INTERVAL = 0.2
SILENCE_THRESHOLD = 0.7
SPEECH_RMS_THRESHOLD = 800  # PCM16 RMS 阈值，低于此视为静音


def _is_all_zero(pcm: bytes) -> bool:
    """检测 PCM 帧是否全零——系统音频静音时是纯数字零。"""
    # 采样前 32 字节快速判断，全零帧通常整帧都是零
    return not any(pcm[:32])


def _has_audio(pcm: bytes) -> bool:
    """RMS 语音检测：计算帧的均方根能量，>800 才算有声音。

    用 RMS 而非峰值——峰值对瞬时噪点太敏感，室内底噪峰值轻松过 300。
    RMS 800 ≈ -32dBFS，正常说话 > -20dBFS（~3000+），底噪 < -40dBFS（~300-）。
    """
    if len(pcm) < 40:  # 不足 20 个采样不判断
        return False
    total = 0
    count = 0
    for i in range(0, len(pcm) - 1, 4):  # 每隔 1 个采样取点
        sample = struct.unpack_from('<h', pcm, i)[0]
        total += sample * sample
        count += 1
    rms = (total / count) ** 0.5
    return rms > SPEECH_RMS_THRESHOLD


def _header(msg_type: int, flags: int, ser: int, comp: int) -> bytes:
    return struct.pack(">BBBB", 0x11, (msg_type << 4) | flags, (ser << 4) | comp, 0x00)


def _gzip(data: bytes) -> bytes:
    buf = BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as f:
        f.write(data)
    return buf.getvalue()


class StreamingASRSession:
    """一次实时 ASR 会话。

    静音断句 + 按需重连：
    - _silence_monitor 每 200ms 检查，1s 无音频 → 发 is_final + 断开
    - feed() 收到断句后第一帧时触发 _do_restart 重建连接
    """

    def __init__(self, api_key: str, source: str, tx_queue: "asyncio.Queue"):
        self._api_key = api_key
        self._source = source
        self._tx_queue = tx_queue
        self._ws = None
        self._recv_task = None
        self._send_task = None
        self._silence_task = None
        self._send_queue: "asyncio.Queue[bytes]" = asyncio.Queue(maxsize=32)
        self._running = False
        self._restarting = False
        self._seq = 1
        self._last_sent_full = ""
        self._last_audio_time = 0.0
        self._last_restart_attempt = 0.0  # 防止重连失败疯狂重试
        self._restart_buffer: list[bytes] = []  # 重连期间缓存的音频帧
        self._restart_count = 0  # 重启计数（监控用）
        self._audio_frames = 0  # 连续有声帧计数（消抖：单帧杂音不重置静音计时器）
        self._text_parts: list[str] = []

    # ══════════════════════════════════════════════════════════════
    # 公开 API
    # ══════════════════════════════════════════════════════════════

    async def connect(self) -> None:
        self._seq = 2
        self._last_sent_full = ""
        self._last_audio_time = time.monotonic()
        self._audio_frames = 0
        self._text_parts.clear()  # 清除上句残留
        # _restarting 和 _last_restart_attempt 由 _do_restart / feed 管理，
        # connect 内部不重置——否则 await websockets.connect 让出控制权时
        # 新来的帧会看到 _restarting=False 触发重复重连
        import sys as _sys
        ssl_ctx = ssl.create_default_context()
        if _sys.platform == "darwin":
            ssl_ctx.check_hostname = False
            ssl_ctx.verify_mode = ssl.CERT_NONE
        self._ws = await websockets.connect(
            WS_ENDPOINT,
            ping_interval=30,
            ping_timeout=10,
            additional_headers={
                "X-Api-Key": self._api_key,
                "X-Api-Resource-Id": RESOURCE_ID,
                "X-Api-Connect-Id": str(uuid.uuid4()),
                "X-Api-Request-Id": str(uuid.uuid4()),
                "X-Api-Sequence": "-1",
            },
            ssl=ssl_ctx,
        )
        config = {
            "user": {"uid": "audio-capture"},
            "audio": {"format": "pcm", "rate": 16000, "bits": 16, "channel": 1, "language": "zh-CN"},
            "request": {
                "model_name": "bigmodel",
                "enable_itn": True,
                "enable_punc": True,
                "enable_vad": True,
                "enable_first_char_accel": True,
                "context_history_length": 5,
            },
        }
        payload = _gzip(json.dumps(config).encode("utf-8"))
        await self._ws.send(_header(0b0001, 0, 0b0001, 0b0001) + struct.pack(">I", len(payload)) + payload)

        # 清空上句残留的音频帧——_send_task 被取消时队列可能还有存货
        while not self._send_queue.empty():
            try:
                self._send_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        self._running = True
        self._recv_task = asyncio.create_task(self._recv_loop())
        self._send_task = asyncio.create_task(self._send_loop())
        self._silence_task = asyncio.create_task(self._silence_monitor())
        logger.info("ASR 实时会话已建立")

    def feed(self, pcm: bytes) -> None:
        """音频帧非阻塞入队。VAD 只管静音检测，不管重启门槛。"""
        # 系统音频是数字流，静音帧是全零 PCM——跳过全零帧才能检测到静音
        # 麦克风有环境底噪，需要 RMS 阈值区分真实语音和背景声
        if self._source == 'system':
            if not _is_all_zero(pcm):
                self._last_audio_time = time.monotonic()
        elif _has_audio(pcm):
            self._audio_frames += 1
            # 连续 2 帧（80ms）才算真说话——滤掉单帧气息/杂音
            if self._audio_frames >= 2:
                self._last_audio_time = time.monotonic()
        else:
            self._audio_frames = 0

        # 断句后任意音频帧都触发重连——不依赖 VAD，避免 RMS 阈值误判
        # 导致 _running=False 后永久卡死
        if not self._running and not self._restarting:
            now = time.monotonic()
            if now - self._last_restart_attempt < 5.0:
                return
            self._last_restart_attempt = now
            self._restarting = True
            self._restart_buffer = [pcm]
            asyncio.create_task(self._do_restart())
            return

        # 重连中：缓存所有帧（静音也存，让 ASR 自己判断）
        if self._restarting:
            self._restart_buffer.append(pcm)
            return

        if not self._ws or not self._running:
            return
        try:
            seq_bytes = struct.pack(">I", self._seq)
            self._seq += 1
            frame = _header(0b0010, 0b0001, 0, 0) + seq_bytes + struct.pack(">I", len(pcm)) + pcm
            self._send_queue.put_nowait(frame)
            if self._seq == 3:
                logger.info("ASR 音频帧已开始推送 (seq=2+)")
        except asyncio.QueueFull:
            logger.debug("ASR 发送队列满，丢弃一帧")
        except websockets.exceptions.ConnectionClosed:
            self._running = False

    async def finish(self) -> str:
        """彻底结束会话（WebSocket 断开时调用）。"""
        if not self._ws:
            return ""
        self._running = False
        current = asyncio.current_task()
        for task in (self._silence_task, self._send_task, self._recv_task):
            if task and not task.done() and task is not current:
                task.cancel()
        # 保存本地引用——await 期间 _do_restart 可能把 self._ws 换成新连接
        ws = self._ws
        try:
            await asyncio.wait_for(ws.send(
                _header(0b0010, 0b0011, 0, 0) + struct.pack(">i", -self._seq) + struct.pack(">I", 0)
            ), timeout=3.0)
        except Exception:
            pass
        try:
            await asyncio.wait_for(ws.close(), timeout=3.0)
        except Exception:
            pass
        if self._ws is ws:
            self._ws = None
        return "".join(self._text_parts)

    # ══════════════════════════════════════════════════════════════
    # 内部
    # ══════════════════════════════════════════════════════════════

    def _enqueue(self, txt: str) -> None:
        """入队：去重后发送全量文本。is_final 始终为 False——断句由静音监控统一发。"""
        if txt == self._last_sent_full:
            return
        if not txt:
            return
        self._last_sent_full = txt
        self._text_parts.append(txt)
        if len(self._text_parts) > 200:
            self._text_parts = self._text_parts[-100:]
        if self._tx_queue is not None:
            try:
                self._tx_queue.put_nowait((txt, False, self._source))
                logger.debug("转录入队[%s]: %s", self._source, txt[:50])
            except Exception:
                pass

    async def _send_loop(self) -> None:
        while self._running:
            try:
                frame = await self._send_queue.get()
            except asyncio.CancelledError:
                break
            try:
                await self._ws.send(frame)
            except (websockets.exceptions.ConnectionClosed, Exception):
                self._running = False
                break

    async def _recv_loop(self) -> None:
        """接收 ASR 结果。is_final 忽略——断句由静音监控统一处理。"""
        logger.info("ASR 接收循环已启动")
        try:
            async for raw in self._ws:
                if isinstance(raw, str):
                    continue
                if len(raw) < HDR:
                    continue

                msg_type = (raw[1] >> 4) & 0x0F
                flags = raw[1] & 0x0F
                comp = raw[2] & 0x0F
                body = raw[HDR + SEQ + SIZ:]

                if msg_type == 0b1001:
                    ack_body = raw[HDR:]
                    json_start = ack_body.find(b"{")
                    if json_start > 0:
                        try:
                            ack_json = json.loads(ack_body[json_start:].decode("utf-8"))
                            result = ack_json.get("result", {})
                            txt = result.get("text", "")
                            if txt and txt != self._last_sent_full:
                                logger.info("ASR[%s]: %s", self._source, txt)
                                self._enqueue(txt)
                        except Exception:
                            pass
                    continue

                if msg_type == 0b1111:
                    if comp == 0b0001:
                        body = gzip.decompress(body)
                    text = body.decode("utf-8", errors="replace")
                    brace = text.find("{")
                    if brace > 0:
                        text = text[brace:]
                    try:
                        resp = json.loads(text)
                    except Exception:
                        continue

                    if "error" in resp:
                        logger.debug("ASR 错误: %s", resp.get("error", "")[:200])
                        continue

                    result = resp.get("result", {})
                    txt = result.get("text", "")
                    if txt:
                        logger.info("ASR[%s]: %s", self._source, txt)
                        self._enqueue(txt)

                    if flags == 0b0011:
                        return

        except websockets.exceptions.ConnectionClosed:
            pass
        except Exception as exc:
            logger.error("ASR 接收循环异常: %s", exc)

    async def _silence_monitor(self) -> None:
        """静音检测：1s 无音频 → 发 is_final=True → 断开连接（不重连）。"""
        try:
            while self._running:
                await asyncio.sleep(SILENCE_CHECK_INTERVAL)
                if not self._running:
                    break
                elapsed = time.monotonic() - self._last_audio_time
                if elapsed >= SILENCE_THRESHOLD and self._last_sent_full:
                    logger.info("ASR[%s] 静音 %.1fs，断句", self._source, elapsed)
                    # 发 is_final=True 告知前端
                    try:
                        self._tx_queue.put_nowait(
                            (self._last_sent_full, True, self._source)
                        )
                    except asyncio.QueueFull:
                        pass
                    # 断连（不重连——等 feed 触发）
                    await self._disconnect()
                    break
        except asyncio.CancelledError:
            pass

    async def _disconnect(self) -> None:
        """关闭 WebSocket 并清理任务，不触发重连。"""
        self._running = False
        current = asyncio.current_task()
        for task in (self._silence_task, self._send_task, self._recv_task):
            if task and not task.done() and task is not current:
                task.cancel()
        ws = self._ws  # 保存本地引用——防止 await 期间被 connect() 覆盖
        if ws:
            try:
                await asyncio.wait_for(ws.send(
                    _header(0b0010, 0b0011, 0, 0)
                    + struct.pack(">i", -self._seq)
                    + struct.pack(">I", 0)
                ), timeout=3.0)
            except Exception:
                pass
            try:
                await asyncio.wait_for(ws.close(), timeout=3.0)
            except Exception:
                pass
        # 仅当没被 _do_restart 换成新连接时才清空
        if self._ws is ws:
            self._ws = None

    async def _do_restart(self) -> None:
        """feed() 触发——收到断句后第一帧音频时重连，完成后回放缓存帧。"""
        try:
            logger.info("ASR[%s] 重新连接中…", self._source)
            await asyncio.wait_for(self.connect(), timeout=8.0)
            self._restart_count += 1
            self._last_restart_attempt = 0.0  # 成功后归零，允许下次正常重启
        except asyncio.TimeoutError:
            logger.error("ASR[%s] 重连超时（8s）", self._source)
            self._restart_buffer.clear()
            self._restarting = False
            return
        except Exception:
            logger.exception("ASR[%s] 重连失败", self._source)
            self._restart_buffer.clear()
            self._restarting = False
            return

        # 先恢复 feed() 正常通路，再回放缓存帧。
        # 这样回放期间新来的帧由 feed() 直接发送，不再进 buffer 被 finally 清掉。
        frames = self._restart_buffer
        self._restart_buffer = []
        self._restarting = False

        logger.info("ASR[%s] 重连完成 #%d，回放 %d 帧",
                    self._source, self._restart_count, len(frames))
        for frame in frames:
            if not self._running:
                break
            try:
                seq_bytes = struct.pack(">I", self._seq)
                self._seq += 1
                self._send_queue.put_nowait(
                    _header(0b0010, 0b0001, 0, 0) + seq_bytes
                    + struct.pack(">I", len(frame)) + frame
                )
            except asyncio.QueueFull:
                pass
