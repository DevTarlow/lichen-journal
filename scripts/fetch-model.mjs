import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { DOWNLOADABLE_MODELS } = require('../src/main/model-catalog.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.join(__dirname, '..', 'models');

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function fetchModel(model) {
  const modelPath = path.join(modelsDir, model.file);
  const tempPath = `${modelPath}.part`;

  if (fs.existsSync(modelPath)) {
    const stat = fs.statSync(modelPath);
    process.stderr.write(`Checking existing ${model.file}…\n`);
    const digest = await sha256File(modelPath);
    if (stat.size === model.bytes && digest === model.sha256) {
      console.log(`${model.file} is already present and verified.`);
      return;
    }
    console.error(`Existing ${model.file} is truncated or altered; replacing it.`);
    fs.rmSync(modelPath, { force: true });
  }

  console.log(`Downloading ${model.file} (${(model.bytes / 1024 / 1024 / 1024).toFixed(2)} GiB)…`);
  const response = await fetch(model.url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }

  const total = Number(response.headers.get('content-length')) || model.bytes;
  const output = fs.createWriteStream(tempPath);
  const hash = crypto.createHash('sha256');
  let downloaded = 0;
  let lastPercent = -1;

  try {
    for await (const chunk of response.body) {
      hash.update(chunk);
      downloaded += chunk.byteLength;
      if (!output.write(chunk)) await once(output, 'drain');
      const percent = Math.floor((downloaded / total) * 100);
      if (percent !== lastPercent && percent % 2 === 0) {
        lastPercent = percent;
        process.stderr.write(
          `\r  ${percent.toString().padStart(3)}%  ${(downloaded / 1024 / 1024).toFixed(0)} MiB`
        );
      }
    }
    output.end();
    await once(output, 'finish');
  } catch (error) {
    output.destroy();
    fs.rmSync(tempPath, { force: true });
    throw error;
  }

  const digest = hash.digest('hex');
  if (downloaded !== model.bytes || digest !== model.sha256) {
    fs.rmSync(tempPath, { force: true });
    throw new Error(
      `Checksum mismatch for ${model.file} (${downloaded} bytes, sha256 ${digest}). Download discarded.`
    );
  }

  fs.renameSync(tempPath, modelPath);
  process.stderr.write('\r  100%  verified\n');
  console.log(`${model.file} installed at ${modelPath}`);
}

async function main() {
  fs.mkdirSync(modelsDir, { recursive: true });
  for (const model of DOWNLOADABLE_MODELS) {
    await fetchModel(model);
  }
}

main().catch((error) => {
  console.error(`\nModel fetch failed: ${error.message}`);
  process.exit(1);
});
