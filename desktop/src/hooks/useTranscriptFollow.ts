import {useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent} from 'react';

/** A resize/hidden pane can dispatch scroll without a user scrolling. Only
 * explicit scrolling releases the live tail; layout changes retain intent. */
export function useTranscriptFollow(messages: unknown[], layout: string, mounted: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const lastIntent = useRef(-Infinity);
  const [newMessages, setNewMessages] = useState(false);
  const anchor = () => {
    const element = scrollRef.current;
    if (element && element.clientHeight > 0) element.scrollTop = element.scrollHeight;
  };
  const toLatest = () => {following.current = true; setNewMessages(false); anchor();};
  const intent = () => {lastIntent.current = performance.now();};
  const onScroll = () => {
    const element = scrollRef.current;
    if (!element || element.clientHeight === 0) return;
    if (element.scrollHeight-element.scrollTop-element.clientHeight < 55) {
      following.current = true; setNewMessages(false);
    } else if (performance.now()-lastIntent.current < 500) {
      following.current = false;
    } else if (following.current) {
      anchor();
    }
  };
  useLayoutEffect(() => {
    if (following.current) anchor();
    else if (messages.length) setNewMessages(true);
  }, [messages]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !mounted) return;
    const resize = () => {if (following.current) anchor();};
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [layout, mounted]);
  return {scrollRef, newMessages, toLatest, scrollHandlers:{onScroll, onWheel:intent, onTouchMove:intent,
    onPointerDown:(event: PointerEvent<HTMLDivElement>) => {
      // Scrollbar/background dragging; clicking a question does not leave a
      // stale scroll intent that could be mistaken for a later layout change.
      if (event.target === event.currentTarget || event.pointerType === 'touch') intent();
    },
    onKeyDown:(event: KeyboardEvent<HTMLDivElement>) => {
      if (['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' ','Tab'].includes(event.key)) intent();
    },
  }};
}
