'use strict';

const { EventEmitter } = require('node:events');
const {
  ComputeError,
  computeCapabilities,
  friendlyComputeError
} = require('./compute-utils');
const { runGpuProbe } = require('./compute-probe');

class ComputeController extends EventEmitter {
  constructor({
    settings,
    ai,
    ocr,
    probe = runGpuProbe,
    platform = process.platform,
    arch = process.arch,
    overrideMode = null
  } = {}) {
    super();
    if (!settings || !ai) {
      throw new Error('ComputeController requires settings and an AI engine.');
    }
    this.settings = settings;
    this.ai = ai;
    this.ocr = ocr || null;
    this.probe = probe;
    this.capabilities = computeCapabilities(platform, arch);
    this.overrideMode =
      overrideMode === 'cpu' || overrideMode === 'gpu' ? overrideMode : null;
    this.testing = false;
    this.onFallback = (payload) => {
      this.#handleFallback(payload);
    };
    this.ai.on('fallback', this.onFallback);
  }

  getStatus() {
    const stored = this.settings.get().compute;
    const capabilities = this.capabilities;
    const mode = this.overrideMode
      ? this.overrideMode
      : capabilities.canChooseGpu
        ? stored.mode
        : capabilities.fixedMode;
    let aiStatus = {};
    try {
      aiStatus = this.ai.getStatus();
    } catch {
      aiStatus = {};
    }
    let ocrBackend = 'cpu';
    if (this.ocr) {
      try {
        ocrBackend = this.ocr.getStatus().backend || 'cpu';
      } catch {
        ocrBackend = 'cpu';
      }
    }
    const aiBusy =
      typeof this.ai.isBusy === 'function' ? this.ai.isBusy() : false;
    const busy = this.testing || aiBusy;
    return {
      mode,
      choiceMade: capabilities.canChooseGpu ? stored.choiceMade : true,
      verified:
        capabilities.canChooseGpu && mode === 'gpu' ? stored.verified : mode === 'gpu',
      backend:
        aiStatus.state === 'ready'
          ? aiStatus.backend || 'cpu'
          : mode === 'gpu'
            ? stored.backend || 'gpu'
            : 'cpu',
      lastError: stored.lastError ? { ...stored.lastError } : null,
      canChooseGpu: capabilities.canChooseGpu,
      reason: capabilities.reason,
      noun: capabilities.noun,
      modelPresent: Boolean(aiStatus.modelPresent),
      busy,
      aiBusy,
      ocrBackend,
      updatedAt: stored.updatedAt
    };
  }

  #emitChanged(event) {
    this.emit('changed', { ...this.getStatus(), event });
  }

  #applyMode(mode) {
    try {
      this.ai.setComputeMode(mode);
    } catch {
      // The engine still falls back safely on its next load.
    }
    if (this.ocr && typeof this.ocr.setComputeMode === 'function') {
      try {
        this.ocr.setComputeMode(mode);
      } catch {
        // Photo reading keeps its previous runtime until the next read.
      }
    }
  }

  apply() {
    this.#applyMode(this.getStatus().mode);
  }

  async useCpu() {
    if (!this.capabilities.canChooseGpu) {
      throw new ComputeError(
        'COMPUTE_UNAVAILABLE',
        "Video card acceleration isn't available on this computer."
      );
    }
    if (this.testing) {
      throw new ComputeError('COMPUTE_BUSY', 'The video card is already being checked.');
    }
    if (typeof this.ai.isBusy === 'function' && this.ai.isBusy()) {
      throw new ComputeError(
        'COMPUTE_BUSY',
        'Wait for the current companion request to finish, then try again.'
      );
    }
    this.settings.updateCompute({
      mode: 'cpu',
      choiceMade: true,
      verified: false,
      backend: 'cpu',
      lastError: null
    });
    this.#applyMode('cpu');
    await this.ai.unload();
    this.#emitChanged('mode-changed');
    return this.getStatus();
  }

  async testGpu() {
    if (!this.capabilities.canChooseGpu) {
      throw new ComputeError(
        'COMPUTE_UNAVAILABLE',
        "Video card acceleration isn't available on this computer."
      );
    }
    if (this.testing) {
      throw new ComputeError('COMPUTE_BUSY', 'The video card is already being checked.');
    }
    const current = this.settings.get().compute;
    if (typeof this.ai.isBusy === 'function' && this.ai.isBusy()) {
      throw new ComputeError(
        'COMPUTE_BUSY',
        'Wait for the current companion request to finish, then try again.'
      );
    }
    const aiStatus = this.ai.getStatus();
    if (!aiStatus.modelPresent) {
      throw new ComputeError(
        'COMPUTE_MODEL_MISSING',
        'Set up the companion model first, then you can check your video card.'
      );
    }

    this.testing = true;
    this.#emitChanged('testing');
    let result = null;
    try {
      await this.ai.unload();
      result = await this.probe({
        modelPath: aiStatus.modelPath,
        timeoutMs: 90_000,
        contextSize: 4096,
        maxTokens: 8
      });
    } catch (error) {
      result = {
        ok: false,
        error: {
          code: typeof error.code === 'string' ? error.code : 'GPU_PROBE_FAILED',
          message: typeof error.message === 'string' ? error.message : ''
        },
        details: error && error.message ? String(error.message) : ''
      };
    } finally {
      this.testing = false;
    }

    if (result && result.ok === true) {
      const backend = typeof result.backend === 'string' ? result.backend : 'gpu';
      this.settings.updateCompute({
        mode: 'gpu',
        choiceMade: true,
        verified: true,
        backend,
        lastError: null
      });
      this.#applyMode('gpu');
      this.#emitChanged('test-ok');
      return {
        ok: true,
        backend,
        gpuLayers: Number(result.gpuLayers) || 0,
        message: 'Your video card is ready. The companion will use it for faster answers.',
        status: this.getStatus()
      };
    }

    const error = (result && result.error) || {};
    const message = friendlyComputeError(error);
    const details =
      typeof result?.details === 'string'
        ? result.details
        : typeof error.message === 'string'
          ? error.message
          : '';
    this.settings.updateCompute({
      mode: 'cpu',
      choiceMade: true,
      verified: false,
      backend: 'cpu',
      lastError: {
        code: typeof error.code === 'string' ? error.code : 'GPU_UNAVAILABLE',
        message,
        details,
        at: new Date().toISOString()
      }
    });
    this.#applyMode('cpu');
    this.#emitChanged('test-failed');
    return {
      ok: false,
      message,
      status: this.getStatus()
    };
  }

  #handleFallback(payload) {
    if (!this.capabilities.canChooseGpu || this.overrideMode) return;
    const stored = this.settings.get().compute;
    if (stored.mode !== 'gpu') return;
    const message = friendlyComputeError(payload || null);
    try {
      this.settings.updateCompute({
        mode: 'cpu',
        verified: false,
        backend: 'cpu',
        lastError: {
          code:
            payload && typeof payload.code === 'string'
              ? payload.code
              : 'GPU_UNAVAILABLE',
          message,
          details:
            payload && typeof payload.details === 'string' ? payload.details : '',
          at: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('[lichen] could not save the processor fallback:', error.message);
    }
    this.#applyMode('cpu');
    this.#emitChanged('fallback');
  }

  dispose() {
    this.ai.removeListener('fallback', this.onFallback);
    this.removeAllListeners();
  }
}

module.exports = { ComputeController };
