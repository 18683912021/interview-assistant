const fs = require('node:fs');
const path = require('node:path');
function ensureScreenshot(root = path.resolve(__dirname, '..')) {
  const out = path.join(root, 'dist-electron/screenshot');
  fs.mkdirSync(path.join(out, 'data'), {recursive: true});
  for (const file of ['selector.html', 'selector.js']) fs.copyFileSync(path.join(root, 'electron/screenshot', file), path.join(out, file));
  for (const lang of ['chi_sim', 'eng']) {
    const source = require.resolve(`@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`, {paths: [root]});
    fs.copyFileSync(source, path.join(out, 'data', `${lang}.traineddata.gz`));
  }
}
module.exports = {ensureScreenshot};
if (require.main === module) ensureScreenshot();
