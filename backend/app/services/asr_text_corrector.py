"""ASR 文本纠正引擎。

结构：正确术语 → [ASR 可能输出的变体列表]
  - 按文章方案，正词维度组织，一个术语带多个变体
  - 模块加载时自动展开为变体→正词的查找表
  - Layer 1 精确匹配 + Layer 2 拼音模糊兜底
"""

import re
import logging
from functools import lru_cache
from typing import NamedTuple

from pypinyin import pinyin, Style
from rapidfuzz import fuzz

logger = logging.getLogger("asr_corrector")

# ══════════════════════════════════════════════════════════════════
# 归一化工具
# ══════════════════════════════════════════════════════════════════

def _normalize(text: str) -> str:
    """统一小写、去标点、合并空白、去首尾空格。"""
    text = text.lower().strip()
    text = re.sub(r'[]，。！？、；：""''（）【】《》—…+(){}[]', ' ', text)
    text = text.replace('-', ' ')
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def _strip_spaces(text: str) -> str:
    """去所有空白，用于相等比较。"""
    return re.sub(r'\s+', '', text)

def _to_pinyin(text: str) -> str:
    """转拼音字符串。"""
    return ' '.join(p[0] for p in pinyin(text, style=Style.TONE3, neutral_tone_with_five=True))


# ══════════════════════════════════════════════════════════════════
# 变体生成器 —— 对一个正词，自动生成常见 ASR 变体
# ══════════════════════════════════════════════════════════════════

def _generate_variants(term: str) -> list[str]:
    """对单个术语自动生成 ASR 可能的输出变体。

    只生成字母拼读（A B C）和去空格版，不做自动小写（避免 Map→map 吃掉数组方法 map）。
    """
    variants: set[str] = set()

    # 去空白版（用于匹配空格被 ASR 合并或拆分的场景）
    stripped = _strip_spaces(term)
    if stripped and stripped != term:
        variants.add(stripped)

    # 字母拼读：React → R E A C T
    if any(ch.isalpha() for ch in term):
        letters = ' '.join(ch for ch in term if ch.isalpha())
        if len(letters) >= 3:
            variants.add(letters.upper())
            variants.add(letters.lower())

    # 去标点符号
    no_punct = term.replace('-', '').replace('_', '').replace('.', '')
    if no_punct != term and len(no_punct) >= 2:
        variants.add(no_punct)

    return sorted(variants, key=lambda x: -len(x))


# ══════════════════════════════════════════════════════════════════
# 主词典：正确术语 → ASR 可能输出的变体列表
# ══════════════════════════════════════════════════════════════════

_TERM_VARIANTS: dict[str, list[str]] = {}  # lazy-loaded from tracks
_CORRECTIONS: list[tuple[str, str]] = []
_CORRECTIONS_BY_LEN: list[tuple[int, str, str]] = []
_LOADED = False


_TRACK_LOADED: str | None = None  # 当前已加载的 track_key

def _load_terms(track_key: str | None = None) -> None:
    """延迟加载术语表。track_key 为 None 时只加载 common 术语。"""
    global _TERM_VARIANTS, _CORRECTIONS, _CORRECTIONS_BY_LEN, _TRACK_LOADED
    key = track_key or "common"
    if _TRACK_LOADED == key:
        return
    _TRACK_LOADED = key
    from app.services.tracks import get_track
    from app.services.tracks.common import TRACK as common_track

    terms: dict[str, list[str]] = dict(common_track.get("terms", {}))
    if track_key:
        track = get_track(track_key)
        if track:
            for term, variants in track.get("terms", {}).items():
                if term in terms:
                    terms[term].extend(variants)
                else:
                    terms[term] = list(variants)

    _TERM_VARIANTS = terms
    _CORRECTIONS = _build_lookup()
    _CORRECTIONS = [(w, c) for w, c in _CORRECTIONS if len(w) > 1]
    _CORRECTIONS_BY_LEN = sorted(
        [(len(w), w, c) for w, c in _CORRECTIONS],
        key=lambda x: -x[0],
    )
    logger.info("ASR 纠正器已加载 track=%s，%d 个术语", key, len(terms))


def _build_lookup() -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for term, variants in _TERM_VARIANTS.items():
        seen: set[str] = set()
        for v in variants:
            v_norm = v.strip()
            if v_norm and v_norm not in seen:
                seen.add(v_norm)
                pairs.append((v_norm, term))
            for auto in _generate_variants(v):
                if auto and auto not in seen:
                    seen.add(auto)
                    pairs.append((auto, term))
    pairs.sort(key=lambda x: -len(x[0]))
    return pairs


# ══════════════════════════════════════════════════════════════════
# 拼音模糊匹配（已知术语库）
# ══════════════════════════════════════════════════════════════════

class _PinyinTerm(NamedTuple):
    term: str
    pinyin: str


def _get_pinyin_db() -> list[_PinyinTerm]:
    _load_terms()
    return sorted(
        [_PinyinTerm(term, _to_pinyin(term)) for term in _TERM_VARIANTS.keys()],
        key=lambda x: -len(x.term),
    )


def _pinyin_fuzzy_correct(text: str, threshold: float = 0.72) -> str:
    """对中文片段做拼音模糊匹配。"""
    segments = re.findall(r'[一-鿿]{2,}', text)
    if not segments:
        return text

    pinyin_db = _get_pinyin_db()
    result = text
    for segment in sorted(set(segments), key=lambda x: -len(x)):
        seg_pinyin = _to_pinyin(segment)
        best_score = 0.0
        best_term = ""
        for pt in pinyin_db:
            score = fuzz.ratio(seg_pinyin, pt.pinyin) / 100.0
            if score > best_score:
                best_score = score
                best_term = pt.term
        if best_score >= threshold and best_term != segment and len(best_term) <= len(segment) * 2:
            result = result.replace(segment, best_term)
            logger.info("拼音纠正 [%.0f%%]: %.20s → %.20s", best_score * 100, segment, best_term)
    return result


# ══════════════════════════════════════════════════════════════════
# 公开 API
# ══════════════════════════════════════════════════════════════════

def correct_asr_text(text: str, track_key: str | None = None) -> str:
    """双层纠正。

    Layer 1 — 精确匹配（跳过长匹配 + 简单 str.replace，微秒级）
    Layer 2 — 拼音模糊匹配（毫秒级兜底）
    """
    if not text or not text.strip():
        return text

    _load_terms(track_key)

    original = text
    max_len = len(text)

    for w_len, wrong, correct in _CORRECTIONS_BY_LEN:
        if w_len > max_len:
            continue
        if wrong in text:
            text = text.replace(wrong, correct)

    text = re.sub(r'\s{2,}', ' ', text).strip()

    if text != original:
        logger.info("ASR 纠正: %.50s → %.50s", original, text)

    return text
