import {describe, expect, it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import AnswerBody from './AnswerBody';

describe('safe answer documents', () => {
  it('renders readable paragraphs, emphasis, lists and inline code', () => {
    const html = renderToStaticMarkup(
      <AnswerBody text={'**先给结论**\n\n1. 说明职责\n2. 使用 `Redis`\n\n- 解释取舍'} />,
    );
    expect(html).toContain('<strong>先给结论</strong>');
    expect(html).toContain('<ol start="1">');
    expect(html).toContain('<code>Redis</code>');
    expect(html).toContain('<ul>');
  });
  it('displays a streaming code block before its closing fence arrives', () => {
    const html = renderToStaticMarkup(
      <AnswerBody text={'```java\nif (count < 5) {\n  return true;'} />,
    );
    expect(html).toContain('java</span>');
    expect(html).toContain('复制代码');
    expect(html).toContain('if (count &lt; 5)');
    expect(html).toContain('<pre><code>');
    expect(html).not.toContain('```');
  });
  it('escapes HTML and does not embed model-provided links or images', () => {
    const html = renderToStaticMarkup(
      <AnswerBody
        text={
          '<script>alert(1)</script>\n\n![track](https://invalid.test/pixel) [open](javascript:alert(1))'
        }
      />,
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('src=');
  });
});

it('renders accessible tables, escaped pipes, and heading navigation without fetching HTML', () => {
  const html = renderToStaticMarkup(<AnswerBody text={'方案 | 条件\n--- | ---\nA | `a|b`\nB | c\\|d\n\n## 一\n内容\n## 二\n内容\n## 三\n内容\n## 四\n内容'} />);
  expect(html).toContain('<table>');
  expect(html).toContain('<code>a|b</code>');
  expect(html).toContain('c|d');
  expect(html).toContain('回答目录');
});
