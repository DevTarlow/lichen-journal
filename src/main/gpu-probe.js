'use strict';

// Runs in a separate Node process so a broken driver cannot take the journal
// down. The parent reads the single result line; all other output is log noise.

const fs = require('node:fs');
const { resolveRuntimeOptions } = require('./compute-utils');

const RESULT_PREFIX = 'LICHEN_GPU_PROBE_RESULT ';

function emit(result) {
  try {
    // A synchronous write survives the explicit exit below.
    fs.writeSync(1, `${RESULT_PREFIX}${JSON.stringify(result)}\n`);
  } catch {
    // The parent will report a failed probe if stdout is unavailable.
  }
}

function readConfig() {
  const raw = process.env.LICHEN_GPU_PROBE;
  if (!raw) throw new Error('The video card check was not configured.');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('The video card check was not configured.');
  }
  return parsed;
}

async function main() {
  const config = readConfig();
  const modelPath = typeof config.modelPath === 'string' ? config.modelPath : '';
  let stat = null;
  try {
    stat = fs.statSync(modelPath);
  } catch {
    stat = null;
  }
  if (!stat || !stat.isFile() || stat.size <= 0) {
    emit({
      ok: false,
      error: { code: 'MODEL_MISSING', message: 'The companion model is missing.' }
    });
    return;
  }

  const nlc = await import('node-llama-cpp');
  const runtime = resolveRuntimeOptions('gpu', process.platform, process.arch, {
    strictGpu: true
  });
  const contextSize = Number(config.contextSize) || 4096;
  const maxTokens = Number(config.maxTokens) || 8;

  let llama = null;
  let model = null;
  let context = null;
  let session = null;
  try {
    llama = await nlc.getLlama({
      gpu: runtime.gpu,
      build: 'never',
      skipDownload: true,
      logLevel: 'error'
    });
    model = await llama.loadModel({
      modelPath,
      gpuLayers: runtime.gpuLayers
    });
    const gpuLayers = Number(model.gpuLayers) || 0;
    if (!llama.gpu || gpuLayers <= 0) {
      const error = new Error('No layers could be placed on the video card.');
      error.code = 'GPU_UNAVAILABLE';
      throw error;
    }
    context = await model.createContext({ contextSize, sequences: 1 });
    session = new nlc.LlamaChatSession({
      contextSequence: context.getSequence(),
      systemPrompt: 'You are a concise assistant.'
    });
    const text = await session.prompt('Reply with the single word: ready.', {
      maxTokens,
      temperature: 0,
      topP: 1,
      topK: 1
    });
    emit({
      ok: true,
      backend: String(llama.gpu),
      gpuLayers,
      text: typeof text === 'string' ? text : ''
    });
  } catch (error) {
    emit({
      ok: false,
      error: {
        code: typeof error.code === 'string' ? error.code : 'GPU_UNAVAILABLE',
        message:
          typeof error.message === 'string'
            ? error.message
            : 'The video card could not be used.'
      }
    });
  } finally {
    try {
      if (session) session.dispose({ disposeSequence: false });
    } catch {
      // Best effort cleanup.
    }
    try {
      if (context) await context.dispose();
    } catch {
      // Best effort cleanup.
    }
    try {
      if (model) await model.dispose();
    } catch {
      // Best effort cleanup.
    }
    try {
      if (llama) await llama.dispose();
    } catch {
      // Best effort cleanup.
    }
  }
}

main()
  .catch((error) => {
    emit({
      ok: false,
      error: {
        code: typeof error.code === 'string' ? error.code : 'GPU_PROBE_FAILED',
        message:
          typeof error.message === 'string'
            ? error.message
            : 'The video card check failed.'
      }
    });
  })
  .finally(() => {
    process.exit(0);
  });
