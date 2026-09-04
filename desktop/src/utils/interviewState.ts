/**
 * 面试状态 —— 跨组件共享
 */
let _active = false;
const _listeners: Array<(active: boolean) => void> = [];

export function isInterviewActive(): boolean {
  return _active;
}

export function setInterviewActive(active: boolean): void {
  if (_active !== active) {
    _active = active;
    _listeners.forEach(fn => fn(active));
  }
}

export function onInterviewActiveChange(fn: (active: boolean) => void): () => void {
  _listeners.push(fn);
  return () => {
    const idx = _listeners.indexOf(fn);
    if (idx !== -1) { _listeners.splice(idx, 1); }
  };
}
