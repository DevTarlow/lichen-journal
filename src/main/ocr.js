'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const {
  MAX_STDOUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  MAX_OCR_THREADS,
  cleanOcrText,
  buildOcrArgs
} = require('./ocr-utils');
const { normalizeComputeMode } = require('./compute-utils');
const { photoReader: photoReaderCopy } = require('./copy');

class OcrEngineError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'OcrEngineError';
    this.code = code;
    this.details = details;
  }
}

class OcrEngine extends EventEmitter {
  constructor({
    runtimePath,
    modelPath,
    projectorPath,
    gpuRuntimePath = '',
    threads = 8,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    computeMode = 'cpu'
  } = {}) {
    super();
    if (!runtimePath || !modelPath || !projectorPath) {
      throw new Error('OcrEngine requires runtime, model, and projector paths.');
    }
    this.runtimePath = runtimePath;
    this.gpuRuntimePath = typeof gpuRuntimePath === 'string' ? gpuRuntimePath : '';
    this.modelPath = modelPath;
    this.projectorPath = projectorPath;
    this.threads = Math.max(1, Math.min(MAX_OCR_THREADS, Number(threads) || 1));
    this.timeoutMs = timeoutMs;
    this.computeMode = normalizeComputeMode(computeMode);
    this.gpuFailed = false;
    this.running = new Map();
    this.disposed = false;
    this.lastError = null;
    this.status = {
      state: 'idle',
      error: null,
      computeMode: this.computeMode,
      backend: this.#backend(),
      ...this.#facts()
    };
    this.#refreshState();
  }

  #exists(filePath) {
    try {
      const stat = fs.statSync(filePath);
      return stat.isFile() && stat.size > 0;
    } catch {
      return false;
    }
  }

  #facts() {
    return {
      runtimePath: this.runtimePath,
      gpuRuntimePath: this.gpuRuntimePath,
      modelPath: this.modelPath,
      projectorPath: this.projectorPath,
      runtimePresent: this.#exists(this.runtimePath),
      gpuRuntimePresent: Boolean(this.gpuRuntimePath) && this.#exists(this.gpuRuntimePath),
      modelPresent: this.#exists(this.modelPath),
      projectorPresent: this.#exists(this.projectorPath)
    };
  }

  #selectedRuntime() {
    if (
      this.computeMode === 'gpu' &&
      !this.gpuFailed &&
      this.gpuRuntimePath &&
      this.#exists(this.gpuRuntimePath)
    ) {
      return { path: this.gpuRuntimePath, gpu: true };
    }
    return { path: this.runtimePath, gpu: false };
  }

  #backend() {
    return this.#selectedRuntime().gpu ? 'gpu' : 'cpu';
  }

  #refreshState() {
    const facts = this.#facts();
    let state = this.status.state;
    if (!facts.runtimePresent || !facts.modelPresent || !facts.projectorPresent) {
      state = 'missing';
    } else if (this.running.size > 0) {
      state = 'running';
    } else if (state === 'missing') {
      state = 'idle';
    }
    this.status = {
      ...this.status,
      ...facts,
      state,
      computeMode: this.computeMode,
      backend: this.#backend(),
      error: this.status.error
    };
    return facts;
  }

  getStatus() {
    this.#refreshState();
    return {
      state: this.status.state,
      runtimePath: this.status.runtimePath,
      gpuRuntimePath: this.status.gpuRuntimePath,
      modelPath: this.status.modelPath,
      projectorPath: this.status.projectorPath,
      runtimePresent: this.status.runtimePresent,
      gpuRuntimePresent: this.status.gpuRuntimePresent,
      modelPresent: this.status.modelPresent,
      projectorPresent: this.status.projectorPresent,
      computeMode: this.status.computeMode,
      backend: this.status.backend,
      error: this.status.error,
      busyRequestId: this.running.size ? [...this.running.keys()][0] : null
    };
  }

  #setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.getStatus());
  }

  setComputeMode(mode) {
    this.computeMode = normalizeComputeMode(mode);
    this.gpuFailed = false;
    this.#setStatus({ computeMode: this.computeMode, backend: this.#backend() });
    return this.getStatus();
  }

  setModelPaths({ modelPath, projectorPath } = {}) {
    if (this.running.size > 0) {
      throw new OcrEngineError('OCR_BUSY', 'Wait for the current photo to finish.');
    }
    if (typeof modelPath === 'string' && modelPath) this.modelPath = modelPath;
    if (typeof projectorPath === 'string' && projectorPath) this.projectorPath = projectorPath;
    const facts = this.#refreshState();
    if (facts.runtimePresent && facts.modelPresent && facts.projectorPresent) {
      this.status.state = 'idle';
      this.status.error = null;
    }
    this.#setStatus({});
    return this.getStatus();
  }

  refreshStatus() {
    this.#refreshState();
    this.#setStatus({});
    return this.getStatus();
  }

  #ensureReady(selected = this.#selectedRuntime()) {
    if (this.disposed) {
      throw new OcrEngineError('OCR_DISPOSED', 'The photo reader is shutting down.');
    }
    const facts = this.#refreshState();
    if (!this.#exists(selected.path)) {
      throw new OcrEngineError(
        'OCR_RUNTIME_MISSING',
        photoReaderCopy.errors.runtimeMissing,
        selected.path
      );
    }
    if (!facts.modelPresent || !facts.projectorPresent) {
      throw new OcrEngineError(
        'OCR_MODEL_MISSING',
        photoReaderCopy.errors.notInstalled,
        facts.modelPresent ? this.projectorPath : this.modelPath
      );
    }
  }

  async recognize({ imagePath, requestId } = {}) {
    const selected = this.#selectedRuntime();
    this.#ensureReady(selected);
    if (!imagePath || typeof imagePath !== 'string') {
      throw new OcrEngineError('INVALID_IMAGE', 'A photo path is required.');
    }
    let stat;
    try {
      stat = fs.statSync(imagePath);
    } catch {
      throw new OcrEngineError('INVALID_IMAGE', 'That photo could not be opened.');
    }
    if (!stat.isFile() || stat.size <= 0) {
      throw new OcrEngineError('INVALID_IMAGE', 'That photo could not be opened.');
    }
    if (this.running.size > 0) {
      throw new OcrEngineError('OCR_BUSY', 'A photo is already being read. Wait for it to finish.');
    }

    const id = String(requestId || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const startedAt = Date.now();
    const state = { cancelled: false, currentCancel: null };
    const entry = {
      cancel: () => {
        state.cancelled = true;
        try {
          state.currentCancel?.();
        } catch {
          // The current attempt may already have exited.
        }
      }
    };
    this.running.set(id, entry);
    this.#setStatus({ state: 'running', error: null, backend: selected.gpu ? 'gpu' : 'cpu' });

    const attempts = selected.gpu
      ? [
          { runtimePath: this.gpuRuntimePath, gpu: true },
          { runtimePath: this.runtimePath, gpu: false }
        ]
      : [{ runtimePath: this.runtimePath, gpu: false }];

    let lastError = null;
    try {
      for (let index = 0; index < attempts.length; index += 1) {
        const attempt = attempts[index];
        if (state.cancelled) {
          throw new OcrEngineError('OCR_CANCELLED', 'Photo reading was cancelled.');
        }
        try {
          const result = await this.#readOnce({
            runtimePath: attempt.runtimePath,
            gpu: attempt.gpu,
            imagePath,
            state
          });
          this.gpuFailed = index > 0;
          return {
            ...result,
            fileName: path.basename(imagePath),
            durationMs: Date.now() - startedAt,
            backend: attempt.gpu ? 'gpu' : 'cpu',
            fallback: index > 0
          };
        } catch (error) {
          lastError = error;
          const retryable =
            attempt.gpu &&
            !state.cancelled &&
            error.code !== 'OCR_CANCELLED' &&
            error.code !== 'OCR_TIMEOUT' &&
            error.code !== 'OCR_EMPTY' &&
            error.code !== 'OCR_TOO_LONG';
          if (!retryable) throw error;
        }
      }
      throw (
        lastError ||
        new OcrEngineError('OCR_FAILED', photoReaderCopy.errors.readFailed)
      );
    } catch (error) {
      const cancelled = error.code === 'OCR_CANCELLED';
      this.#setStatus({
        state: cancelled ? 'idle' : 'error',
        error: cancelled
          ? null
          : { code: error.code || 'OCR_FAILED', message: error.message }
      });
      throw error;
    } finally {
      this.running.delete(id);
      if (this.running.size === 0 && this.status.state === 'running') {
        this.#setStatus({ state: 'idle' });
      }
    }
  }

  #readOnce({ runtimePath, gpu, imagePath, state }) {
    const args = buildOcrArgs({
      modelPath: this.modelPath,
      projectorPath: this.projectorPath,
      imagePath,
      threads: this.threads,
      gpu
    });

    return new Promise((resolve, reject) => {
      let child = null;
      let settled = false;
      let cancelled = false;
      let timedOut = false;
      let stdout = '';
      let stderr = '';
      let killTimer = null;
      let timer = null;

      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        if (killTimer) clearTimeout(killTimer);
        if (timer) clearTimeout(timer);
        state.currentCancel = null;
        if (error) reject(error);
        else resolve(result);
      };

      const kill = () => {
        if (!child || child.exitCode !== null) return;
        try {
          child.kill('SIGTERM');
        } catch {
          // Ignore a process that already exited.
        }
        killTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Ignore.
          }
        }, 2000);
        killTimer.unref?.();
      };

      timer = setTimeout(() => {
        timedOut = true;
        kill();
        finish(
          new OcrEngineError('OCR_TIMEOUT', 'Reading this photo took too long. Try a smaller photo.')
        );
      }, this.timeoutMs);
      timer.unref?.();

      state.currentCancel = () => {
        cancelled = true;
        kill();
        finish(new OcrEngineError('OCR_CANCELLED', 'Photo reading was cancelled.'));
      };

      try {
        child = spawn(runtimePath, args, {
          cwd: path.dirname(runtimePath),
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (error) {
        finish(
          new OcrEngineError(
            'OCR_RUNTIME_MISSING',
            photoReaderCopy.errors.runtimeStart,
            error.message
          )
        );
        return;
      }

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk) => {
        stdout += chunk;
        if (stdout.length > MAX_STDOUT_BYTES) {
          kill();
          finish(new OcrEngineError('OCR_TOO_LONG', 'The photo produced too much text.'));
        }
      });
      child.stderr?.on('data', (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-8000);
      });
      child.on('error', (error) => {
        finish(
          new OcrEngineError(
            'OCR_RUNTIME_MISSING',
            photoReaderCopy.errors.runtimeStart,
            error.message
          )
        );
      });
      child.on('close', (code, signal) => {
        if (settled) return;
        if (cancelled) {
          finish(new OcrEngineError('OCR_CANCELLED', 'Photo reading was cancelled.'));
          return;
        }
        if (timedOut) {
          finish(new OcrEngineError('OCR_TIMEOUT', 'Reading this photo took too long.'));
          return;
        }
        if (code !== 0) {
          const detail = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400);
          finish(
            new OcrEngineError(
              'OCR_FAILED',
              photoReaderCopy.errors.readFailed,
              detail || (signal ? `Stopped by ${signal}.` : `Exited with code ${code}.`)
            )
          );
          return;
        }
        const text = cleanOcrText(stdout);
        if (!text) {
          finish(
            new OcrEngineError(
              'OCR_EMPTY',
              'No readable text was found. Try a clearer photo or type the page yourself.'
            )
          );
          return;
        }
        finish(null, { text });
      });
    });
  }

  cancel(requestId) {
    const entry = this.running.get(String(requestId || ''));
    if (!entry || typeof entry.cancel !== 'function') return false;
    entry.cancel();
    return true;
  }

  cancelAll() {
    for (const entry of [...this.running.values()]) {
      if (typeof entry.cancel === 'function') entry.cancel();
    }
  }

  dispose() {
    this.disposed = true;
    this.cancelAll();
    this.#setStatus({ state: 'disposed', error: null, backend: 'cpu' });
  }
}

module.exports = { OcrEngine, OcrEngineError };
