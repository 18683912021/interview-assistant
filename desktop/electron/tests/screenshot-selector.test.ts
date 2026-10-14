// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';

let area: HTMLElement;
const api = {select: vi.fn(), cancel: vi.fn()};
let context: Window;
beforeEach(() => {
  vi.clearAllMocks();
  const frame = document.createElement('iframe'); document.body.append(frame);
  context = frame.contentWindow!;
  context.document.write(readFileSync(path.resolve('electron/screenshot/selector.html'), 'utf8'));
  Object.assign(context, {screenshotSelector: api});
  area = context.document.getElementById('area')!;
  area.setPointerCapture = vi.fn();
  // Exercise the exact shipped selector script in an isolated DOM.
  const execute = new Function('window', 'document', 'innerWidth', 'innerHeight', readFileSync(path.resolve('electron/screenshot/selector.js'), 'utf8'));
  execute(context, context.document, 1440, 900);
});
afterEach(() => {document.body.replaceChildren();});
const pointer = (type: string, x: number, y: number) => area.dispatchEvent(new MouseEvent(type, {clientX: x, clientY: y, button: 0}));
it('supports dragging in either direction and submits only once on release', () => {
  pointer('pointerdown', 400, 300); pointer('pointermove', 100, 50);
  expect(api.select).not.toHaveBeenCalled();
  pointer('pointerup', 100, 50); pointer('pointerup', 100, 50);
  expect(api.select).toHaveBeenCalledExactlyOnceWith({x: 100, y: 50, width: 300, height: 250});
});
it('keeps a tiny click retryable and cancels without a native context menu', () => {
  pointer('pointerdown', 20, 20); pointer('pointerup', 21, 21);
  expect(api.select).not.toHaveBeenCalled();
  expect(context.document.getElementById('hint')!.textContent).toContain('选区太小');
  const cancel = new MouseEvent('contextmenu', {cancelable: true}); context.document.dispatchEvent(cancel);
  expect(cancel.defaultPrevented).toBe(true); expect(api.cancel).toHaveBeenCalledOnce();
  context.document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
  expect(api.cancel).toHaveBeenCalledTimes(2);
});
