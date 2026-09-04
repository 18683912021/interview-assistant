"""DeepSeek 流式回答服务。

SSE → AsyncGenerator[(chunk, is_final), ...]
不引入 openai SDK，用 httpx 原生 SSE 解析。
"""

import json
import logging
import os
from typing import AsyncGenerator

import httpx

from app.services.asr_text_corrector import correct_asr_text

logger = logging.getLogger("llm")

# ── 系统提示词模板 ──
# {intro} 由赛道 system_prompt_extra 注入
# {language_name} 由 LANGUAGE_INSTRUCTIONS 注入

_SYSTEM_PROMPT_TEMPLATE = """{intro}用户正在进行技术面试，收到的文字是通过**语音转文字**（ASR）实时转写的，可能存在以下典型错误：
- 技术术语被转成同音字（如"闭包"→"必报"、"React"→"瑞爱的"）
- 英文单词被拆成中文谐音字母（如"API"→"诶批挨"、"Django"→"江狗"）
- 数字和汉字混淆（如"事件"→"4件"、"ES6"→"ES六"）
- 断句错误或标点缺失

══════════════════════════════
第一步：纠正问题（必须执行）
══════════════════════════════
通读用户的问题 → 找出明显不通顺或不合理的地方 → 用发音相近的技术术语还原 → 确认这句话在技术上合理后，在回答开头输出纠正后的问题。

格式："你的问题是：{{{{纠正后的问题}}}}"

══════════════════════════════
第二步：以面试候选人口吻回答
══════════════════════════════
在纠正后的问题下方，以面试候选人口吻直接回答。不要套固定模板——面试官问任何问题，背后都在考察你对这个**知识领域的掌握深度**。你的回答应该让他觉得你不仅知道，而且理解透彻。

根据问题类型灵活组织，围绕以下维度展开（不是逐条罗列标题，而是自然融入回答）：

核心概念 —— 一句话讲清它是什么、解决什么问题
原理机制 —— 底层怎么运作的（内存模型、执行流程、引擎行为等）
关键细节 —— 容易忽略但面试官在意的点（参数陷阱、版本差异、边界条件）
应用场景 —— 真实开发中什么时候用它、为什么选它而非替代方案
常见误区 —— 新手易犯的错、面试高频挖坑点，以及正确做法
关联知识 —— 可以自然引申的相关概念，展示知识体系广度

规则：
- 先输出"你的问题是：{{{{纠正后的问题}}}}"，然后开始回答
- 面试口述感：专业、流畅、自信，像在面对面交流，不念教科书
- 代码示例精简有力，关键行加注释，不要大段堆砌
- 术语准确、句子完整、逻辑严谨，不编造经历
- 可用 markdown 格式化：**加粗**、`行内代码`、```代码块```、- 列表、> 引用
- 回答语言：{language_name}"""

LANGUAGE_INSTRUCTIONS: dict[str, str] = {
    "zh": "中文",
    "en": "English",
}

_DEFAULT_INTRO = "你是资深前端面试辅助 AI。"


def build_system_prompt(track_key: str | None = None, language: str = "zh") -> str:
    """根据赛道和语言构建系统提示词。"""
    from app.services.tracks import get_track
    track = get_track(track_key) if track_key else None
    intro = track.get("system_prompt_extra", _DEFAULT_INTRO) if track else _DEFAULT_INTRO
    lang_name = LANGUAGE_INSTRUCTIONS.get(language, "中文")
    return _SYSTEM_PROMPT_TEMPLATE.format(intro=intro, language_name=lang_name)


class LLMService:
    """封装 DeepSeek Chat API 流式调用。"""

    def __init__(self) -> None:
        self._api_key = os.getenv("ANTHROPIC_API_KEY", "")
        self._base_url = "https://api.deepseek.com/v1/chat/completions"
        self._client: httpx.AsyncClient | None = None

    @property
    def ready(self) -> bool:
        return bool(self._api_key)

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(30.0, connect=5.0),
                http2=True,
            )
        return self._client

    async def warmup(self) -> None:
        """预热 DeepSeek 链路（HTTP2 握手 + 首包探测）。

        实测首次请求含连接建立约 1.1s；在面试开始时预热，首个 llm_query 不再付该成本。
        失败静默（仅少 1.1s，不影响功能）。
        """
        try:
            client = await self._get_client()
            await client.get("https://api.deepseek.com/v1/models")
            logger.info("LLM warmup 完成（HTTP2 链路已预热）")
        except Exception:
            logger.warning("LLM warmup 失败（忽略，首次回答略慢）")

    async def stream_answer(
        self,
        question: str,
        model: str = "deepseek-v4-flash",
        max_tokens: int = 300,
        language: str = "zh",
        track: str | None = None,
    ) -> AsyncGenerator[tuple[str, bool], None]:
        """流式调用 DeepSeek。

        track: 编程语言赛道 key（javascript/python/java/...），用于加载赛道提示词。
        """
        if not self._api_key:
            raise RuntimeError("ANTHROPIC_API_KEY 未配置")

        # ── 代码级 ASR 纠正（微秒级） ──
        corrected = correct_asr_text(question, track)

        system_prompt = build_system_prompt(track, language)

        client = await self._get_client()

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"面试官问：{corrected}" if corrected != question else f"面试官问：{question}"},
        ]

        body = {
            "model": model,
            "messages": messages,
            "stream": True,
            "max_tokens": max_tokens,
            "temperature": 0.3,
        }

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }

        logger.info("LLM 请求: model=%s tokens=%d q=%.60s", model, max_tokens,
                     corrected if corrected != question else question)

        try:
            async with client.stream("POST", self._base_url, json=body, headers=headers) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    logger.error("DeepSeek API %d: %.300s", response.status_code, error_body)
                    raise RuntimeError(f"DeepSeek API returned {response.status_code}")

                async for line in response.aiter_lines():
                    if not line or not line.startswith("data: "):
                        continue

                    data_str = line[6:]
                    if data_str == "[DONE]":
                        yield ("", True)
                        return

                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    choices = data.get("choices", [])
                    if not choices:
                        continue

                    choice = choices[0]
                    delta = choice.get("delta", {})
                    content = delta.get("content", "")
                    finish_reason = choice.get("finish_reason")

                    if content:
                        yield (content, finish_reason == "stop")
                    elif finish_reason == "stop":
                        yield ("", True)

        except httpx.TimeoutException:
            logger.error("DeepSeek API 超时")
            raise RuntimeError("DeepSeek API 请求超时")

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
