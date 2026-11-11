import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { OcrEngine } = require('../src/main/ocr.js');
const { resolveOcrPaths } = require('../src/main/ocr-utils.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, '..');
const imagePath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'tests', 'fixtures', 'ocr-journal-page.png'));
const paths = resolveOcrPaths({ isPackaged: false, appRoot });

async function main() {
  const engine = new OcrEngine(paths);
  const started = performance.now();
  const result = await engine.recognize({ imagePath, requestId: 'smoke-ocr' });
  console.log(`Read ${result.text.length.toLocaleString()} characters in ${Math.round(performance.now() - started)} ms`);
  console.log('\n' + result.text);
  engine.dispose();
}

main().catch((error) => {
  console.error('\nOCR smoke test failed:', error);
  process.exitCode = 1;
});
