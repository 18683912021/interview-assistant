// @vitest-environment jsdom
import {useState} from 'react';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {act, cleanup, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {Select, SelectOption} from './Select';
import {Modal} from './WorkspaceUI';
import {AnswerStylePicker} from './AnswerStylePicker';
import {ToastProvider, useToast} from './Toast';
import type {Settings} from '../api/workspace';

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(cleanup);

function Choice({insideModal = false}: {insideModal?: boolean}) {
  const [value, setValue] = useState('saved');
  const [open, setOpen] = useState(true);
  const content = <Select aria-label="参考简历" value={value} onValueChange={setValue}>
    <SelectOption value="">不关联简历</SelectOption>
    <SelectOption value="saved">后端工程师简历</SelectOption>
    <SelectOption value="disabled" disabled>已失效版本</SelectOption>
  </Select>;
  return insideModal ? open && <Modal title="编辑资料" onClose={() => setOpen(false)}>{content}</Modal> : content;
}

describe('desktop interaction contracts', () => {
  it('selects and preserves the empty option without native menus', async () => {
    const user = userEvent.setup();
    render(<Choice />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', {name: '不关联简历'}));
    expect(screen.getByRole('combobox').textContent).toContain('不关联简历');
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', {name: '不关联简历'}).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('option', {name: '已失效版本'}).getAttribute('aria-disabled')).toBe('true');
  });

  it('Escape closes the popup before the modal and restores trigger focus', async () => {
    const user = userEvent.setup();
    render(<Choice insideModal />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('dialog', {name: '编辑资料'})).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox')));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('exposes written and coding modes and supports keyboard selection across all four', async () => {
    const user = userEvent.setup();
    function Picker() {
      const [style, setStyle] = useState<Settings['answer_style']>('conversational');
      return <AnswerStylePicker value={style} onChange={setStyle} />;
    }
    render(<Picker />);
    expect(screen.getByRole('radio', {name: '标准书面'})).toBeTruthy();
    await user.tab();
    await user.keyboard('{End}');
    expect(screen.getByRole('radio', {name: '笔试机试'}).getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('radio', {name: '笔试机试'}));
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('radio', {name: '标准书面'}).getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('radio', {name: '标准书面'}));
  });

  it('waits for deletion and preserves the dialog after a failure for retry', async () => {
    const user = userEvent.setup();
    let reject!: (error: Error) => void;
    const operation = vi.fn(() => new Promise<void>((_, fail) => {reject = fail;}));
    function Trigger() {
      const {confirm} = useToast();
      return <button onClick={() => confirm('删除岗位？', '删除测试岗位', operation)}>打开确认</button>;
    }
    render(<ToastProvider><Trigger /></ToastProvider>);
    await user.click(screen.getByRole('button', {name: '打开确认'}));
    await user.click(screen.getByRole('button', {name: '删除'}));
    expect((screen.getByRole('button', {name: '正在处理…'}) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => reject(new Error('网络连接失败，请重试')));
    expect(screen.getByRole('alert').textContent).toContain('网络连接失败');
    expect(operation).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', {name: '删除'}) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole('button', {name: '取消'}));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', {name: '打开确认'})));
  });

  it('merges repeated notifications and allows dismissing them', async () => {
    const user = userEvent.setup();
    function Trigger() {
      const {toast} = useToast();
      return <button onClick={() => toast('已复制', 'success')}>复制</button>;
    }
    render(<ToastProvider><Trigger /></ToastProvider>);
    await user.click(screen.getByRole('button', {name: '复制'}));
    await user.click(screen.getByRole('button', {name: '复制'}));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    await user.click(screen.getByRole('button', {name: '关闭提示'}));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
