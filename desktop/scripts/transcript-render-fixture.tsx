import React, {useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {TranscriptList} from '../src/components/TranscriptList';
import {AnswerBody} from '../src/components/AnswerBody';
import {useAudioCapture} from '../src/hooks/useAudioCapture';
import '../src/screens/interview.css';

declare global {interface Window {
  reportRenderCheck: (result: unknown) => void;
  renderFixture: {publish: (events: [string, unknown][]) => Promise<void>};
}}
const root = createRoot(document.getElementById('root')!);
const select = () => {}, edit = () => {};
const text = '### 回答要点\n\n解释执行顺序与边界。\n\n```js\n// 先说明为什么在这里检查状态，再说明如何处理异常。\nconst value = 1;\n```\n\n'.repeat(30);
function View() {
  const {state} = useAudioCapture();
  useEffect(() => {void run().catch(error => window.reportRenderCheck({error:String(error)}));}, []);
  return <div style={{display:'grid', gridTemplateColumns:'38% 62%', height:'600px'}}>
    <div className="chat-scroll" style={{overflow:'auto', height:'600px'}}>
      <TranscriptList messages={state.conversation} multi={false} selected={[]}
        answeredIds='["0"]' onSelect={select} onEdit={edit} />
    </div>
    <div style={{overflow:'auto', height:'600px'}}><AnswerBody text={state.answers[0]?.text ?? ''} /></div>
  </div>;
}
const paint = () => new Promise<number>(resolve => requestAnimationFrame(() => resolve(performance.now())));
const row = (index: number) => document.querySelector(`[data-message="${index % 2 ? 'mic' : 'system'}:${index}"]`);
async function run() {
  const timings: number[] = [];
  await window.renderFixture.publish([
    ...Array.from({length:1000}, (_, i): [string, unknown] => ['Transcription', {
      utterance_id:String(i), revision:1, source:i % 2 ? 'mic' : 'system', is_final:false,
      text:`历史消息 ${i}：解释事件循环、微任务与异步执行的先后顺序。`,
    }]),
    ['LLMStart', {request_id:'fixture-answer'}],
    ['LLMChunk', {request_id:'fixture-answer', delta:text, chunk_index:0}],
  ]);
  while (document.querySelectorAll('.chat-message').length < 1000) await paint();
  const first = row(0);
  for (let i = 0; i < 100; i++) {
    const started = performance.now();
    await window.renderFixture.publish([
      ['LLMChunk', {request_id:'fixture-answer', delta:'补充解释实现细节与边界。\n\n', chunk_index:i+1}],
      ...[998,999].map((index): [string, unknown] => ['Transcription', {
        source:index % 2 ? 'mic' : 'system', utterance_id:String(index), revision:i+2,
        text:`实时文字 ${index} 第 ${i} 次`, is_final:i===99,
      }]),
    ]);
    // Real preload IPC -> hook -> reducer -> React. Only the initial mount
    // uses flushSync; updates must pass the application's actual scheduler.
    do {await paint();} while (![998,999].every(index =>
      row(index)?.textContent?.includes(`实时文字 ${index} 第 ${i} 次`)));
    timings.push(performance.now()-started);
  }
  timings.sort((a,b)=>a-b);
  window.reportRenderCheck({platform:navigator.platform, messages:document.querySelectorAll('.chat-message').length,
    updates:200, historyNodePreserved:first===row(0),
    latestBothVisible:[998,999].every(index => row(index)?.textContent?.includes(`实时文字 ${index} 第 99 次`)),
    medianUpdateToFrameMs:+timings[50]!.toFixed(2), p95UpdateToFrameMs:+timings[95]!.toFixed(2)});
}
flushSync(() => root.render(<View />));
