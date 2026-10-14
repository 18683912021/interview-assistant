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


def test_general_seo_does_not_inherit_framework_trivia_from_resume():
    prompt = build_messages("前端 SEO 性能优化怎么做？", None, "zh", {
        "answer_style": "written", "resume_text": "Next.js App Router、generateMetadata 和 JSON-LD 项目",
    })[0]["content"]
    assert "相关框架事实" not in prompt
    assert "结构化数据实现" not in prompt
    assert "重复页指向选定的规范页" in prompt
    assert "字体替换仍可能引起 CLS" in prompt


@pytest.mark.parametrize("question,expected,absent", [
    ("Next.js App Router 怎么优化 SEO？", "相关框架事实", "结构化数据实现"),
    ("SEO 的 JSON-LD 结构化数据如何安全输出？", "结构化数据实现", "相关框架事实"),
])
def test_specialized_seo_notes_follow_the_actual_question(question, expected, absent):
    prompt = build_messages(question, None, "zh", {"answer_style": "written"})[0]["content"]
    assert expected in prompt
    assert absent not in prompt
