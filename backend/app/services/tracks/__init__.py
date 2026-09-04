"""语言赛道模块。

每个赛道一个 .py 文件，导出 TRACK dict。__init__ 负责加载、合并、查询。

加新赛道只需两步：
  1. 新建 xxx.py（参考 javascript.py）
  2. 在下面的 _TRACK_FILES 列表里加上它
"""

import logging
from typing import Optional

logger = logging.getLogger("tracks")

_TRACK_FILES = [
    "app.services.tracks.common",
    "app.services.tracks.javascript",
    "app.services.tracks.python",
    "app.services.tracks.java",
    "app.services.tracks.csharp",
    "app.services.tracks.cpp",
    "app.services.tracks.go",
]

_tracks: dict[str, dict] = {}       # key → TRACK
_all_terms: dict[str, list[str]] = {}  # 所有术语合并
_loaded = False


def _load() -> None:
    global _loaded, _tracks, _all_terms
    if _loaded:
        return
    _loaded = True

    from importlib import import_module
    from app.services.tracks.common import TRACK as common_track

    merged_terms: dict[str, list[str]] = dict(common_track.get("terms", {}))

    for path in _TRACK_FILES:
        if path.endswith(".common"):
            continue
        try:
            mod = import_module(path)
            track: dict = dict(mod.TRACK)
            key = track.get("key", "")
            if not key:
                logger.warning("赛道 %s 缺少 key 字段，跳过", path)
                continue
            _tracks[key] = track

            # 合并术语：赛道术语追加到已有术语上
            for term, variants in track.get("terms", {}).items():
                if term in merged_terms:
                    seen = set(merged_terms[term])
                    for v in variants:
                        if v not in seen:
                            seen.add(v)
                            merged_terms[term].append(v)
                else:
                    merged_terms[term] = list(variants)

            logger.info("赛道已加载: %s (%d 个术语)", key, len(track.get("terms", {})))
        except Exception:
            logger.exception("加载赛道失败: %s", path)

    # 清理：通用中文词不能作为英文术语的变体，否则会导致误纠正
    # 如 "特性"→"attribute"、"事件"→"Event"
    _CN_BLACKLIST = {
        '特性', '属性', '事件', '模块', '状态', '路由', '渲染', '组件',
        '服务', '实例', '接口', '方法', '对象', '类型', '泛型', '继承',
        '多态', '封装', '抽象', '反射', '注解', '配置', '部署', '日志',
        '缓存', '消息', '队列', '线程', '进程', '内存', '编译', '调试',
        '测试', '异常', '序列', '并发', '同步', '异步', '指针', '函数',
    }
    cleaned: dict[str, list[str]] = {}
    for term, variants in merged_terms.items():
        term_is_cn = any(ord(c) > 127 for c in term)
        if term_is_cn:
            cleaned[term] = variants
        else:
            cleaned[term] = [v for v in variants if v not in _CN_BLACKLIST]
    _all_terms = cleaned
    logger.info("全部赛道加载完成，%d 个赛道，%d 个术语", len(_tracks), len(_all_terms))


def get_all_terms() -> dict[str, list[str]]:
    """返回合并后的全部术语表（common + 所有赛道）。"""
    _load()
    return _all_terms


def get_track(key: str) -> Optional[dict]:
    """查询单个赛道。"""
    _load()
    return _tracks.get(key)


def get_track_keys() -> list[str]:
    """列出所有赛道 key。"""
    _load()
    return list(_tracks.keys())


def resolve_track(language: str) -> Optional[dict]:
    """从语言名解析赛道。Python→python track, JavaScript→javascript track。"""
    _load()
    mapping = {
        "javascript": "javascript",
        "java": "java",
        "python": "python",
        "c#": "csharp",
        "csharp": "csharp",
        "c++": "cpp",
        "cpp": "cpp",
        "go": "go",
        "golang": "go",
    }
    key = mapping.get(language.lower(), language.lower())
    return _tracks.get(key)
