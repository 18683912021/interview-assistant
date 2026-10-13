"""Bound verified resume facts while retaining question-relevant later projects."""
import re


def resume_excerpt(text: str, question: str, limit: int = 12000) -> str:
    if len(text) <= limit:
        return text
    tokens = set(re.findall(r"[a-z][a-z0-9.+#-]{1,}", question.lower()))
    stop = {"什么", "如何", "介绍", "一下", "项目", "负责", "这个", "我们", "你的", "你在", "中的"}
    for phrase in re.findall(r"[\u4e00-\u9fff]+", question):
        tokens.update(phrase[i:i+2] for i in range(len(phrase)-1) if phrase[i:i+2] not in stop)
    parts = re.findall(r"[\s\S]{1,1800}(?:\n|$)|[\s\S]{1,1800}", text)
    selected, budget = {0}, limit - len(parts[0])
    ranked = sorted(range(1, len(parts)), key=lambda i: (-sum(token in parts[i].lower() for token in tokens), i))
    for index in ranked:
        if len(parts[index]) + 2 <= budget:
            selected.add(index)
            budget -= len(parts[index]) + 2
    return "\n\n".join(parts[index] for index in sorted(selected))[:limit]
