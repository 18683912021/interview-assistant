// @vitest-environment jsdom
import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {useTranscriptFollow} from './useTranscriptFollow';

let height=200, total=1000;
function View({messages,layout}: {messages: unknown[];layout: string}) {
  const follow=useTranscriptFollow(messages,layout,true);
  return <><div ref={follow.scrollRef} aria-label="dialogue" {...follow.scrollHandlers}/>
    {follow.newMessages && <button onClick={follow.toLatest}>latest</button>}</>;
}
afterEach(() => {cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();});
function setup() {
  height=200; total=1000;
  vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockImplementation(() => height);
  vi.spyOn(HTMLElement.prototype,'scrollHeight','get').mockImplementation(() => total);
  vi.stubGlobal('ResizeObserver', class {observe() {} disconnect() {}});
  const view=render(<View messages={[]} layout="large"/>);
  return {view,element:screen.getByLabelText('dialogue')};
}
it('layout and hidden-pane scroll events never release the live tail', () => {
  const {view,element}=setup();
  element.scrollTop=400; // Chromium adjusts the old scroll offset during resize.
  fireEvent.scroll(element);
  expect(element.scrollTop).toBe(total);
  height=0; element.scrollTop=0; fireEvent.scroll(element);
  height=450; view.rerender(<View messages={[1]} layout="compact-chat"/>);
  expect(element.scrollTop).toBe(total);
  expect(screen.queryByText('latest')).toBeNull();
});
it.each(['wheel','keyboard','touch','scrollbar'])('keeps deliberate %s history scrolling across layout changes', method => {
  const {view,element}=setup();
  if(method==='wheel') fireEvent.wheel(element,{deltaY:-300});
  if(method==='keyboard') fireEvent.keyDown(element,{key:'PageUp'});
  if(method==='touch') fireEvent.touchMove(element);
  if(method==='scrollbar') fireEvent.pointerDown(element);
  element.scrollTop=100; fireEvent.scroll(element);
  view.rerender(<View messages={[1]} layout="compact"/>);
  expect(element.scrollTop).toBe(100);
  expect(screen.getByText('latest')).toBeTruthy();
  fireEvent.click(screen.getByText('latest'));
  expect(element.scrollTop).toBe(total);
  expect(screen.queryByText('latest')).toBeNull();
});
