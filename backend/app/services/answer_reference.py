"""Small reviewed corrections for known answer-quality failures.

These are factual boundaries, not canned answers or live retrieval. Select by
the question only: an unrelated resume keyword must not change the topic.
Reviewed 2026-10-14 against the primary sources below. Recheck when updating
framework examples; do not turn version-specific notes into universal rules.
"""
import re

SEO_SOURCES = (
    "https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics",
    "https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag",
    "https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls",
    "https://developers.google.com/search/docs/appearance/snippet",
    "https://nextjs.org/docs/app/api-reference/functions/generate-metadata",
    "https://nextjs.org/docs/app/guides/json-ld",
    "https://nextjs.org/docs/app/api-reference/file-conventions/not-found",
    "https://nextjs.org/docs/app/getting-started/server-and-client-components",
    "https://support.google.com/webmasters/answer/9012289",
    "https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading",
    "https://web.dev/articles/optimize-lcp",
    "https://web.dev/articles/optimize-cls",
    "https://web.dev/learn/performance/optimize-web-fonts",
)

_SEO_QUESTION = re.compile(r"(?<![a-z0-9_])seo(?![a-z0-9_])|搜索引擎优化|search engine optimi[sz]ation", re.I)
_SEO_NOTES = """
已核对的 SEO 事实边界，只校准相关表述，不作答案提纲：
Google 可执行 JS，CSR 并非无法索引；私密数据靠服务端鉴权，SSR 本身不等于公开数据。
canonical 是规范页信号：规范页可自指，重复页指向选定的规范页；不同内容的分页通常各自规范化。
robots 管抓取，noindex 必须可读取；渲染测试与已索引不同。sitemap 和结构化数据分别用于发现与理解内容。
font-display: swap 让文字先显示，但字体替换仍可能引起 CLS，需匹配回退字体度量。
"""

_FRAMEWORK_QUESTION = re.compile(r"next\.?js|next\s+app|app\s*router|pages\s*router|generateMetadata|notFound|流式\s*(?:SSR|渲染)", re.I)
_NEXT_NOTES = """
相关框架事实：Next.js App Router 用 metadata/generateMetadata，Pages Router 用 getStaticProps/getServerSideProps，不能混用。Next.js 15+ 动态 params 按 Promise await；相对 metadata URL 需配置 metadataBase。Client Component 初次访问也可预渲染。metadata 可流式输出；notFound 必须实际调用，流式响应已开始后可能保持 200 并附加 noindex。
"""
_JSON_LD_QUESTION = re.compile(r"JSON[- ]?LD|结构化数据|structured data", re.I)
_JSON_LD_NOTES = r"""
结构化数据实现：内容与可见正文一致；若向 script 注入不可信 JSON，序列化后至少把 < 替换为字面量 \u003c，防止提前闭合标签，不能只依靠 JSON.stringify。
"""


def answer_reference(question: str) -> str:
    if not _SEO_QUESTION.search(question):
        return ""
    notes = _SEO_NOTES
    # A general SEO question must not inherit framework trivia from the resume.
    if _FRAMEWORK_QUESTION.search(question):
        notes += _NEXT_NOTES
    if _JSON_LD_QUESTION.search(question):
        notes += _JSON_LD_NOTES
    return notes
