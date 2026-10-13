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

import {questionContext, previousReference} from './answer-context';
it('anchors old and merged questions to preceding dialogue, excluding later topics', () => {
  const messages = Array.from({length: 20}, (_, index) => ({id: String(index), role: 'interviewer', text: `topic ${index}`, timestamp: index * 100}));
  expect(questionContext(messages, ['4'])).toEqual(messages.slice(0, 4).map(({role, text}) => ({role, text})));
  expect(questionContext(messages, ['4', '8']).some(message => message.text === 'topic 19')).toBe(false);
  expect(questionContext(messages, ['missing'])).toEqual([]);
  const prior = {text: 'Reference only', status: 'done', timestamp: 250, source_message_ids: ['2'], source_revisions: [0]};
  expect(previousReference(messages, [prior], ['4'])).toBe('Reference only');
  expect(previousReference(messages, [{...prior, timestamp: 999}], ['4'])).toBe('');
});
