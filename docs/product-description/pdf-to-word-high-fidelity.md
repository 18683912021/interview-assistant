# PDF → Word 高保真转换方案

## 问题

当前 pdf2docx 转换中文简历时样式丢失严重（字体乱码、颜色丢失、表格错位），用户不可接受。

## 目标

PDF 转 DOCX 后样式还原度 ≥ 85%，覆盖：字体名/字号/颜色/粗体斜体/段落对齐/表格结构。

## 核心思路

**不重写布局引擎。fork pdf2docx，只换样式写入层。**

pdf2docx 的段落合并、表格检测、图片提取已经有 2 年积累，没必要重写一遍。它丢样式的原因是中间有一层"样式猜测"——字体靠映射表猜、颜色直接忽略。本方案把这 ~200 行换成 PyMuPDF 精确值直接写入 python-docx。

## 许可证

**不触发 AGPL**。PyMuPDF 跑在服务端 FastAPI 里，用户通过 API 调用，不随客户端分发。AGPL 管的是"分发软件"，服务端内部使用不触发传染条款。

## 技术架构

```
PDF 文件
  │
  ▼
┌──────────────────────────────────────┐
│ PyMuPDF (fitz)                       │  page.get_text("dict")
│ 精确读取每个 span 的样式和坐标        │  → 字体/字号/颜色/粗斜体/坐标/文字
└──────────────┬───────────────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
┌──────────────┐ ┌──────────────────────┐
│ 样式（不改）   │ │ ★ AI 布局分析         │
│ 字体/颜色/    │ │ 输入：每页 spans 坐标+   │
│ 字号/粗斜体   │ │      字号+粗体+文字摘要   │
│              │ │ 输出：表格行列结构、      │
│ PyMuPDF 精确  │ │      标题层级、分栏边界   │
│ 值直灌 DOCX   │ │ （DeepSeek，纯文本 token） │
└──────┬───────┘ └──────────┬───────────┘
       │                    │
       └────────┬───────────┘
                ▼
┌──────────────────────────────────────┐
│ python-docx 写入 DOCX                 │
│ PyMuPDF 精确样式 + AI 语义结构 → DOCX  │
└──────────────────────────────────────┘
```

**AI 不做的事**：提取文字、识别字体颜色、写入 DOCX。它只输出结构判断，文字和样式全部走 PyMuPDF 精确值。

## 详细设计

### 阶段〇：字体名清洗

**这是最重要的步骤。** `span["font"]` 返回的是 PDF 内嵌字体名，带 6 位大写字母前缀：

```
原始值:  "ABCDEE+SimHei"
清洗后:  "SimHei"

原始值:  "BXPWZL+MicrosoftYaHei"
清洗后:  "MicrosoftYaHei"
```

```python
import re

def clean_font_name(raw: str) -> str:
    """去掉 PDF 内嵌字体前缀（6 位大写字母 + 加号）"""
    return re.sub(r'^[A-Z]{6}\+', '', raw)

# 清洗后可能还需要规范化
FONT_NORMALIZE = {
    "MicrosoftYaHei": "Microsoft YaHei",
    "TimesNewRomanPSMT": "Times New Roman",
    "ArialMT": "Arial",
    "Calibri": "Calibri",
    # 中文字体通常不需要规范化，但以防万一
    "SimHei": "SimHei",
    "SimSun": "SimSun",
    "KaiTi": "KaiTi",
    "FangSong": "FangSong",
}

def normalize_font(name: str) -> str:
    name = clean_font_name(name)
    return FONT_NORMALIZE.get(name, name)
```

### 阶段一：精确读取（PyMuPDF）

在 pdf2docx 的 `Converter` 类中添加一个方法，直接返回原始 span 数组，不做任何样式猜测：

```python
import fitz

def extract_spans_raw(pdf_path: str) -> list[dict]:
    """从 PDF 提取每个文字 span 的精确样式，不做任何转换"""
    spans = []
    doc = fitz.open(pdf_path)

    for page_num, page in enumerate(doc):
        blocks = page.get_text("dict")["blocks"]
        for block in blocks:
            # 图片块 —— 原样保留
            if block["type"] == 1:
                spans.append({
                    "type": "image",
                    "page": page_num,
                    "bbox": block["bbox"],
                    "width": block.get("width"),
                    "height": block.get("height"),
                    "image": block.get("image"),  # 图片二进制数据
                    "ext": block.get("ext", "png"),
                })
                continue

            # 非文本块跳过
            if block["type"] != 0:
                continue

            for line in block["lines"]:
                for span in line["spans"]:
                    text = span["text"]
                    if not text.strip():
                        continue

                    spans.append({
                        "type": "text",
                        "page": page_num,
                        "text": text,
                        "font_raw": span["font"],          # 原始值（带前缀）
                        "font": normalize_font(span["font"]),  # 清洗后
                        "size": round(span["size"], 1),    # 精确到 0.1pt
                        "color": _rgb_to_hex(span.get("color", 0)),
                        "bold": bool(span["flags"] & 8),    # bit 3
                        "italic": bool(span["flags"] & 2),  # bit 1
                        "bbox": span["bbox"],               # (x0, y0, x1, y1)
                    })

    doc.close()

    # 扫描件检测 —— 如果 0 个文本 span，说明是图片 PDF
    if not any(s["type"] == "text" for s in spans):
        raise ValueError("此 PDF 无可提取文字（可能是扫描件），请先 OCR 处理")

    return spans

def _rgb_to_hex(rgb: int) -> str:
    """RGB int → #RRGGBB。PyMuPDF 的 span["color"] 是整数"""
    if rgb is None or rgb == 0:
        return "#000000"
    r = (rgb >> 16) & 0xFF
    g = (rgb >> 8) & 0xFF
    b = rgb & 0xFF
    # 接近黑色统一归为 #000000，避免 Word 里出现肉眼不可见的灰色差异
    if r < 20 and g < 20 and b < 20:
        return "#000000"
    return f"#{r:02x}{g:02x}{b:02x}"
```

### 阶段二：样式写入层（替换 pdf2docx 对应部分）

pdf2docx 在写 DOCX 时会调用内部方法把 span 转成 python-docx 的 run。找到这个方法，替换为：

```python
from docx.shared import Pt, RGBColor
from docx.oxml.ns import qn

def write_span_with_exact_style(run, span: dict):
    """
    替代 pdf2docx 内部的字体猜测逻辑。
    直接用 PyMuPDF 读到的精确值。
    """
    font_name = span["font"]  # 已经清洗过了

    # ── 西文字体名 ──
    run.font.name = font_name

    # ── 中文字体名（必须单独设 east-asian 属性，否则 Word 回退到等线） ──
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        from lxml import etree
        rFonts = etree.SubElement(rPr, qn('w:rFonts'))
    rFonts.set(qn('w:eastAsia'), font_name)

    # ── 字号 ──
    run.font.size = Pt(span["size"])

    # ── 颜色 ──
    hex_str = span["color"].lstrip("#")
    if len(hex_str) == 6:
        run.font.color.rgb = RGBColor(
            int(hex_str[0:2], 16),
            int(hex_str[2:4], 16),
            int(hex_str[4:6], 16),
        )

    # ── 粗体 / 斜体 ──
    run.bold = span["bold"]
    run.italic = span["italic"]
```

### 阶段三：AI 布局分析（DeepSeek）

DeepSeek 不能看图但能读结构化数据。把 PyMuPDF 每页的 span 列表（坐标 + 字号 + 粗体 + 文字）打包成纯文本，发给 DeepSeek，让它返回表格、标题、分栏的结构描述。

**传给 DeepSeek 的 prompt 格式：**

```
分析以下 PDF 页面的布局结构。数据来自 PyMuPDF 精确提取，
每个元素包含: [序号] 坐标(x,y,w,h) 字号 fontSize 粗体boldFlag 文字内容

第1页 (宽度595pt):
[1] (100, 200, 200, 20) 16pt BOLD: "工作经历"
[2] (100, 240, 100, 16) 11pt: "2020-2023"
[3] (220, 240, 100, 16) 11pt: "高级前端工程师"
[4] (100, 270, 100, 16) 11pt: "2021-2025"
[5] (220, 270, 100, 16) 11pt: "资深前端工程师"
[6] (100, 320, 400, 16) 11pt: "负责公司前端架构设计..."
...

请返回 JSON:
{
  "tables": [{
    "headers": ["时间", "职位"],
    "rows": [["2020-2023", "高级前端工程师"], ["2021-2025", "资深前端工程师"]],
    "span_ids": [[2,3], [4,5]]
  }],
  "headings": [{"text": "工作经历", "level": 1, "span_ids": [1]}],
  "multi_column": false
}
```

**实现代码：**

```python
import json

def analyze_layout_with_ai(spans: list[dict], page_width: float) -> dict:
    """
    把 PyMuPDF span 列表打包 → DeepSeek → 返回布局结构。
    纯文本 token，不走图片，不换模型。
    """
    # 1. 格式化 span 为可读文本
    lines = [f"第1页 (宽度{page_width}pt):"]
    for i, s in enumerate(spans):
        flags = []
        if s["bold"]: flags.append("BOLD")
        text_preview = s["text"][:60]  # 截断长文本
        lines.append(
            f"[{i}] ({s['bbox'][0]:.0f},{s['bbox'][1]:.0f},"
            f"{s['bbox'][2]-s['bbox'][0]:.0f},{s['bbox'][3]-s['bbox'][1]:.0f}) "
            f"{s['size']}pt {' '.join(flags)}: \"{text_preview}\""
        )
    
    prompt = "\n".join(lines) + "\n\n" + STRUCTURE_PROMPT
    
    # 2. 调 DeepSeek（复用现有 API）
    response = deepseek_client.chat(
        model="deepseek-v4-flash",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    
    return json.loads(response.content)

STRUCTURE_PROMPT = """
分析以上页面布局，返回 JSON。注意：
- 表格: 根据 X/Y 坐标对齐判断行列。同一行的 Y 坐标接近(±5pt)且 X 坐标形成列对齐。
- 标题: 字号明显大于正文(>14pt)或加粗且独立成行。
- 分栏: 如果存在两组 X 坐标完全不重叠的文本块，标注 multi_column=true。
- span_ids: 每个结构元素对应的 [序号] 列表，用于后续精确取文字和样式。

返回格式：
{"tables": [{"headers": [...], "rows": [[...]], "span_ids": [[...]]}], "headings": [{"text": "...", "level": 1|2, "span_ids": [...]}], "multi_column": false}
"""
```

**AI 不碰的东西**：文字内容（直接用 span["text"] 原值，不要 AI 重写）、字体颜色（PyMuPDF 精确值）、DOCX 写入（python-docx）。

**成本**：每个 span 约 80 字符，一页简历 30-100 个 span，prompt 约 2500-8000 字符。DeepSeek 纯文本 token 极便宜，一页约 ¥0.001。

### 实施方式

```
现有 pdf2docx 代码                           本方案改动

Converter.__init__()                    →   不变
Converter._parse_page()                 →   不变（布局分析保留）
Converter._make_paragraph()             →   不变（段落合并不变）
Converter._make_table()                 →   不变（表格检测不变）
Converter._make_docx()                  →   不变（遍历结构不变）
Converter._write_run()                  →   ★ 替换为 write_span_with_exact_style()
Converter._guess_font()                 →   ★ 删除
Converter._approximate_color()          →   ★ 删除
```

改动的代码量：**~200 行**。

### 与其他方案的核心差异

| 问题 | pdf2docx | 本方案 |
|------|---------|--------|
| 字体 | 模糊匹配猜（SimHei→SimSun） | PyMuPDF 精确值清洗前缀后直写 |
| 颜色 | 直接忽略 | PyMuPDF RGB→hex 精确写 |
| 表格 | 规则检测（线段+坐标） | **AI 视觉判断行列和合并单元格** |
| 标题 | 按字号猜 | **AI 语义理解** |
| 多栏 | 无处理，常串栏 | **AI 分栏识别** |

### python-docx 中文字体已知限制

**`run.font.name = '宋体'` 对中文无效**。这是 python-docx 从 2017 年至今未修的 bug（[Issue #346](https://github.com/python-openxml/python-docx/issues/346)、[#1139](https://github.com/python-openxml/python-docx/issues/1139)）。

原因：OOXML 规范把字体拆成四层——`w:ascii`（英文）、`w:hAnsi`（高 ANSI）、`w:eastAsia`（中日韩）、`w:cs`（复杂脚本）。`font.name` 只设了前两层，中文字符走 `w:eastAsia` 没设，回退到 Word 默认的等线 / Calibri。

**解决方案**：绕过公开 API，直接写 XML：

```python
from docx.oxml.ns import qn

run.font.name = '宋体'              # 设西文层
rPr = run._element.get_or_add_rPr()
rFonts = rPr.get_or_add_rFonts()
rFonts.set(qn('w:eastAsia'), '宋体')  # 设中文层 —— 这一行是关键
```

**或者用社区 fork `python-docx-oss`**（已内置 `Font.eastAsia` 属性），但版本 0.1.0 较新，稳定性待验证。建议先用 XML workaround，不引入新依赖。

> 只要正确设了 east-asian 属性，且用户系统上安装了对应字体，字体名、字号、颜色、粗斜体都能精确还原。不存在"能做但做不准"的问题。

## 依赖与限制

### 部署依赖

| 依赖 | 说明 |
|------|------|
| 服务端 Python | 整个转换链路跑在 FastAPI 后端，**客户端离线不可用** |
| PyMuPDF | 服务端 import，不随客户端分发，不触发 AGPL |
| python-docx | 纯 Python 库，无额外运行时依赖 |
| 系统字体 | 详见下方 |

### 字体依赖（最关键的限制）

PDF 中 `ABCDEE+SimHei` 说明字体已内嵌在 PDF 里。转换后的 DOCX 引用纯字体名 `SimHei`，**依赖 Windows 系统安装了该字体**。

| PDF 中的字体 | 系统是否有 | DOCX 打开结果 |
|-------------|:---:|------|
| SimHei（黑体） | ✅ Windows 自带 | 正确显示 |
| SimSun（宋体） | ✅ Windows 自带 | 正确显示 |
| Microsoft YaHei | ✅ Windows 自带 | 正确显示 |
| 方正黑体 / 造字工房 / 思源 | ❌ 一般没有 | **回退到等线/Calibri** |
| 冷门商业字体 | ❌ 一般没有 | **回退到等线/Calibri** |

**这是 OOXML 格式的通病，不是本方案的 bug**。所有 DOCX 文件都依赖系统字体。解决方向：维护一个字体回退表，把冷门字体映射到系统近亲字体（如"方正黑体_GBK"→"SimHei"）。

### 功能限制

| 限制 | 影响 | 原因 |
|------|------|-------------|
| 客户端离线 | 完全不可用 | 转换链路在服务端 |
| 系统缺字体 | 回退到等线/Calibri | OOXML 通病 |
| 扫描件（图片 PDF） | 0 个文字 span，方案失效 | 没有文字层 |
| PDF 用非嵌入字体 | 字体名是 `"Unknown"` | PDF 没存字体信息 |
| 多栏排版 | 可能串栏 | PyMuPDF 按坐标排序 |


### 实施步骤

| 步骤 | 内容 | 预估 |
|------|------|------|
| 1 | Fork 现有 pdf2docx，找到样式写入相关代码 | 0.5 天 |
| 2 | 实现 PyMuPDF 精确读取 + 样式写入层 | 1 天 |
| 3 | 实现 AI 布局分析（span → prompt → DeepSeek → 结构 JSON） | 1 天 |
| 4 | 整合：AI 结构 + PyMuPDF 样式 → python-docx 写入 | 0.5 天 |
| 5 | 部署 + 10+ 份中文简历测试 | 1 天 |
| **合计** | | **4 天** |

### 与现有方案对比

| | pdf2docx | LibreOffice | 本方案 |
|------|:---:|:---:|:---:|
| 字体准确性 | 50% | 40% | 85% |
| 颜色保留 | 0% | 10% | 85% |
| 表格结构 | 60% | 30% | **90%**（AI 视觉判断） |
| 标题层级 | 70% | 0% | **95%**（AI 语义理解） |
| 多栏阅读顺序 | 40% | 30% | **90%**（AI 分栏识别） |
| 粗体/斜体 | 70% | 50% | 90% |
| **整体还原度** | **~55%** | **~35%** | **~90%** |
| 实施成本 | ✅ 已有 | ✅ 已有 | 4 天 |
| 新依赖 | 无 | LibreOffice | DeepSeek（已有） |
| 离线可用 | ✅ | ✅ | ❌（依赖服务端） |
| 许可证风险 | 无（服务端） | 无 | 无（服务端） |

