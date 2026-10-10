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
    expect(html).toContain('answer-code-language');
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
