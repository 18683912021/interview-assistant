import {describe, expect, it, vi} from 'vitest';
import {DEFAULT_SETTINGS, type ResumeVersion} from '../api/workspace';
import {
  changedSettings,
  groupResumeVersions,
  normalizeJob,
  sameResumeContent,
} from './workspaceForms';
import {WorkspaceDraftStore} from './WorkspaceDraftContext';
vi.mock('../api/client', () => ({api: {}}));

const resume = (id: string, filename: string, version: number): ResumeVersion => ({
  id,
  filename,
  version,
  text: '项目经历',
  created_at: '2026-10-09T10:00:00Z',
});
describe('workspace form changes', () => {
  it('only submits changed preferences and clears dirty state after restoring a value', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      font_size: 18 as const,
      answer_length: 'detailed' as const,
    };
    expect(changedSettings(settings, DEFAULT_SETTINGS)).toEqual({
      font_size: 18,
      answer_length: 'detailed',
    });
    expect(
      changedSettings({...settings, font_size: 16, answer_length: 'brief'}, DEFAULT_SETTINGS),
    ).toEqual({});
  });
  it('does not create a duplicate resume version for unchanged text or incidental outer whitespace', () => {
    const original = resume('a', '简历', 1);
    expect(sameResumeContent(original, ' 简历 ', '\n项目经历\n')).toBe(true);
    expect(sameResumeContent(original, '简历', '项目经历\n补充真实职责')).toBe(false);
    expect(sameResumeContent(null, '简历', '项目经历')).toBe(false);
  });
  it('groups only same-name versions, newest first, without losing older version IDs', () => {
    const a = resume('a', 'Resume.pdf', 1),
      b = resume('b', 'resume.pdf', 3),
      c = resume('c', '另一份简历', 2);
    expect(groupResumeVersions([a, c, b]).map(group => group.map(item => item.id))).toEqual([
      ['b', 'a'],
      ['c'],
    ]);
    expect(groupResumeVersions([])).toEqual([]);
  });
  it('normalizes optional job fields and exposes whitespace-only titles to validation', () => {
    expect(normalizeJob({title: '  ', company: ' 公司 ', description: '\n描述\n'})).toEqual({
      title: '',
      company: '公司',
      description: '描述',
      programming_language: '',
    });
  });
});
describe('workspace drafts', () => {
  it('retains late async results and notifies a newly mounted subscriber', () => {
    const store = new WorkspaceDraftStore();
    const first = vi.fn(),
      later = vi.fn();
    const off = store.subscribe(first);
    store.set('intro', {input: '保留的内容', busy: true});
    off();
    store.subscribe(later);
    store.set('intro', {input: '保留的内容', busy: false, result: '生成完成'});
    expect(first).toHaveBeenCalledTimes(1);
    expect(later).toHaveBeenCalledTimes(1);
    expect(store.get('intro', () => ({}))).toEqual({
      input: '保留的内容',
      busy: false,
      result: '生成完成',
    });
  });
  it('keeps tools and signed-in workspaces isolated without writing browser storage', () => {
    const current = new WorkspaceDraftStore(),
      nextLogin = new WorkspaceDraftStore();
    current.set('intro', '私人经历');
    current.set('answer', '另一份草稿');
    expect(current.get('intro', () => '')).toBe('私人经历');
    expect(current.get('answer', () => '')).toBe('另一份草稿');
    expect(nextLogin.get('intro', () => '')).toBe('');
  });
});
