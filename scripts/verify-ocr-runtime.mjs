import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  OCR_RUNTIME_MANIFEST,
  OCR_RUNTIME_RELEASE,
  currentRuntimeKey
} from './ocr-runtime-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vendorRoot = path.join(__dirname, '..', 'vendor', 'llama');
const key = currentRuntimeKey();
const runtime = OCR_RUNTIME_MANIFEST[key];
const binaryName = process.platform === 'win32' ? 'llama-mtmd-cli.exe' : 'llama-mtmd-cli';
const targetDir = path.join(vendorRoot, key);
const binaryPath = path.join(targetDir, binaryName);

if (!runtime) {
  console.error(`No pinned llama.cpp runtime for ${key}.`);
  process.exit(1);
}

if (!fs.existsSync(binaryPath)) {
  console.error(`Missing OCR runtime: ${binaryPath}`);
  console.error('Run "npm run ocr:runtime:fetch" on this platform.');
  process.exit(1);
}

const archivePath = path.join(vendorRoot, runtime.archive);
console.log(`Runtime: ${binaryPath}`);
console.log(`Release: ${OCR_RUNTIME_RELEASE}`);

if (fs.existsSync(archivePath)) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(archivePath)) hash.update(chunk);
  const digest = hash.digest('hex');
  console.log(`Archive SHA256: ${digest}`);
  if (digest !== runtime.sha256) {
    console.error('Archive checksum FAILED.');
    process.exit(1);
  }
}

try {
  const version = execFileSync(binaryPath, ['--version'], {
    cwd: targetDir,
    encoding: 'utf8',
    timeout: 20_000
  });
  console.log(version.trim());
} catch (error) {
  console.error(`Runtime did not start: ${error.message}`);
  process.exit(1);
}

if (process.platform !== 'win32') {
  try {
    fs.accessSync(binaryPath, fs.constants.X_OK);
  } catch {
    console.error('Runtime is not executable.');
    process.exit(1);
  }
}

console.log('OCR runtime verified.');
