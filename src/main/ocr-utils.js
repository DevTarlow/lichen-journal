'use strict';

const path = require('node:path');

const MAX_OCR_TEXT_CHARS = 200_000;
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_OCR_THREADS = 8;
const OCR_PROMPT = 'Text Recognition:';

function stripAnsi(value) {
  return String(value || '').replace(
    // eslint-disable-next-line no-control-regex
    /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
    ''
  );
}

function cleanOcrText(raw) {
  let text = stripAnsi(raw).replace(/\r\n?/g, '\n');
  text = text
    .replace(/\[Start thinking\][\s\S]*?\[End thinking\]/gi, ' ')
    .replace(/\[(?:Start|End)\s+thinking\]/gi, ' ')
    .replace(/<\/?think>/gi, ' ')
    .replace(/<\|[^|>\n]{1,64}\|>/g, ' ')
    .replace(/^\s*```[a-z-]*\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '');

  const lines = text.split('\n');
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true;
    if (/^(?:assistant|user|system)\s*:?\s*$/i.test(trimmed)) return false;
    if (/^Text Recognition:\s*$/i.test(trimmed)) return false;
    return true;
  });
  text = filtered.join('\n');
  text = text.replace(/^\s*Text Recognition:\s*/i, '');
  text = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return Array.from(text).slice(0, MAX_OCR_TEXT_CHARS).join('');
}

function mergeOcrText(existingBody, ocrText) {
  const base = String(existingBody || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+$/u, '');
  const addition = String(ocrText || '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!addition) return base;
  if (!base) return addition;
  return `${base}\n\n${addition}`;
}

function buildOcrArgs({
  modelPath,
  projectorPath,
  imagePath,
  threads = 8,
  platform = process.platform
}) {
  const safeThreads = Math.max(1, Math.min(MAX_OCR_THREADS, Number(threads) || 1));
  const metal = platform === 'darwin';
  return [
    '-m',
    modelPath,
    '--mmproj',
    projectorPath,
    '--image',
    imagePath,
    '-p',
    OCR_PROMPT,
    '--jinja',
    '-c',
    '8192',
    '-n',
    '4096',
    '--temp',
    '0',
    '--top-k',
    '1',
    '--top-p',
    '1',
    '--no-warmup',
    '-t',
    String(safeThreads),
    '--log-colors',
    'off',
    '-ngl',
    metal ? '99' : '0',
    metal ? '--mmproj-offload' : '--no-mmproj-offload'
  ];
}

function runtimeBinaryName(platform = process.platform) {
  return platform === 'win32' ? 'llama-mtmd-cli.exe' : 'llama-mtmd-cli';
}

function resolveOcrPaths({
  isPackaged,
  resourcesPath,
  appRoot,
  modelDir,
  platform = process.platform,
  arch = process.arch
}) {
  const binary = runtimeBinaryName(platform);
  const models = modelDir || (isPackaged ? path.join(resourcesPath, 'models') : path.join(appRoot, 'models'));
  return {
    modelPath: path.join(models, 'MiniCPM-OCR-1_0-Q4_K_M.gguf'),
    projectorPath: path.join(models, 'mmproj-model-f16-4x.gguf'),
    runtimePath: isPackaged
      ? path.join(resourcesPath, 'llama', binary)
      : path.join(appRoot, 'vendor', 'llama', `${platform}-${arch}`, binary)
  };
}

function supportedImageExtension(filePath) {
  return /\.(?:png|jpe?g|webp)$/i.test(String(filePath || ''));
}

function formatOcrError(error) {
  if (!error) return { code: 'OCR_FAILED', message: 'The photo could not be read.' };
  return {
    code: typeof error.code === 'string' ? error.code : 'OCR_FAILED',
    message:
      typeof error.message === 'string' ? error.message : 'The photo could not be read.'
  };
}

module.exports = {
  MAX_OCR_TEXT_CHARS,
  MAX_STDOUT_BYTES,
  MAX_IMAGE_BYTES,
  DEFAULT_TIMEOUT_MS,
  MAX_OCR_THREADS,
  OCR_PROMPT,
  stripAnsi,
  cleanOcrText,
  mergeOcrText,
  buildOcrArgs,
  runtimeBinaryName,
  resolveOcrPaths,
  supportedImageExtension,
  formatOcrError
};
