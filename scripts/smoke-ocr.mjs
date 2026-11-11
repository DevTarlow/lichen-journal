import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { OcrEngine } = require('../src/main/ocr.js');
const { resolveOcrPaths } = require('../src/main/ocr-utils.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(__dirname, '..');
const imagePath = path.resolve(process.argv[2] || path.join(__dirname, '..', 'tests', 'fixtures', 'ocr-journal-page.png'));
const paths = resolveOcrPaths({ isPackaged: false, appRoot });
const computeMode =
  process.env.LICHEN_COMPUTE_MODE === 'gpu'
    ? 'gpu'
    : process.env.LICHEN_COMPUTE_MODE === 'cpu'
      ? 'cpu'
      : process.platform === 'darwin' && process.arch === 'arm64'
        ? 'gpu'
        : 'cpu';
const requireGpu = process.env.LICHEN_REQUIRE_GPU === '1';

async function main() {
  const engine = new OcrEngine({ ...paths, computeMode });
  const started = performance.now();
  const result = await engine.recognize({ imagePath, requestId: 'smoke-ocr' });
  console.log(`Read ${result.text.length.toLocaleString()} characters in ${Math.round(performance.now() - started)} ms`);
  console.log(
    `Backend: ${result.backend}${result.fallback ? ' (fell back from the video card)' : ''}`
  );
  console.log('\n' + result.text);
  if (requireGpu && result.backend !== 'gpu') {
    console.error('GPU was required but photo reading used the processor.');
    process.exitCode = 1;
  }
  if (requireGpu && process.platform !== 'darwin') {
    try {
      const devices = execFileSync(paths.gpuRuntimePath, ['--list-devices'], {
        cwd: path.dirname(paths.gpuRuntimePath),
        encoding: 'utf8',
        timeout: 20_000
      });
      if (!devices.trim() || /\(none\)/i.test(devices)) {
        console.error('GPU was required but no video card device was reported.');
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(`GPU was required but the video-card runtime could not list devices: ${error.message}`);
      process.exitCode = 1;
    }
  }
  engine.dispose();
}

main().catch((error) => {
  console.error('\nOCR smoke test failed:', error);
  process.exitCode = 1;
});
