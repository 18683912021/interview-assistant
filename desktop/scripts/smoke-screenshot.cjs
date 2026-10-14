// Real offline OCR using a synthetic fixture: never captures a user's desktop or opens devices.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv.find(arg => arg.startsWith('--root='))?.slice(7) || path.resolve(__dirname, '../dist-electron');
const {LocalOCR} = require(path.join(root, 'screenshot/local-ocr.js'));
(async () => {
  const ocr = new LocalOCR();
  const runs = [];
  try {
    for (let index = 0; index < 2; index++) {
      const start = performance.now();
      const result = await ocr.recognize(fs.readFileSync(path.resolve(__dirname, '../electron/tests/fixtures/ocr-question.png')),
        new AbortController().signal, () => {});
      for (const phrase of ['运输费用', 'carrier', 'orders.reduce']) assert.ok(result.text.includes(phrase), `Missing recognized phrase: ${phrase}`);
      assert.match(result.text, /\n +return orders/);
      runs.push({ms: Math.round(performance.now() - start), confidence: result.confidence});
    }
    const cancelled = new AbortController();
    const aborted = ocr.recognize(fs.readFileSync(path.resolve(__dirname, '../electron/tests/fixtures/ocr-question.png')), cancelled.signal, () => {});
    cancelled.abort();
    await assert.rejects(aborted, /取消/);
    const retry = await ocr.recognize(fs.readFileSync(path.resolve(__dirname, '../electron/tests/fixtures/ocr-question.png')), new AbortController().signal, () => {});
    assert.ok(retry.text.includes('运输费用'));
    console.log(JSON.stringify({offlineOCR: true, chineseEnglishCode: true, codeIndentation: true, cancelAndRetry: true, runs}));
  } finally {ocr.dispose();}
})().catch(error => {console.error(error.message); process.exitCode = 1;});
