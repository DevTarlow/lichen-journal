import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DOWNLOADABLE_MODELS } = require('../src/main/model-catalog.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.join(__dirname, '..', 'models');

let failed = false;

for (const model of DOWNLOADABLE_MODELS) {
  const modelPath = path.join(modelsDir, model.file);
  console.log(`\n${model.file}`);

  if (!fs.existsSync(modelPath)) {
    console.error(`Missing model: ${modelPath}`);
    console.error('Run "npm run model:fetch" or copy the GGUF there manually.');
    failed = true;
    continue;
  }

  const stat = fs.statSync(modelPath);
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(modelPath)) hash.update(chunk);
  const digest = hash.digest('hex');

  console.log(`  Path:   ${modelPath}`);
  console.log(`  Bytes:  ${stat.size.toLocaleString()} (expected ${model.bytes.toLocaleString()})`);
  console.log(`  SHA256: ${digest}`);
  console.log(`  Expect: ${model.sha256}`);

  if (stat.size !== model.bytes || digest !== model.sha256) {
    console.error('  Verification FAILED. Replace this file with a fresh download.');
    failed = true;
  }
}

if (failed) {
  console.error('\nModel verification FAILED.');
  process.exit(1);
}
console.log('\nAll models verified.');
