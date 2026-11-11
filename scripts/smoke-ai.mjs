import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { AiEngine } = require('../src/main/ai.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelPath = path.join(__dirname, '..', 'models', 'MiniCPM-V-4_7-1B-Q4_K_M.gguf');

const SAMPLE = [
  'I walked by the river after the rain. The air smelled of moss and wet stone.',
  'I felt a quiet relief, then a small ache I could not name. I want to be gentler with myself this week.'
].join(' ');

function ms(start) {
  return Math.round(performance.now() - start);
}

async function main() {
  const engine = new AiEngine({ modelPath, appVersion: 'smoke' });
  engine.on('status', (status) => {
    if (status.state === 'loading' && status.loadProgress) {
      process.stderr.write(`\rloading model ${Math.round(status.loadProgress * 100)}%`);
    }
  });
  try {
    let start = performance.now();
    await engine.ensureLoaded();
    process.stderr.write('\n');
    console.log('model loaded', { backend: engine.getStatus().backend, ms: ms(start) });

    start = performance.now();
    const reflection = await engine.reflect({ text: SAMPLE, requestId: 'smoke-reflect' });
    console.log('\nREFLECTION', { ms: ms(start) });
    console.log(reflection);

    start = performance.now();
    const metadata = await engine.extractMetadata({ text: SAMPLE, requestId: 'smoke-metadata' });
    console.log('\nMETADATA', { ms: ms(start) });
    console.log(JSON.stringify(metadata, null, 2));

    start = performance.now();
    const palette = await engine.moodPalette({
      text: SAMPLE,
      mood: metadata.mood,
      requestId: 'smoke-palette'
    });
    console.log('\nPALETTE', { ms: ms(start) });
    console.log(JSON.stringify(palette, null, 2));
  } finally {
    await engine.dispose();
  }
}

main().catch((error) => {
  console.error('\nsmoke test failed:', error);
  process.exitCode = 1;
});
