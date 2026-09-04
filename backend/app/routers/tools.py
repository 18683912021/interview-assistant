"""小工具接口 —— 文件格式转换。

Word→PDF：dxpdf（优先）+ zip 内 XML 预处理（去 hyperlink/AlternateContent）
PDF→Word：pdf2docx
"""

import base64
import logging
import re
import shutil
import tempfile
import zipfile
from io import BytesIO
from pathlib import Path
from urllib.parse import quote

import dxpdf
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from app.routers.auth import get_current_user

logger = logging.getLogger("tools")
router = APIRouter()

_MAX_SIZE = 20 * 1024 * 1024
_WORD_EXTENSIONS = {'.docx'}


class FileData(BaseModel):
    filename: str
    data: str


@router.post("/tools/word-to-pdf")
async def word_to_pdf(body: FileData, _email: str = Depends(get_current_user)):
    """文档 → PDF"""
    ext = Path(body.filename).suffix.lower()
    if ext not in _WORD_EXTENSIONS:
        raise HTTPException(400, f"仅支持文档格式：{' / '.join(_WORD_EXTENSIONS)}")
    content = base64.b64decode(body.data)
    if len(content) > _MAX_SIZE:
        raise HTTPException(400, "文件过大（不超过 20MB）")
    if content[:2] != b'PK':
        raise HTTPException(400, "文件格式无法识别")

    for attempt in range(3):
        try:
            pdf_bytes = dxpdf.convert(content)
            break
        except RuntimeError as e:
            if attempt == 2:
                raise
            logger.warning("dxpdf 第 %d 次失败，清理重试", attempt + 1)
            content = _sanitize_docx(content, str(e))

    name = Path(body.filename).stem + ".pdf"
    return Response(content=pdf_bytes, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"})


@router.post("/tools/pdf-to-word")
async def pdf_to_word(body: FileData, _email: str = Depends(get_current_user)):
    """PDF → Word"""
    if not body.filename.lower().endswith('.pdf'):
        raise HTTPException(400, "仅支持 .pdf 格式")
    content = base64.b64decode(body.data)
    if len(content) > _MAX_SIZE:
        raise HTTPException(400, "文件过大（不超过 20MB）")
    try:
        from pdf2docx import Converter
    except ImportError:
        raise HTTPException(503, "pdf2docx 库未安装")
    tmp = Path(tempfile.mkdtemp())
    src = tmp / "input.pdf"
    src.write_bytes(content)
    out = tmp / "output.docx"
    cv = Converter(str(src))
    cv.convert(str(out))
    cv.close()
    docx_bytes = out.read_bytes()
    shutil.rmtree(tmp, ignore_errors=True)
    name = Path(body.filename).stem + ".docx"
    return Response(content=docx_bytes,
                    media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"})


@router.post("/tools/pdf-to-word-llm")
async def pdf_to_word_llm(body: FileData, _email: str = Depends(get_current_user)):
    """PDF → Word（DeepSeek 增强：LLM 分析文档结构 + python-docx 重建）"""
    if not body.filename.lower().endswith('.pdf'):
        raise HTTPException(400, "仅支持 .pdf 格式")
    content = base64.b64decode(body.data)
    if len(content) > _MAX_SIZE:
        raise HTTPException(400, "文件过大（不超过 20MB）")

    try:
        from app.services.pdf_to_docx_llm import PDFToDOCXLLMConverter
    except ImportError:
        raise HTTPException(503, "LLM 转换服务未就绪")

    converter = PDFToDOCXLLMConverter(content)
    docx_bytes = await converter.convert()

    name = Path(body.filename).stem + ".docx"
    return Response(content=docx_bytes,
                    media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"})


def _sanitize_docx(content: bytes, error: str) -> bytes:
    """根据 dxpdf 报错去掉不支持的元素。"""
    # 从错误信息中提取未知元素名
    m = re.search(r"unknown variant `(\w+)'", error)
    bad_tag = m.group(1) if m else None
    logger.info("清理不支持的元素: %s", bad_tag)

    buf = BytesIO()
    with zipfile.ZipFile(BytesIO(content), 'r') as zin:
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                data = zin.read(item.filename)
                if item.filename.startswith('word/') and item.filename.endswith('.xml'):
                    text = data.decode('utf-8', errors='replace')
                    # 总是去掉 AlternateContent
                    text = re.sub(r'<mc:AlternateContent[^>]*>.*?</mc:AlternateContent>', '', text, flags=re.DOTALL)
                    # 根据报错去掉对应标签（保留内部文字）
                    if bad_tag:
                        text = re.sub(rf'<\w+:{bad_tag}\b[^>]*>', '', text)
                        text = re.sub(rf'</\w+:{bad_tag}>', '', text)
                    data = text.encode('utf-8')
                zout.writestr(item, data)
    return buf.getvalue()
