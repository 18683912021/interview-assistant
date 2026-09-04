"""
PDF→DOCX 增强转换：PyMuPDF 提取文字+视觉元素 + DeepSeek 全量样式分析 + python-docx 重建。

v3: 加入横线/色块等视觉元素提取 + 精确坐标间距计算。
"""

from __future__ import annotations

import io, json, logging, os, re
from dataclasses import dataclass

import fitz
import httpx
from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

logger = logging.getLogger("pdf2docx_llm")

_STYLE_PROMPT = """分析 PDF 页面布局，只输出结构信息。不要输出任何字体、颜色、字号、样式——这些由程序精确处理。

文字行格式：[id=N x=X y=Y w=W sz=S font=F] "text..."

输出 JSON（不要 markdown），只包含结构：
{
  "title": "仅输出标题文字（可选）",
  "blocks": [
    {"ids":[1],"type":"heading","level":1},
    {"ids":[2,3],"type":"paragraph"},
    {"ids":[4,5,6],"type":"list","ordered":false},
    {"ids":[7,8],"type":"table","headers":["列1","列2"],"rows":[["a","b"],["c","d"]]},
    {"type":"separator"}
  ]
}

规则：
- 文字块：合并同一段落的 ids。相邻、x对齐、字号相近的id合并为 paragraph
- 标题：字号明显大于正文（>14pt）或粗体独立成行 → heading
- 表格：x/y 坐标形成行列网格 → table。用 raw_ids 标出每个单元格的 span id
- 列表：有编号前缀(1./2./或•) 且缩进一致 → list
- 横线 (H-line)：→ type:"separator"
- 色块/图片：→ type:"decoration" 或 "image"。只输出位置不猜内容
- 只输出 JSON，不要其他文字
- ids 按阅读顺序排列
- 不要输出任何字体名、颜色值、字号值"""


@dataclass
class RawLine:
    id: int; text: str
    x: float; y: float; y2: float; w: float
    size: float; bold: bool; color: str; font: str


@dataclass
class VisualElem:
    type: str       # "hline" | "rect"
    y: float        # 用于排序
    bbox: tuple[float, float, float, float]
    color: str      # hex
    thickness: float = 1.0


class PDFToDOCXLLMConverter:

    def __init__(self, pdf_bytes: bytes):
        self._pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        self._api_key = os.getenv("ANTHROPIC_API_KEY", "")
        self._api_url = "https://api.deepseek.com/v1/chat/completions"

    async def convert(self) -> bytes:
        if not self._api_key:
            raise RuntimeError("ANTHROPIC_API_KEY 未配置")

        lines, visuals = self._extract_all()
        if not lines and not visuals:
            buf = io.BytesIO(); Document().save(buf); return buf.getvalue()

        style_spec = await self._analyze(lines, visuals)
        return self._build_docx(style_spec, lines, visuals)

    # ── 提取 ──────────────────────────────────────────────

    def _extract_all(self) -> tuple[list[RawLine], list[VisualElem]]:
        lines: list[RawLine] = []
        visuals: list[VisualElem] = []
        lid = 0

        for pn in range(len(self._pdf_doc)):
            page = self._pdf_doc[pn]
            # 文字
            pd = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
            for block in pd.get("blocks", []):
                if block.get("type") != 0: continue
                for line in block.get("lines", []):
                    spans = line.get("spans", [])
                    if not spans: continue
                    text = "".join(s.get("text","") for s in spans)
                    if not text.strip(): continue
                    s0 = spans[0]; bbox = line["bbox"]
                    raw_font = s0.get("font", "SimSun")
                    lid += 1
                    lines.append(RawLine(id=lid, text=text, x=bbox[0], y=bbox[1],
                                         y2=bbox[3], w=bbox[2]-bbox[0],
                                         size=round(s0.get("size", 10), 1),
                                         bold=bool(s0.get("flags", 0) & 8),
                                         color=_span_color(s0),
                                         font=_clean_font(raw_font)))

            # 视觉元素：全部推给 DeepSeek 判断
            try:
                drawings = page.get_drawings()
            except Exception:
                continue
            for d in drawings:
                r = d["rect"]
                w = r.x1 - r.x0; h = r.y1 - r.y0
                fill = d.get("fill", "")
                fill_hex = _rgba_to_hex(fill) if fill else ""
                stroke = d.get("color", "")
                stroke_hex = _rgba_to_hex(stroke) if stroke else ""
                opacity = d.get("fill_opacity", 1.0)

                # 跳过不可见的元素
                if opacity < 0.05 and not stroke:
                    continue
                # 跳过极小点（通常是 PDF 渲染噪声）
                if w < 2 and h < 2:
                    continue

                if h < 6 and w > 100:
                    # 横线条：分隔线或下划线装饰
                    color = fill_hex or stroke_hex or "#CCCCCC"
                    visuals.append(VisualElem("hline", r.y0, (r.x0,r.y0,r.x1,r.y1), color, h))
                elif fill and opacity > 0.1:
                    # 有色块
                    visuals.append(VisualElem("rect", r.y0, (r.x0,r.y0,r.x1,r.y1), fill_hex, h))
                elif stroke and not fill:
                    # 只有边框（可能是框线或图片占位框）
                    visuals.append(VisualElem("rect", r.y0, (r.x0,r.y0,r.x1,r.y1), stroke_hex, h))

            # 图片提取
            img_list = page.get_images(full=True)
            for img_info in img_list:
                xref = img_info[0]
                rects = page.get_image_rects(xref)
                for rect in rects:
                    if rect.is_empty or rect.is_infinite:
                        continue
                    visuals.append(VisualElem("image", rect.y0,
                        (rect.x0, rect.y0, rect.x1, rect.y1), "#000000",
                        rect.y1 - rect.y0))

        # 按 y 排序
        visuals.sort(key=lambda v: v.y)
        return lines, visuals

    # ── DeepSeek ──────────────────────────────────────────

    async def _analyze(self, lines: list[RawLine], visuals: list[VisualElem]) -> dict:
        """布局分析：先走纯规则，速度快且准确。"""
        if not lines:
            return {"blocks": []}

        # 排序：先 Y 再 X
        sorted_lines = sorted(lines, key=lambda l: (l.y, l.x))
        blocks = []

        # ── 计算正文平均字号 ──
        sizes = [l.size for l in sorted_lines]
        avg_size = sum(sizes) / len(sizes) if sizes else 10

        # ── 段落合并：相近 Y、相同 X 起点 → 同段 ──
        i = 0
        while i < len(sorted_lines):
            cur = sorted_lines[i]
            merged = [cur.id]

            j = i + 1
            while j < len(sorted_lines):
                nxt = sorted_lines[j]
                # 同行或极近行（<2pt）→ 同段落
                if nxt.y - cur.y2 < max(cur.size * 0.5, 2):
                    merged.append(nxt.id)
                    cur = nxt
                    j += 1
                else:
                    break

            # 判断类型
            first = sorted_lines[i]
            btype = "paragraph"
            level = 0
            is_list = False
            is_ordered = False

            # 标题：字号 > 平均 1.3 倍 且粗体 / 字号 > 平均 1.5 倍
            if first.size >= avg_size * 1.5 or (first.size >= avg_size * 1.3 and first.bold):
                btype = "heading"
                level = 1 if first.size >= avg_size * 1.8 else 2
            # 列表：有编号前缀(1./一、)或 bullet(• - ·) 且左边缩进
            elif _looks_like_list_item(first.text):
                btype = "list"
                is_ordered = bool(re.match(r'^\s*\d+[\.\)、]', first.text))

            blocks.append({
                "ids": merged,
                "type": btype,
                **({"level": level} if btype == "heading" else {}),
                **({"ordered": is_ordered} if btype == "list" else {}),
            })
            i = j

        # ── 表格检测：X 坐标形成列对齐的连续行 ──
        blocks = _detect_tables(blocks, sorted_lines)

        title = sorted_lines[0].text if sorted_lines and sorted_lines[0].size >= avg_size * 1.8 else ""
        logger.info("规则分析完成: %d lines → %d blocks", len(lines), len(blocks))
        return {"title": title, "blocks": blocks}

    # ── DOCX 重建 ─────────────────────────────────────────

    def _build_docx(self, spec: dict, lines: list[RawLine], visuals: list[VisualElem]) -> bytes:
        doc = Document()
        doc.sections[0].page_width = Cm(21.0)
        doc.sections[0].page_height = Cm(29.7)

        line_db = {l.id: l for l in lines}
        blocks = spec.get("blocks", [])

        # ── 确保所有 span 都被覆盖 ──
        covered: set[int] = set()
        for b in blocks:
            for lid in b.get("ids", []):
                covered.add(lid)
        orphan_ids = sorted(set(line_db.keys()) - covered)
        for oid in orphan_ids:
            ln = line_db[oid]
            insert_at = len(blocks)
            for bi, b in enumerate(blocks):
                bids = b.get("ids", [])
                if bids:
                    bl = line_db.get(bids[0])
                    if bl and ln.y < bl.y: insert_at = bi; break
            blocks.insert(insert_at, {"ids": [oid], "type": "paragraph"})

        # ── 按第一个 id 的 y 排序 ──
        def _y(b):
            ids = b.get("ids", [])
            if ids: return (line_db.get(ids[0]) or lines[0]).y
            return b.get("y", 0)
        blocks.sort(key=_y)

        # ── 渲染 ──
        for block in blocks:
            btype = block.get("type", "paragraph")
            ids = block.get("ids", [])

            if btype == "separator":
                self._add_sep(doc)
                continue

            if btype == "image" or btype == "photo":
                continue  # 图片暂跳过

            if btype == "table":
                self._add_table(doc, block, line_db)
                continue

            if not ids:
                continue

            # ── 文字块：逐 span 按 PyMuPDF 精确样式写入 ──
            p = doc.add_paragraph()
            is_heading = btype == "heading"
            is_list = btype == "list"
            ordered = block.get("ordered", False)
            list_idx = 0

            for lid in ids:
                ln = line_db.get(lid)
                if not ln: continue

                text = ln.text
                if is_list:
                    list_idx += 1
                    prefix = f"{list_idx}. " if ordered else "• "
                    text = prefix + text
                    p.paragraph_format.left_indent = Cm(1.0)

                r = p.add_run(text)
                # PyMuPDF 精确样式
                r.font.name = ln.font
                r.font.size = Pt(ln.size)
                r.bold = ln.bold
                try:
                    r.font.color.rgb = RGBColor(
                        int(ln.color[1:3], 16), int(ln.color[3:5], 16), int(ln.color[5:7], 16))
                except: pass
                # w:eastAsia 确保中文不丢字体
                rPr = r._element.get_or_add_rPr()
                rFonts = rPr.get_or_add_rFonts()
                rFonts.set(qn('w:eastAsia'), ln.font)

            if is_heading:
                for run in p.runs:
                    if run.font.size < Pt(14):
                        run.font.size = Pt(15)
                    run.bold = True

        buf = io.BytesIO(); doc.save(buf); return buf.getvalue()

    def _add_sep(self, doc):
        p = doc.add_paragraph()
        pf = p.paragraph_format; pf.space_before = Pt(4); pf.space_after = Pt(4)
        pPr = p._p.get_or_add_pPr()
        pBdr = OxmlElement('w:pBdr')
        bot = OxmlElement('w:bottom')
        bot.set(qn('w:val'), 'single'); bot.set(qn('w:sz'), '4')
        bot.set(qn('w:space'), '1'); bot.set(qn('w:color'), 'CCCCCC')
        pBdr.append(bot); pPr.append(pBdr)

    def _add_table(self, doc, block: dict, line_db: dict):
        headers = block.get("headers", [])
        rows = block.get("rows", [])
        all_rows = ([headers] if headers else []) + rows
        if not all_rows: return
        table = doc.add_table(rows=len(all_rows), cols=len(all_rows[0]))
        table.style = 'Table Grid'
        for ri, row in enumerate(all_rows):
            for ci, cell_text in enumerate(row):
                cell = table.cell(ri, ci)
                cell.text = str(cell_text) if cell_text else ""
                for para in cell.paragraphs:
                    for run in para.runs:
                        run.font.name = "SimSun"
                        rPr = run._element.get_or_add_rPr()
                        rPr.get_or_add_rFonts().set(qn('w:eastAsia'), 'SimSun')
                        run.font.size = Pt(10)

    def _add_image_block(self, doc, block, visuals_sorted, used_visuals, page_w=595):
        """在 DOCX 中嵌入图片。"""
        target_y = block.get("y", 0)
        best_vi = None
        for vi, v in enumerate(visuals_sorted):
            if vi in used_visuals or v.type != "image": continue
            if abs(v.y - target_y) < 25:
                best_vi = vi; break
        if best_vi is None:
            p = doc.add_paragraph(); p.alignment = 1; return

        used_visuals.add(best_vi)
        x0, y0, x1, y1 = visuals_sorted[best_vi].bbox
        for pn in range(len(self._pdf_doc)):
            for info in self._pdf_doc[pn].get_images(full=True):
                xref = info[0]
                for rect in self._pdf_doc[pn].get_image_rects(xref):
                    if abs(rect.y0 - y0) < 5 and abs(rect.x0 - x0) < 5:
                        try:
                            img_bytes = self._pdf_doc.extract_image(xref).get("image")
                            if img_bytes:
                                p = doc.add_paragraph(); p.alignment = 1
                                p.add_run().add_picture(io.BytesIO(img_bytes),
                                    width=Cm(min((x1-x0)/72*2.54, 5.0)))
                                doc.add_paragraph()
                                return
                        except Exception:
                            pass
        p = doc.add_paragraph(); p.alignment = 1


# ── 工具函数 ────────────────────────────────────────────

def _clean_font(raw: str) -> str:
    """去掉 PDF 内嵌字体前缀 ABCDEE+ → 纯字体名"""
    return re.sub(r'^[A-Z]{6}\+', '', raw)

def _span_color(span: dict) -> str:
    """PyMuPDF span color → #RRGGBB，黑色统一为 #333333"""
    c = span.get("color", 0) or 0
    if c == 0: return "#333333"
    r, g, b = (c >> 16) & 0xFF, (c >> 8) & 0xFF, c & 0xFF
    if r < 20 and g < 20 and b < 20: return "#333333"
    return f"#{r:02X}{g:02X}{b:02X}"

def _looks_like_list_item(text: str) -> bool:
    """判断是否像列表项（编号/符号前缀）"""
    return bool(re.match(
        r'^\s*(\d+[\.\)、]|[一二三四五六七八九十]+[、．]|[a-zA-Z][\.\)]|[-•·▪▸►✓✅])\s',
        text
    ))

def _detect_tables(blocks: list[dict], lines: list[RawLine]) -> list[dict]:
    """检测明显表格：X 坐标形成至少 2 列对齐的连续行"""
    line_db = {l.id: l for l in lines}
    i = 0
    result = []
    while i < len(blocks):
        block = blocks[i]
        ids = block["ids"]
        if len(ids) < 2 or block["type"] != "paragraph":
            result.append(block); i += 1; continue

        # 检查连续 2+ 个 block 是否有列对齐
        consecutive = [block]
        j = i + 1
        while j < len(blocks) and blocks[j]["type"] == "paragraph":
            nxt_ids = blocks[j]["ids"]
            if len(nxt_ids) == len(ids):
                # 检查 X 坐标是否对齐
                aligned = True
                for k in range(len(ids)):
                    a = line_db.get(ids[k]); b = line_db.get(nxt_ids[k])
                    if a and b and abs(a.x - b.x) > 5:
                        aligned = False; break
                if aligned:
                    consecutive.append(blocks[j])
                    j += 1; continue
            break

        if len(consecutive) >= 2:
            # 转为表格
            rows = []
            for cb in consecutive:
                row = []
                for lid in cb["ids"]:
                    ln = line_db.get(lid)
                    row.append(ln.text.strip() if ln else "")
                rows.append(row)
            result.append({"type": "table", "rows": rows})
            i = j
        else:
            result.append(block); i += 1

    return result

def _rgba_to_hex(rgba) -> str:
    """PyMuPDF 颜色 → #RRGGBB"""
    if isinstance(rgba, (list, tuple)) and len(rgba) >= 3:
        return f"#{int(rgba[0]*255):02X}{int(rgba[1]*255):02X}{int(rgba[2]*255):02X}"
    return "#CCCCCC"


def _contrast_color(bg_hex: str) -> str:
    """深色背景返回白色文字，浅色返回黑色"""
    try:
        r = int(bg_hex[1:3], 16); g = int(bg_hex[3:5], 16); b = int(bg_hex[5:7], 16)
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        return "#FFFFFF" if lum < 128 else "#000000"
    except:
        return "#000000"


def _parse_json(content: str) -> dict:
    content = content.strip()
    m = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', content, re.DOTALL)
    if m: content = m.group(1).strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        # JSON 被截断：尝试修复最后一个不完整的 block/string
        # 找到最后一个完整的 }
        last_brace = content.rfind('}')
        if last_brace > 0:
            fixed = content[:last_brace + 1] + '\n]}'
            try:
                result = json.loads(fixed)
                logger.warning("JSON 被截断，已修复到 %d chars（原始 %d chars）", len(fixed), len(content))
                return result
            except json.JSONDecodeError:
                pass
        # 实在修不了，返回最小可用结构
        logger.error("JSON 无法解析, 长度=%d, 前 500 字符: %r", len(content), content[:500])
        return {"blocks": []}
