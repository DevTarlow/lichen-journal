import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import {
  OCR_RUNTIME_MANIFEST,
  currentRuntimeKey
} from './ocr-runtime-manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vendorRoot = path.join(__dirname, '..', 'vendor', 'llama');
const key = currentRuntimeKey();
const runtime = OCR_RUNTIME_MANIFEST[key];
const cpuOnly = process.argv.includes('--cpu-only');

function binaryName() {
  return process.platform === 'win32' ? 'llama-mtmd-cli.exe' : 'llama-mtmd-cli';
}

function copyRuntimeTree(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isSymbolicLink()) {
      const realPath = fs.realpathSync(sourcePath);
      const stat = fs.statSync(realPath);
      if (stat.isDirectory()) copyRuntimeTree(realPath, targetPath);
      else fs.copyFileSync(realPath, targetPath);
    } else if (entry.isDirectory()) {
      copyRuntimeTree(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function findRuntimeDir(root) {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === binaryName()) return current;
    }
  }
  return null;
}

async function installVariant({ label, spec, targetDir }) {
  if (!spec) return;
  const binaryPath = path.join(targetDir, binaryName());
  if (fs.existsSync(binaryPath)) {
    console.log(`${label} OCR runtime already present at ${targetDir}`);
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichen-ocr-runtime-'));
  const archivePath = path.join(workDir, spec.archive);
  const extractDir = path.join(workDir, 'extract');
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    console.log(
      `Downloading ${spec.archive} (${(spec.bytes / 1024 / 1024).toFixed(1)} MiB)…`
    );
    const response = await fetch(spec.url, { redirect: 'follow' });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed with HTTP ${response.status}`);
    }

    const output = fs.createWriteStream(archivePath);
    const hash = crypto.createHash('sha256');
    let downloaded = 0;
    try {
      for await (const chunk of response.body) {
        hash.update(chunk);
        downloaded += chunk.byteLength;
        if (!output.write(chunk)) await once(output, 'drain');
      }
      output.end();
      await once(output, 'finish');
    } catch (error) {
      output.destroy();
      throw error;
    }

    const digest = hash.digest('hex');
    if (downloaded !== spec.bytes || digest !== spec.sha256) {
      throw new Error(
        `Checksum mismatch for ${spec.archive} (${downloaded} bytes, sha256 ${digest}).`
      );
    }

    if (spec.archive.endsWith('.zip')) {
      new AdmZip(archivePath).extractAllTo(extractDir, true);
    } else {
      execFileSync('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: 'inherit' });
    }

    const sourceDir = findRuntimeDir(extractDir);
    if (!sourceDir) {
      throw new Error(`Could not find ${binaryName()} in ${spec.archive}.`);
    }

    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.mkdirSync(targetDir, { recursive: true });
    copyRuntimeTree(sourceDir, targetDir);

    const licenseSource = path.join(vendorRoot, 'LICENSE');
    if (fs.existsSync(licenseSource)) {
      fs.copyFileSync(licenseSource, path.join(targetDir, 'LICENSE'));
    }
    if (process.platform !== 'win32') {
      fs.chmodSync(binaryPath, 0o755);
    }
    try {
      execFileSync(binaryPath, ['--version'], {
        cwd: targetDir,
        stdio: 'ignore',
        timeout: 20_000
      });
    } catch {
      throw new Error(`Installed runtime at ${binaryPath} did not start.`);
    }
    if (label !== 'CPU') {
      try {
        const devices = execFileSync(binaryPath, ['--list-devices'], {
          cwd: targetDir,
          encoding: 'utf8',
          timeout: 20_000
        });
        console.log(devices.trim() || 'No video card devices reported.');
      } catch {
        // A build machine without a video card is fine; the app falls back.
      }
    }

    console.log(`${label} OCR runtime installed at ${targetDir}`);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function main() {
  if (!runtime) {
    throw new Error(`No pinned llama.cpp runtime for ${key}.`);
  }
  fs.mkdirSync(vendorRoot, { recursive: true });
  const cpuTarget = path.join(vendorRoot, key);
  await installVariant({ label: 'CPU', spec: runtime, targetDir: cpuTarget });
  if (!cpuOnly && runtime.gpu) {
    await installVariant({
      label: 'Video-card',
      spec: runtime.gpu,
      targetDir: path.join(cpuTarget, 'gpu')
    });
  }
}

main().catch((error) => {
  console.error(`\nOCR runtime fetch failed: ${error.message}`);
  process.exit(1);
});
