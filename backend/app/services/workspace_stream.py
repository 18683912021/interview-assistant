"""Cancellation-safe HTTP streaming shared by desktop preparation and live answers."""
import json
import logging
from time import monotonic

from fastapi import HTTPException
from starlette.responses import StreamingResponse

logger = logging.getLogger(__name__)


def record(kind, text="", **extra):
    return json.dumps({"type": kind, "text": text, **extra}, ensure_ascii=False) + "\n"


def stream_response(iterator):
    return StreamingResponse(iterator, media_type="application/x-ndjson", headers={
        "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no",
    })


async def text_events(iterator, save=None):
    started, first, text = monotonic(), None, ""
    try:
        async for chunk in iterator:
            if chunk:
                if first is None:
                    first = round((monotonic() - started) * 1000)
                text += chunk
                yield record("delta", chunk)
        if not text.strip():
            raise HTTPException(502, "AI 未返回正文，请重试")
        metadata = await save(text) if save else {}
        yield record("done", **(metadata or {}))
    except HTTPException as error:
        yield record("error", str(error.detail))
    except Exception:
        logger.exception("Workspace stream failed")
        yield record("error", "生成中断，已保留收到的内容，请重试")
    finally:
        await iterator.aclose()
        logger.info("Workspace stream first_ms=%s total_ms=%d characters=%d", first, round((monotonic() - started) * 1000), len(text))


async def completion_events(operation):
    """Adapt transactional review generation without storing a cancelled partial review."""
    import asyncio
    from app.services.workspace_llm import stream_text
    queue = asyncio.Queue(maxsize=32)
    emitted = False

    async def completion(system, user):
        nonlocal emitted
        text = ""
        async for chunk in stream_text(system, user):
            text += chunk
            emitted = True
            await queue.put(record("delta", chunk))
        return text

    async def produce():
        try:
            result = await operation(completion)
            if not emitted:
                await queue.put(record("delta", result["text"]))  # cached review
            await queue.put(record("done", created_at=result["created_at"]))
        except HTTPException as error:
            await queue.put(record("error", str(error.detail)))
        except Exception:
            logger.exception("Review stream failed")
            await queue.put(record("error", "复盘生成失败，已保留收到的内容，请重试"))
        finally:
            # Never block cancellation while the consumer has gone away.
            if not asyncio.current_task().cancelling():
                await queue.put(None)

    task = asyncio.create_task(produce())
    try:
        while True:
            event = await queue.get()
            if event is None:
                break
            yield event
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
