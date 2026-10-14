import {parentPort} from 'node:worker_threads';
import path from 'node:path';
import fs from 'node:fs';
import {createWorker, OEM, PSM} from 'tesseract.js';
import {layoutText} from './layout-text.js';

// Isolated from both the renderer and audio thread. All data/models stay local.
const port = parentPort!;
for (const lang of ['eng', 'chi_sim']) {
  if (!fs.existsSync(path.join(__dirname, 'data', `${lang}.traineddata.gz`)))
    throw new Error('截图识别资源不完整，请重新安装最新版。');
}
const ready = createWorker(['chi_sim', 'eng'], OEM.LSTM_ONLY, {
  langPath: path.join(__dirname, 'data'), cacheMethod: 'none', gzip: true,
  logger: progress => {
    if (progress.status === 'recognizing text') port.postMessage({type: 'progress', progress: progress.progress});
  },
  // Library initialization failures must reach our owner, not leave a pending promise forever.
  errorHandler: () => {port.postMessage({type: 'error'});},
}).then(async worker => {
  await worker.setParameters({preserve_interword_spaces: '1', tessedit_pageseg_mode: PSM.SINGLE_BLOCK});
  return worker;
});
void ready.catch(() => port.postMessage({type: 'error'}));
port.on('message', async (bytes: Uint8Array) => {
  try {
    const worker = await ready;
    const {data} = await worker.recognize(Buffer.from(bytes), {}, {text: true, blocks: true});
    port.postMessage({type: 'result', text: layoutText(data.blocks, data.text), confidence: data.confidence});
  } catch {port.postMessage({type: 'error'});}
});
