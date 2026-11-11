'use strict';

const fs = require('node:fs');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const {
  truncateForModel,
  cleanReflection,
  normalizeMetadata,
  normalizePaletteResult,
  formatAiError
} = require('./ai-utils');
const {
  REFLECT_LENSES,
  DEFAULT_REFLECT_LENS,
  buildReflectSystemPrompt,
  METADATA_SYSTEM_PROMPT,
  PALETTE_SYSTEM_PROMPT,
  reflectionPrompt,
  metadataPrompt,
  numberSentences,
  palettePrompt
} = require('./ai-prompts');
const {
  friendlyComputeError,
  normalizeComputeMode,
  resolveRuntimeOptions
} = require('./compute-utils');

const CONTEXT_SIZE = 4096;
const MAX_THREADS = 8;

class AiEngineError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'AiEngineError';
    this.code = code;
    this.details = details;
  }
}

class AiEngine extends EventEmitter {
  constructor({ modelPath, appVersion = '1.0.0', computeMode = 'cpu' } = {}) {
    super();
    if (!modelPath) throw new Error('AiEngine requires a model path.');
    this.modelPath = modelPath;
    this.appVersion = appVersion;
    this.computeMode = normalizeComputeMode(computeMode);
    this.threads = Math.max(
      1,
      Math.min(MAX_THREADS, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1 || 1)
    );
    this.nlc = null;
    this.llama = null;
    this.model = null;
    this.loadPromise = null;
    this.queue = Promise.resolve();
    this.controllers = new Map();
    this.disposed = false;
    this.backend = 'cpu';
    this.accelerationBackend = 'cpu';
    this.gpuActive = false;
    this.gpuLayers = 0;
    this.computeFallback = null;
    this.status = {
      state: 'idle',
      backend: this.#intendedBackend(),
      computeMode: this.computeMode,
      gpuActive: false,
      gpuLayers: 0,
      accelerationBackend: 'cpu',
      computeFallback: null,
      threads: this.threads,
      loadProgress: 0,
      error: null,
      ...this.#modelFacts()
    };
    this.#refreshPresence();
  }

  #intendedBackend() {
    return this.computeMode === 'gpu' ? 'gpu' : 'cpu';
  }

  #modelFacts() {
    let modelPresent = false;
    let modelBytes = 0;
    try {
      const stat = fs.statSync(this.modelPath);
      modelPresent = stat.isFile() && stat.size > 0;
      modelBytes = stat.size;
    } catch {
      modelPresent = false;
    }
    return { modelPath: this.modelPath, modelPresent, modelBytes };
  }

  #refreshPresence() {
    const facts = this.#modelFacts();
    this.status = { ...this.status, ...facts };
    if (!facts.modelPresent && this.status.state === 'idle') {
      this.status.state = 'missing';
    } else if (
      facts.modelPresent &&
      (this.status.state === 'missing' || this.status.state === 'error')
    ) {
      this.status.state = 'idle';
      this.status.error = null;
    }
    return facts;
  }

  setModelPath(modelPath) {
    if (!modelPath || typeof modelPath !== 'string') return this.getStatus();
    this.modelPath = modelPath;
    this.#refreshPresence();
    this.#setStatus({});
    return this.getStatus();
  }

  refreshModelPresence() {
    this.#refreshPresence();
    this.#setStatus({});
    return this.getStatus();
  }

  getStatus() {
    return {
      state: this.status.state,
      modelPath: this.status.modelPath,
      modelPresent: this.status.modelPresent,
      modelBytes: this.status.modelBytes,
      backend: this.status.backend,
      accelerationBackend: this.status.accelerationBackend,
      computeMode: this.status.computeMode,
      gpuActive: this.status.gpuActive,
      gpuLayers: this.status.gpuLayers,
      computeFallback: this.status.computeFallback,
      threads: this.status.threads,
      loadProgress: this.status.loadProgress,
      error: this.status.error,
      ready: this.status.state === 'ready'
    };
  }

  #setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.getStatus());
  }

  setComputeMode(mode) {
    this.computeMode = normalizeComputeMode(mode);
    this.computeFallback = null;
    this.#setStatus({
      computeMode: this.computeMode,
      backend: this.#intendedBackend(),
      gpuActive: false,
      gpuLayers: 0,
      accelerationBackend: 'cpu',
      computeFallback: null
    });
    return this.getStatus();
  }

  isBusy() {
    return Boolean(this.loadPromise) || this.controllers.size > 0;
  }

  async unload() {
    if (this.disposed) return;
    this.cancelAll();
    if (this.loadPromise) {
      try {
        await this.loadPromise;
      } catch {
        // A failed load is exactly what the caller is trying to replace.
      }
    }
    try {
      await this.queue;
    } catch {
      // Ignore pending generation failures during unload.
    }
    if (this.llama) {
      try {
        await this.llama.dispose();
      } catch {
        // Best effort; a fresh runtime is loaded on the next request.
      }
    }
    this.llama = null;
    this.model = null;
    this.nlc = null;
    this.backend = 'cpu';
    this.accelerationBackend = 'cpu';
    this.gpuActive = false;
    this.gpuLayers = 0;
    this.#setStatus({
      state: 'idle',
      backend: this.#intendedBackend(),
      accelerationBackend: 'cpu',
      gpuActive: false,
      gpuLayers: 0,
      loadProgress: 0
    });
  }

  async ensureLoaded() {
    if (this.disposed) {
      throw new AiEngineError('AI_DISPOSED', 'The companion is shutting down.');
    }
    if (this.model) return;
    this.#refreshPresence();
    if (!this.status.modelPresent) {
      this.#setStatus({
        state: 'missing',
        error: {
          code: 'MODEL_MISSING',
          message: 'The MiniCPM-V model file is missing from this installation.'
        }
      });
      throw new AiEngineError(
        'MODEL_MISSING',
        'The local companion model is missing. Reinstall Lichen Journal or place the GGUF file beside the app.',
        this.modelPath
      );
    }
    if (!this.loadPromise) {
      this.loadPromise = this.#load().finally(() => {
        this.loadPromise = null;
      });
    }
    await this.loadPromise;
  }

  async #load({ strictGpu = false } = {}) {
    this.#setStatus({
      state: 'loading',
      loadProgress: 0,
      error: null,
      computeMode: this.computeMode,
      backend: this.#intendedBackend()
    });
    const requested = this.computeMode;
    let facts = null;
    try {
      facts = await this.#loadRuntime(requested, {
        strictGpu: strictGpu && requested === 'gpu'
      });
    } catch (error) {
      if (requested !== 'gpu' || strictGpu) {
        this.#failLoad(error);
        throw error instanceof AiEngineError
          ? error
          : new AiEngineError(
              'MODEL_LOAD_FAILED',
              this.status.error?.message ||
                'The companion model could not be loaded. It may be missing, corrupt, or out of memory.',
              error.message
            );
      }
      const fallback = {
        code: typeof error.code === 'string' ? error.code : 'GPU_UNAVAILABLE',
        message: friendlyComputeError(error),
        details: typeof error.message === 'string' ? error.message : ''
      };
      this.computeMode = 'cpu';
      this.#setStatus({
        state: 'loading',
        computeMode: 'cpu',
        backend: 'cpu',
        accelerationBackend: 'cpu',
        gpuActive: false,
        gpuLayers: 0,
        computeFallback: fallback
      });
      try {
        facts = await this.#loadRuntime('cpu', { strictGpu: false });
      } catch (cpuError) {
        this.#failLoad(cpuError);
        throw cpuError instanceof AiEngineError
          ? cpuError
          : new AiEngineError(
              'MODEL_LOAD_FAILED',
              this.status.error?.message ||
                'The companion model could not be loaded. It may be missing, corrupt, or out of memory.',
              cpuError.message
            );
      }
      this.#finishLoad(facts, fallback);
      this.emit('fallback', { from: 'gpu', to: 'cpu', ...fallback });
      return;
    }

    if (requested === 'gpu' && !facts.gpuActive) {
      const fallback = {
        code: 'GPU_UNAVAILABLE',
        message: friendlyComputeError({
          code: 'GPU_UNAVAILABLE',
          message: 'No layers could be placed on the video card.'
        }),
        details: `gpu=${facts.accelerationBackend}, layers=${facts.gpuLayers}`
      };
      this.computeMode = 'cpu';
      this.#finishLoad(facts, fallback);
      this.emit('fallback', { from: 'gpu', to: 'cpu', ...fallback });
      return;
    }

    this.#finishLoad(facts, null);
  }

  #finishLoad(facts, fallback) {
    this.backend = facts.gpuActive ? facts.accelerationBackend : 'cpu';
    this.accelerationBackend = facts.accelerationBackend;
    this.gpuActive = facts.gpuActive;
    this.gpuLayers = facts.gpuLayers;
    this.computeFallback = fallback;
    this.#setStatus({
      state: 'ready',
      backend: this.backend,
      accelerationBackend: this.accelerationBackend,
      computeMode: this.computeMode,
      gpuActive: this.gpuActive,
      gpuLayers: this.gpuLayers,
      computeFallback: fallback,
      loadProgress: 1,
      error: null,
      ...this.#modelFacts()
    });
  }

  async #loadRuntime(mode, { strictGpu = false } = {}) {
    const nlc = this.nlc || (await import('node-llama-cpp'));
    this.nlc = nlc;
    const runtime = resolveRuntimeOptions(mode, process.platform, process.arch, {
      strictGpu
    });
    let llama = null;
    try {
      llama = await nlc.getLlama({
        gpu: runtime.gpu,
        build: 'never',
        skipDownload: true,
        logLevel: 'error',
        maxThreads: this.threads
      });
      const model = await llama.loadModel({
        modelPath: this.modelPath,
        gpuLayers: runtime.gpuLayers,
        onLoadProgress: (progress) => {
          this.#setStatus({ state: 'loading', loadProgress: progress });
        }
      });
      const gpuLayers = Number(model.gpuLayers) || 0;
      const gpuActive = Boolean(llama.gpu) && gpuLayers > 0;
      if (strictGpu && !gpuActive) {
        const error = new AiEngineError(
          'GPU_UNAVAILABLE',
          'The video card could not be used.',
          `gpu=${llama.gpu || 'cpu'}, layers=${gpuLayers}`
        );
        try {
          await llama.dispose();
        } catch {
          // Ignore disposal failures while reporting the original error.
        }
        throw error;
      }
      this.llama = llama;
      this.model = model;
      return {
        gpuActive,
        gpuLayers,
        accelerationBackend: llama.gpu ? String(llama.gpu) : 'cpu'
      };
    } catch (error) {
      if (llama && this.llama !== llama) {
        try {
          await llama.dispose();
        } catch {
          // Ignore disposal failures while reporting the original error.
        }
      }
      throw error;
    }
  }

  #failLoad(error) {
    this.llama = null;
    this.model = null;
    this.gpuActive = false;
    this.gpuLayers = 0;
    this.accelerationBackend = 'cpu';
    const message =
      error instanceof AiEngineError
        ? error.message
        : 'The companion model could not be loaded. It may be missing, corrupt, or out of memory.';
    this.#setStatus({
      state: 'error',
      backend: 'cpu',
      accelerationBackend: 'cpu',
      gpuActive: false,
      gpuLayers: 0,
      loadProgress: 0,
      error: {
        code: error.code || 'MODEL_LOAD_FAILED',
        message
      }
    });
  }

  #enqueue(task) {
    const run = this.queue.then(() => {
      if (this.disposed) {
        throw new AiEngineError('AI_DISPOSED', 'The companion is shutting down.');
      }
      return task();
    });
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async #withRequest(requestId, task) {
    const id = String(requestId || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    if (this.controllers.has(id)) {
      throw new AiEngineError('AI_BUSY', 'A companion request is already running.');
    }
    const controller = new AbortController();
    this.controllers.set(id, controller);
    try {
      return await this.#enqueue(() => task(controller.signal));
    } finally {
      this.controllers.delete(id);
    }
  }

  cancel(requestId) {
    const controller = this.controllers.get(String(requestId || ''));
    if (!controller) return false;
    controller.abort(new AiEngineError('AI_CANCELLED', 'The companion request was cancelled.'));
    return true;
  }

  cancelAll() {
    for (const controller of this.controllers.values()) {
      controller.abort(new AiEngineError('AI_CANCELLED', 'The companion request was cancelled.'));
    }
  }

  async #runPrompt({
    systemPrompt,
    prompt,
    responsePrefix,
    maxTokens,
    temperature,
    topP,
    signal,
    onChunk
  }) {
    await this.ensureLoaded();
    if (signal && signal.aborted) {
      throw new AiEngineError('AI_CANCELLED', 'The companion request was cancelled.');
    }

    const context = await this.model.createContext({
      contextSize: CONTEXT_SIZE,
      sequences: 1
    });
    let session = null;
    try {
      session = new this.nlc.LlamaChatSession({
        contextSequence: context.getSequence(),
        systemPrompt
      });
      const response = await session.prompt(prompt, {
        responsePrefix,
        maxTokens,
        temperature,
        topP,
        topK: 40,
        signal,
        stopOnAbortSignal: true,
        trimWhitespaceSuffix: true,
        onTextChunk: onChunk
          ? (chunk) => {
              if (signal && signal.aborted) return;
              onChunk(chunk);
            }
          : undefined
      });
      if (signal && signal.aborted) {
        throw new AiEngineError('AI_CANCELLED', 'The companion request was cancelled.');
      }
      return response;
    } catch (error) {
      if (signal && signal.aborted) {
        throw new AiEngineError('AI_CANCELLED', 'The companion request was cancelled.');
      }
      if (error && (error.name === 'AbortError' || error.code === 'ABORT_ERR')) {
        throw new AiEngineError('AI_CANCELLED', 'The companion request was cancelled.');
      }
      throw error;
    } finally {
      if (session) {
        try {
          session.dispose({ disposeSequence: false });
        } catch {
          // Best effort cleanup.
        }
      }
      try {
        await context.dispose();
      } catch {
        // Best effort cleanup.
      }
    }
  }

  async reflect({ text, requestId, onChunk, lens = DEFAULT_REFLECT_LENS, carry = '' } = {}) {
    const entry = truncateForModel(text);
    if (!entry) {
      throw new AiEngineError('EMPTY_ENTRY', 'Write a little before asking the companion to reflect.');
    }
    const angle = Object.prototype.hasOwnProperty.call(REFLECT_LENSES, lens)
      ? lens
      : DEFAULT_REFLECT_LENS;
    return this.#withRequest(requestId, async (signal) => {
      let raw = await this.#runPrompt({
        systemPrompt: buildReflectSystemPrompt(angle),
        prompt: reflectionPrompt(entry, { carry }),
        maxTokens: 112,
        temperature: 0.72,
        topP: 0.9,
        signal,
        onChunk
      });
      if (typeof raw !== 'string' || !raw.trim()) {
        // A cold or unsettled first pass occasionally returns no text. One
        // quiet retry is cheaper than making the writer sit with the fallback.
        raw = await this.#runPrompt({
          systemPrompt: buildReflectSystemPrompt(angle),
          prompt: reflectionPrompt(entry, { carry }),
          maxTokens: 140,
          temperature: 0.8,
          topP: 0.9,
          signal,
          onChunk
        });
      }
      return cleanReflection(raw);
    });
  }

  async extractMetadata({ text, requestId } = {}) {
    const entry = truncateForModel(text);
    if (!entry) {
      throw new AiEngineError('EMPTY_ENTRY', 'Write a little before extracting insights.');
    }
    const { text: numberedEntry, sentences } = numberSentences(entry);
    return this.#withRequest(requestId, async (signal) => {
      const raw = await this.#runPrompt({
        systemPrompt: METADATA_SYSTEM_PROMPT,
        prompt: metadataPrompt(numberedEntry, { anchors: sentences.length }),
        responsePrefix: '{"mood":',
        maxTokens: 650,
        temperature: 0.1,
        topP: 0.9,
        signal
      });
      return normalizeMetadata(raw, entry, sentences);
    });
  }

  async moodPalette({ text, requestId, mood = null } = {}) {
    const entry = truncateForModel(text);
    if (!entry) {
      throw new AiEngineError('EMPTY_ENTRY', 'Write a little before creating a palette.');
    }
    return this.#withRequest(requestId, async (signal) => {
      const raw = await this.#runPrompt({
        systemPrompt: PALETTE_SYSTEM_PROMPT,
        prompt: palettePrompt(entry),
        responsePrefix: '{"hex_colors":["',
        maxTokens: 220,
        temperature: 0.35,
        topP: 0.92,
        signal
      });
      return normalizePaletteResult(raw, { text: entry, mood });
    });
  }

  async reload() {
    if (this.disposed) {
      throw new AiEngineError('AI_DISPOSED', 'The companion is shutting down.');
    }
    this.cancelAll();
    await this.unload();
    this.#setStatus({ state: 'idle', error: null, loadProgress: 0 });
    await this.ensureLoaded();
    return this.getStatus();
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAll();
    try {
      await this.queue;
    } catch {
      // Ignore pending generation failures during shutdown.
    }
    try {
      if (this.llama) await this.llama.dispose();
    } catch {
      // Never throw during shutdown.
    }
    this.llama = null;
    this.model = null;
    this.nlc = null;
    this.gpuActive = false;
    this.gpuLayers = 0;
    this.accelerationBackend = 'cpu';
    this.#setStatus({ state: 'disposed', backend: 'cpu', gpuActive: false, gpuLayers: 0, loadProgress: 0 });
  }

  static errorPayload(error) {
    const formatted = formatAiError(error);
    return {
      ...formatted,
      details: error && typeof error.details === 'string' ? error.details : undefined
    };
  }
}

module.exports = { AiEngine, AiEngineError };
