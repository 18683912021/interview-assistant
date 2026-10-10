import {expect, it} from 'vitest';
import {resumeExcerpt} from './answer-context';
it('keeps normal resumes verbatim and retains a relevant late project in a long resume', () => {
  expect(resumeExcerpt('教育经历\n真实项目。', '问题')).toBe('教育经历\n真实项目。');
  const resume =
    '基础资料\n' +
    ('早期常规工作经历。'.repeat(300) + '\n').repeat(7) +
    'NimbusQueue 流式任务平台：负责幂等请求和事务去重。';
  const excerpt = resumeExcerpt(resume, '介绍 NimbusQueue 的幂等请求设计');
  expect(excerpt.length).toBeLessThanOrEqual(12000);
  expect(excerpt).toContain('基础资料');
  expect(excerpt).toContain('NimbusQueue');
  expect(excerpt).toContain('负责幂等请求和事务去重');
});
