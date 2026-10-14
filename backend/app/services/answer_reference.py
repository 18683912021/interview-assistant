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
)

_SEO_QUESTION = re.compile(r"(?<![a-z0-9_])seo(?![a-z0-9_])|搜索引擎优化|search engine optimi[sz]ation", re.I)
_SEO_NOTES = r"""
已核对的 SEO 事实边界（用于校准相关表述，不是答案提纲；按需融入，不逐条复述，不改变回答语言或篇幅要求）：
综合题先讲 SSG、SSR、CSR 和已有 SPA 的不同适用场景，再覆盖内容结构、元数据、抓取索引、体验与验收。不默认限定 Next.js，不把以下框架例外展开成主要内容。
通用 SEO 题的示例优先展示一小段静态 HTML head（title、description、绝对 canonical 等），不为展示标签搭建整页动态取数。只有题目明确要求框架实现才展开动态页面。SSG 的优势是可预生成和缓存，不代表所有情况下首屏最快；个性化/登录态是否使用 SSR 是渲染决策，不等于有公开收录需求。
SSR 本身不会泄露私密数据：登录后页面也可鉴权后 SSR；风险在越权取数或把个性化响应共享缓存，不能写成“私密页面只能 CSR”。内容更新与 URL 迁移也不同：正文更新不一定改 canonical；URL 迁移才需要同步规范地址、内链、重定向和 sitemap。不要把普通更新都说成替换旧 URL，也不能保证提交 sitemap 就立即换掉索引。
- Google 能执行 JavaScript，CSR 并非无法索引；原始 HTML 或关闭 JS 检查只能确认预渲染内容，不能独立判定索引结果。Search Console 实时测试/渲染快照用于排查可访问和渲染问题，不代表已经收录；索引状态要看索引数据/页面索引报告。其他爬虫能力可能不同。
- robots.txt 管抓取，不是鉴权或可靠禁止索引。要让爬虫读取 noindex，不能同时屏蔽该页面抓取；私密数据靠服务端鉴权保护。公开营销页与登录后业务页分别处理。
- canonical 是规范页信号，不能保证搜索引擎一定采纳；带查询参数不等于不能收录。描述长度没有通用硬上限，展示可能截断或改写；结构化数据不保证出现富媒体结果。sitemap 不保证收录，只放希望索引的有效规范 URL；处理真实 404，避免 fallback 把所有不存在的路径返回 200。
- 仅在需要 Next.js 代码时：App Router 用 metadata/generateMetadata，不混用 Pages Router 的 getStaticProps/getServerSideProps。Next.js 15+ 动态 params 按 Promise await；示例使用绝对 canonical URL，或同时提供必要 metadataBase 配置，不将缺失的必需配置留给读者猜。动态 metadata 可流式输出，不能一概声称在所有正文渲染之前同步完成。
- Client Component 也可在初次访问时预渲染，use client 不等于自动变成纯 CSR；关键是正文取数和渲染时机。若示例用 notFound，应导入并实际调用，不能用 return {} 假装触发错误页；在流式响应已开始后可能保持 200 并附加 noindex。不为展示 SEO 加入未经清洗的 HTML 注入，正文使用 React 文本节点。
- 分页各页通常展示不同内容，应有独立 URL 和自指 canonical，不能把所有分页都归到第一页。参数是否需要规范化取决于实际内容，不能一刀切。
- 首屏 LCP 图片不要懒加载，延迟加载用于非首屏资源；字体或图片预加载只用于真正关键且发现较晚的资源，滥用会争抢带宽。说明性能措施的条件与验证，不列无条件的优化清单。
- 若展示 JSON-LD 的 script 注入，单纯 JSON.stringify 不足以防止不可信内容提前闭合 script；序列化后至少将 < 替换为字面量 \\u003c，保留安全边界。代码示例宜选一个关键环节讲透，避免为每个知识点堆代码。
"""


def answer_reference(question: str) -> str:
    return _SEO_NOTES if _SEO_QUESTION.search(question) else ""
