'use strict';
const area = document.getElementById('area');
const selection = document.getElementById('selection');
const hint = document.getElementById('hint');
let start = null;
let submitted = false;
const point = event => ({x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY))});
const rectangle = end => ({x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y)});
area.addEventListener('pointerdown', event => {
  if (event.button !== 0 || submitted) return;
  start = point(event); area.setPointerCapture(event.pointerId);
  Object.assign(selection.style, {display: 'block', left: start.x + 'px', top: start.y + 'px', width: '0', height: '0'});
  hint.hidden = true;
});
area.addEventListener('pointermove', event => {
  if (!start || submitted) return;
  const rect = rectangle(point(event));
  Object.assign(selection.style, {left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px'});
});
area.addEventListener('pointerup', event => {
  if (!start || submitted || event.button !== 0) return;
  const rect = rectangle(point(event)); start = null;
  if (rect.width < 12 || rect.height < 12) {
    selection.style.display = 'none'; hint.hidden = false;
    hint.textContent = '选区太小，请重新拖动框选 · Esc / 右键取消'; return;
  }
  submitted = true; window.screenshotSelector.select(rect);
});
area.addEventListener('pointercancel', () => {start = null; selection.style.display = 'none'; hint.hidden = false;});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {event.preventDefault(); window.screenshotSelector.cancel();}
});
document.addEventListener('contextmenu', event => {event.preventDefault(); window.screenshotSelector.cancel();});
