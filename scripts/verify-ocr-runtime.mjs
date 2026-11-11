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
const cpuTarget = path.join(vendorRoot, key);
const gpuTarget = path.join(cpuTarget, 'gpu');
const cpuOnly = process.argv.includes('--cpu-only');

if (!runtime) {
  console.error(`No pinned llama.cpp runtime for ${key}.`);
  process.exit(1);
}

let failed = false;

function checkArchive(spec) {
  const archivePath = path.join(vendorRoot, spec.archive);
  if (!fs.existsSync(archivePath)) return;
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(archivePath, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let read = 0;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  const digest = hash.digest('hex');
  console.log(`Archive SHA256: ${digest}`);
  if (digest !== spec.sha256) {
    console.error(`Checksum FAILED for ${spec.archive}.`);
    failed = true;
  }
}

function checkRuntime({ label, spec, targetDir, allowMissing }) {
  if (!spec) return;
  const binaryPath = path.join(targetDir, binaryName);
  if (!fs.existsSync(binaryPath)) {
    if (allowMissing) {
      console.warn(`${label} OCR runtime not installed: ${binaryPath}`);
      return;
    }
    console.error(`Missing ${label.toLowerCase()} OCR runtime: ${binaryPath}`);
    console.error('Run "npm run ocr:runtime:fetch" on this platform.');
    failed = true;
    return;
  }
  console.log(`${label} runtime: ${binaryPath}`);
  checkArchive(spec);
  try {
    const version = execFileSync(binaryPath, ['--version'], {
      cwd: targetDir,
      encoding: 'utf8',
      timeout: 20_000
    });
    console.log(version.trim());
  } catch (error) {
    console.error(`${label} runtime did not start: ${error.message}`);
    failed = true;
  }
  if (process.platform !== 'win32') {
    try {
      fs.accessSync(binaryPath, fs.constants.X_OK);
    } catch {
      console.error(`${label} runtime is not executable.`);
      failed = true;
    }
  }
}

console.log(`Release: ${OCR_RUNTIME_RELEASE}`);
checkRuntime({ label: 'CPU', spec: runtime, targetDir: cpuTarget });
if (!cpuOnly && runtime.gpu) {
  checkRuntime({
    label: 'Video-card',
    spec: runtime.gpu,
    targetDir: gpuTarget,
    allowMissing: false
  });
}

if (failed) process.exit(1);
console.log('OCR runtime verified.');
