import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {TranscriptList} from '../src/components/TranscriptList';
import {AnswerBody} from '../src/components/AnswerBody';
import {INITIAL_STATE, interviewReducer} from '../src/store/interview-reducer';
import '../src/screens/interview.css';
import type {ConversationMessage} from '../src/store/types';

declare global {interface Window {reportRenderCheck: (result: unknown) => void}}
const messages: ConversationMessage[] = Array.from({length: 1000}, (_, i) => ({
  id: String(i), utteranceId: String(i), revision: 1, timestamp: i * 1000,
  source: i % 2 ? 'mic' : 'system', role: i % 2 ? 'user' : 'interviewer',
  status: 'done', text: `历史消息 ${i}：解释事件循环、微任务与异步执行的先后顺序。`,
}));
let state = {...INITIAL_STATE, conversation: messages};
const root = createRoot(document.getElementById('root')!);
const select = () => {}, edit = () => {};
const text = '### 回答要点\n\n解释执行顺序与边界。\n\n```js\n// 先说明为什么在这里检查状态，再说明如何处理异常。\nconst value = 1;\n```\n\n'.repeat(30);
function view() {
  return <div style={{display:'grid', gridTemplateColumns:'38% 62%', height:'600px'}}>
    <div className="chat-scroll" style={{overflow:'auto', height:'600px'}}>
      <TranscriptList messages={state.conversation} multi={false} selected={[]}
        answeredIds='["0"]' onSelect={select} onEdit={edit} />
    </div>
    <div style={{overflow:'auto', height:'600px'}}><AnswerBody text={text} /></div>
  </div>;
}
const paint = () => new Promise<number>(resolve => requestAnimationFrame(() => resolve(performance.now())));
async function run() {
  const timings: number[] = [];
  flushSync(() => root.render(view()));
  await paint();
  const first = document.querySelector('[data-message="0"]');
  for (let i = 0; i < 100; i++) {
    const started = performance.now();
    for (const index of [998,999]) state = interviewReducer(state, {type:'transcription',
      source:index % 2 ? 'mic' : 'system', utteranceId:String(index), revision:i+2,
      timestamp:Date.now(), text:`实时文字 ${index} 第 ${i} 次`, isFinal:i===99});
    flushSync(() => root.render(view()));
    timings.push((await paint())-started);
  }
  timings.sort((a,b)=>a-b);
  window.reportRenderCheck({platform:navigator.platform, messages:document.querySelectorAll('.chat-message').length,
    updates:200, historyNodePreserved:first===document.querySelector('[data-message="0"]'),
    latestBothVisible:document.body.textContent!.includes('实时文字 998 第 99 次') && document.body.textContent!.includes('实时文字 999 第 99 次'),
    medianUpdateToFrameMs:+timings[50]!.toFixed(2), p95UpdateToFrameMs:+timings[95]!.toFixed(2)});
}
void run().catch(error => window.reportRenderCheck({error:String(error)}));
