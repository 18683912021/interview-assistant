import pytest

from app.services.llm_service import build_messages


@pytest.mark.parametrize("question", ["前端SEO优化如何做？", "SEO怎么优化", "Explain seo.", "Search engine optimization", "搜索引擎优化的误区"])
def test_seo_reference_reaches_provider_prompt(question):
    messages = build_messages(question, None, "en", {"answer_style": "written"})
    assert len(messages) == 2
    assert "用English回答" in messages[0]["content"]
    assert "CSR 并非无法索引" in messages[0]["content"]
    assert "私密数据靠服务端鉴权" in messages[0]["content"]
    assert "canonical 是规范页信号" in messages[0]["content"]


@pytest.mark.parametrize("question", ["HTTP 404 是什么？", "介绍 Seoul", "parseObject 的作用", "讲一下 MVCC"])
def test_unrelated_question_does_not_inherit_resume_seo_topic(question):
    messages = build_messages(question, None, "zh", {"answer_style": "written", "resume_text": "SEO 搜索引擎优化"})
    assert "已核对的 SEO 事实边界" not in messages[0]["content"]
