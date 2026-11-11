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
    threads = 8,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = {}) {
    super();
    if (!runtimePath || !modelPath || !projectorPath) {
      throw new Error('OcrEngine requires runtime, model, and projector paths.');
    }
    this.runtimePath = runtimePath;
    this.modelPath = modelPath;
    this.projectorPath = projectorPath;
    this.threads = Math.max(1, Math.min(MAX_OCR_THREADS, Number(threads) || 1));
    this.timeoutMs = timeoutMs;
    this.running = new Map();
    this.disposed = false;
    this.lastError = null;
    this.status = {
      state: 'idle',
      error: null,
      ...this.#facts()
    };
    this.#refreshState();
  }

  #facts() {
    const exists = (filePath) => {
      try {
        const stat = fs.statSync(filePath);
        return stat.isFile() && stat.size > 0;
      } catch {
        return false;
      }
    };
    return {
      runtimePath: this.runtimePath,
      modelPath: this.modelPath,
      projectorPath: this.projectorPath,
      runtimePresent: exists(this.runtimePath),
      modelPresent: exists(this.modelPath),
      projectorPresent: exists(this.projectorPath)
    };
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
      error: this.status.error
    };
    return facts;
  }

  getStatus() {
    this.#refreshState();
    return {
      state: this.status.state,
      runtimePath: this.status.runtimePath,
      modelPath: this.status.modelPath,
      projectorPath: this.status.projectorPath,
      runtimePresent: this.status.runtimePresent,
      modelPresent: this.status.modelPresent,
      projectorPresent: this.status.projectorPresent,
      error: this.status.error,
      busyRequestId: this.running.size ? [...this.running.keys()][0] : null
    };
  }

  #setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.getStatus());
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

  #ensureReady() {
    if (this.disposed) {
      throw new OcrEngineError('OCR_DISPOSED', 'The photo reader is shutting down.');
    }
    const facts = this.#refreshState();
    if (!facts.runtimePresent) {
      throw new OcrEngineError(
        'OCR_RUNTIME_MISSING',
        'The local OCR runtime is missing from this installation.',
        this.runtimePath
      );
    }
    if (!facts.modelPresent || !facts.projectorPresent) {
      throw new OcrEngineError(
        'OCR_MODEL_MISSING',
        'The local OCR model is missing from this installation.',
        facts.modelPresent ? this.projectorPath : this.modelPath
      );
    }
  }

  async recognize({ imagePath, requestId } = {}) {
    this.#ensureReady();
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
    const args = buildOcrArgs({
      modelPath: this.modelPath,
      projectorPath: this.projectorPath,
      imagePath,
      threads: this.threads
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

      const entry = {};
      this.running.set(id, entry);
      this.#setStatus({ state: 'running', error: null });

      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        if (killTimer) clearTimeout(killTimer);
        if (timer) clearTimeout(timer);
        this.running.delete(id);
        const cancelledError = error && error.code === 'OCR_CANCELLED';
        this.#setStatus({
          state: error && !cancelledError ? 'error' : 'idle',
          error:
            error && !cancelledError
              ? { code: error.code || 'OCR_FAILED', message: error.message }
              : null
        });
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

      entry.cancel = () => {
        cancelled = true;
        kill();
        finish(new OcrEngineError('OCR_CANCELLED', 'Photo reading was cancelled.'));
      };

      try {
        child = spawn(this.runtimePath, args, {
          cwd: path.dirname(this.runtimePath),
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (error) {
        finish(
          new OcrEngineError(
            'OCR_RUNTIME_MISSING',
            'The local OCR runtime could not start.',
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
            'The local OCR runtime could not start.',
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
              'The local OCR model could not read this photo.',
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
        finish(null, {
          text,
          fileName: path.basename(imagePath),
          durationMs: Date.now() - startedAt
        });
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
    this.#setStatus({ state: 'disposed', error: null });
  }
}

module.exports = { OcrEngine, OcrEngineError };
