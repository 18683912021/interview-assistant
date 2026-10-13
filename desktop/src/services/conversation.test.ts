import {describe, expect, it} from 'vitest';
import {findReusableAnswer, hasRevisedSources} from './conversation';
describe('answer selection', () => {
  const messages = [
    {id: 'one', revision: 2},
    {id: 'two', revision: 1},
  ];
  const answer = {
    id: 'a',
    source_message_ids: ['one', 'two'],
    source_revisions: [2, 1],
    status: 'done',
    text: '回答',
  };
  it('reopens a matching merged or streaming answer without another request', () => {
    expect(findReusableAnswer([answer], messages, 'two')).toBe(answer);
    const streaming = {...answer, id: 'b', status: 'loading', text: ''};
    expect(findReusableAnswer([answer, streaming], messages, 'one')).toBe(streaming);
  });
  it('requires a new answer after a source revision and ignores an empty failed attempt', () => {
    expect(hasRevisedSources(answer, [{id: 'one', revision: 3}, messages[1]!])).toBe(true);
    expect(
      findReusableAnswer([answer], [{id: 'one', revision: 3}, messages[1]!], 'one'),
    ).toBeUndefined();
    expect(
      findReusableAnswer([{...answer, status: 'error', text: ''}], messages, 'one'),
    ).toBeUndefined();
  });
  it('keeps style variants separate and reopens only matching preferences', () => {
    const preferences = {language: 'zh', answer_length: 'standard', answer_style: 'written'} as const;
    const spoken = {...answer, context_snapshot: {...preferences, answer_style: 'conversational'}};
    const written = {...answer, id: 'written', context_snapshot: {...preferences}};
    expect(findReusableAnswer([spoken], messages, 'one', preferences)).toBeUndefined();
    expect(findReusableAnswer([written, spoken], messages, 'one', preferences)).toBe(written);
    expect(findReusableAnswer([written], messages, 'one', {...preferences, answer_length: 'detailed'})).toBe(written);
    expect(findReusableAnswer([written], messages, 'one', {...preferences, language: 'en'})).toBeUndefined();
  });
});
