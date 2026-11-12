'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter, once } = require('node:events');
const { DOWNLOADABLE_MODELS } = require('./model-catalog');
const { model: modelCopy } = require('./copy');

const modelErrors = modelCopy.errors;

const PROGRESS_INTERVAL_MS = 180;
const STALL_TIMEOUT_MS = 60_000;

class ModelManagerError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ModelManagerError';
    this.code = code;
    this.details = details;
  }
}

function safeError(error) {
  if (error instanceof ModelManagerError) {
    return {
      code: error.code,
      message: error.message,
      details: typeof error.details === 'string' ? error.details.slice(0, 400) : undefined
    };
  }
  return {
    code: 'MODEL_DOWNLOAD_FAILED',
    message: modelErrors.genericDownload,
    details: typeof error?.message === 'string' ? error.message.slice(0, 400) : undefined
  };
}

function fileFacts(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return { path: filePath, present: stat.isFile(), bytes: stat.size };
  } catch {
    return { path: filePath, present: false, bytes: 0 };
  }
}

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

class ModelStore extends EventEmitter {
  constructor({
    modelDir,
    legacyDir = null,
    assets = DOWNLOADABLE_MODELS,
    stallTimeoutMs = STALL_TIMEOUT_MS
  } = {}) {
    super();
    if (!modelDir) throw new Error('ModelStore requires a model directory.');
    this.modelDir = modelDir;
    this.legacyDir = legacyDir;
    this.assets = [...assets];
    this.assetMap = new Map(this.assets.map((asset) => [asset.id, asset]));
    this.stallTimeoutMs = stallTimeoutMs;
    this.active = null;
    this.batchActive = false;
    this.importing = new Map();
    this.errors = new Map();
    this.disposed = false;
    this.lastProgressEmit = 0;
  }

  #assetStatus(asset) {
    const primary = fileFacts(path.join(this.modelDir, asset.file));
    const legacy = this.legacyDir
      ? fileFacts(path.join(this.legacyDir, asset.file))
      : { present: false, bytes: 0, path: '' };
    const source = primary.present ? 'download' : legacy.present ? 'legacy' : null;
    const activePath = primary.present ? primary.path : legacy.present ? legacy.path : primary.path;
    const bytes = primary.present ? primary.bytes : legacy.present ? legacy.bytes : 0;
    const part = fileFacts(`${path.join(this.modelDir, asset.file)}.part`);
    const error = this.errors.get(asset.id) || null;
    const active = this.active && this.active.assetId === asset.id ? this.active : null;
    const importPhase = this.importing.get(asset.id) || null;
    const valid = bytes === asset.bytes;

    let state;
    if (valid) state = 'ready';
    else if (active) state = active.phase || 'downloading';
    else if (importPhase) state = importPhase;
    else if (error) state = 'error';
    else if (part.present && part.bytes > 0) state = 'paused';
    else if (bytes > 0) state = 'invalid';
    else state = 'missing';

    const effectiveBytes = valid
      ? asset.bytes
      : active
        ? active.bytes
        : part.present
          ? part.bytes
          : bytes;

    return {
      id: asset.id,
      label: asset.label,
      file: asset.file,
      expectedBytes: asset.bytes,
      bytes,
      partBytes: part.bytes,
      bytesDownloaded: Math.max(0, Math.min(asset.bytes, effectiveBytes)),
      progress: asset.bytes
        ? Math.max(0, Math.min(100, Math.round((effectiveBytes / asset.bytes) * 100)))
        : 0,
      path: activePath,
      partPath: part.path,
      source,
      state,
      phase: active?.phase || importPhase || null,
      canResume: !valid && part.present && part.bytes > 0 && part.bytes < asset.bytes,
      error
    };
  }

  getActivePath(assetId) {
    const asset = this.assetMap.get(assetId);
    if (!asset) return '';
    const primary = path.join(this.modelDir, asset.file);
    if (fileFacts(primary).present) return primary;
    if (this.legacyDir) {
      const legacy = path.join(this.legacyDir, asset.file);
      if (fileFacts(legacy).present) return legacy;
    }
    return primary;
  }

  getStatus() {
    const assets = {};
    for (const asset of this.assets) assets[asset.id] = this.#assetStatus(asset);

    const totalBytes = this.assets.reduce((sum, asset) => sum + asset.bytes, 0);
    const downloadedBytes = Object.values(assets).reduce(
      (sum, asset) => sum + asset.bytesDownloaded,
      0
    );
    const ocrReady = Boolean(assets.ocrModel?.state === 'ready' && assets.ocrProjector?.state === 'ready');
    return {
      modelDir: this.modelDir,
      assets,
      companionReady: assets.companion?.state === 'ready',
      ocrReady,
      allReady: this.assets.every((asset) => assets[asset.id].state === 'ready'),
      downloading: this.active?.assetId || null,
      busy: Boolean(this.active || this.batchActive || this.importing.size),
      totalBytes,
      downloadedBytes,
      progress: totalBytes ? Math.max(0, Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))) : 0,
      errors: Object.fromEntries(
        Object.entries(assets)
          .filter(([, asset]) => asset.error)
          .map(([id, asset]) => [id, asset.error])
      )
    };
  }

  #emitStatus(force = false) {
    const now = Date.now();
    if (!force && now - this.lastProgressEmit < PROGRESS_INTERVAL_MS) return;
    this.lastProgressEmit = now;
    this.emit('status', this.getStatus());
  }

  #assertUsable() {
    if (this.disposed) {
      throw new ModelManagerError('MODEL_DOWNLOAD_FAILED', modelErrors.shuttingDown);
    }
  }

  #assertIdle() {
    if (this.active || this.batchActive || this.importing.size > 0) {
      throw new ModelManagerError(
        'MODEL_DOWNLOAD_BUSY',
        modelErrors.busy
      );
    }
  }

  #partPath(asset) {
    return path.join(this.modelDir, `${asset.file}.part`);
  }

  #markerPath(asset) {
    return path.join(this.modelDir, `${asset.file}.sha256`);
  }

  async #verifyAndInstall(asset, partPath) {
    let stat;
    try {
      stat = fs.statSync(partPath);
    } catch {
      throw new ModelManagerError('MODEL_INVALID', modelErrors.missingPart);
    }
    if (stat.size !== asset.bytes) {
      fs.rmSync(partPath, { force: true });
      throw new ModelManagerError(
        'MODEL_INVALID',
        modelErrors.wrongSize,
        `${stat.size} / ${asset.bytes}`
      );
    }

    const digest = await sha256File(partPath);
    if (digest !== asset.sha256) {
      fs.rmSync(partPath, { force: true });
      throw new ModelManagerError(
        'MODEL_CHECKSUM_MISMATCH',
        modelErrors.damaged
      );
    }

    const destination = path.join(this.modelDir, asset.file);
    fs.rmSync(destination, { force: true });
    fs.renameSync(partPath, destination);
    try {
      fs.writeFileSync(this.#markerPath(asset), `${digest}\n`, { mode: 0o600 });
    } catch {
      // The downloaded file is already verified; the marker is only a nicety.
    }
    return destination;
  }

  async #transfer(asset, partPath, controller, allowRangeRetry = true) {
    const start = fileFacts(partPath).bytes;
    const headers = {};
    if (start > 0) headers.Range = `bytes=${start}-`;

    let response;
    try {
      response = await fetch(asset.url, {
        headers,
        redirect: 'follow',
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ModelManagerError('MODEL_CANCELLED', modelErrors.cancelled);
      }
      throw new ModelManagerError(
        'MODEL_DOWNLOAD_FAILED',
        modelErrors.connection,
        error.message
      );
    }

    if (response.status === 416 && start > 0 && allowRangeRetry) {
      fs.rmSync(partPath, { force: true });
      return this.#transfer(asset, partPath, controller, false);
    }

    let append = false;
    if (response.status === 206 && start > 0) {
      append = true;
    } else if (response.status === 200) {
      append = false;
    } else if (!response.ok) {
      throw new ModelManagerError(
        'MODEL_DOWNLOAD_FAILED',
        modelErrors.http(response.status),
        response.statusText
      );
    }

    if (response.url && asset.url.startsWith('https:') && !response.url.startsWith('https:')) {
      throw new ModelManagerError(
        'MODEL_DOWNLOAD_FAILED',
        modelErrors.insecure
      );
    }
    if (!response.body) {
      throw new ModelManagerError('MODEL_DOWNLOAD_FAILED', modelErrors.noData);
    }

    const output = fs.createWriteStream(partPath, {
      flags: append ? 'a' : 'w',
      mode: 0o600
    });
    let streamError = null;
    output.on('error', (error) => {
      streamError = error;
    });

    let downloaded = append ? start : 0;
    let stallTimer = null;
    const resetStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => controller.abort(), this.stallTimeoutMs);
      stallTimer.unref?.();
    };
    resetStall();

    try {
      for await (const chunk of response.body) {
        if (controller.signal.aborted) {
          throw new ModelManagerError('MODEL_CANCELLED', modelErrors.cancelled);
        }
        const buffer = Buffer.from(chunk);
        downloaded += buffer.length;
        if (downloaded > asset.bytes) {
          throw new ModelManagerError(
            'MODEL_INVALID',
            modelErrors.tooLarge
          );
        }
        if (!output.write(buffer)) await once(output, 'drain');
        if (streamError) throw streamError;
        if (this.active) this.active.bytes = downloaded;
        resetStall();
        this.#emitStatus();
      }
      output.end();
      await once(output, 'finish');
      if (streamError) throw streamError;
      if (downloaded !== asset.bytes) {
        throw new ModelManagerError(
          'MODEL_INVALID',
          modelErrors.incomplete
        );
      }
      return downloaded;
    } catch (error) {
      if (streamError) {
        throw new ModelManagerError(
          'MODEL_DISK_ERROR',
          modelErrors.disk,
          streamError.message
        );
      }
      if (controller.signal.aborted) {
        throw new ModelManagerError('MODEL_CANCELLED', modelErrors.cancelled);
      }
      throw error;
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      if (!output.closed) output.destroy();
    }
  }

  async #runDownload(assetId) {
    const asset = this.assetMap.get(assetId);
    if (!asset) throw new ModelManagerError('MODEL_INVALID', modelErrors.unknownAsset);
    const current = this.#assetStatus(asset);
    if (current.state === 'ready') return current;

    try {
      fs.mkdirSync(this.modelDir, { recursive: true, mode: 0o700 });
    } catch (error) {
      const diskError = new ModelManagerError(
        'MODEL_DISK_ERROR',
        modelErrors.createFolder,
        error.message
      );
      this.errors.set(assetId, safeError(diskError));
      this.#emitStatus(true);
      throw diskError;
    }
    this.errors.delete(assetId);
    const partPath = this.#partPath(asset);
    const part = fileFacts(partPath);
    if (part.bytes > asset.bytes) fs.rmSync(partPath, { force: true });
    if (part.bytes === asset.bytes) {
      this.active = { assetId, phase: 'verifying', bytes: part.bytes, controller: null, cancelled: false };
      this.#emitStatus(true);
      try {
        this.active.phase = 'installing';
        this.#emitStatus(true);
        await this.#verifyAndInstall(asset, partPath);
        this.active = null;
        this.#emitStatus(true);
        return this.#assetStatus(asset);
      } catch (error) {
        this.active = null;
        this.errors.set(assetId, safeError(error));
        this.#emitStatus(true);
        throw error;
      }
    }

    const controller = new AbortController();
    this.active = {
      assetId,
      phase: 'downloading',
      bytes: part.bytes,
      controller,
      cancelled: false
    };
    this.#emitStatus(true);

    try {
      await this.#transfer(asset, partPath, controller);
      this.active.phase = 'verifying';
      this.#emitStatus(true);
      this.active.phase = 'installing';
      this.#emitStatus(true);
      await this.#verifyAndInstall(asset, partPath);
      this.errors.delete(assetId);
      this.active = null;
      this.#emitStatus(true);
      return this.#assetStatus(asset);
    } catch (error) {
      const cancelled = error.code === 'MODEL_CANCELLED';
      if (!cancelled) this.errors.set(assetId, safeError(error));
      this.active = null;
      this.#emitStatus(true);
      throw error;
    }
  }

  async download(assetId) {
    this.#assertUsable();
    this.#assertIdle();
    return this.#runDownload(assetId);
  }

  async downloadAll() {
    this.#assertUsable();
    this.#assertIdle();
    this.batchActive = true;
    try {
      for (const asset of this.assets) {
        if (this.disposed) break;
        if (this.#assetStatus(asset).state === 'ready') continue;
        try {
          await this.#runDownload(asset.id);
        } catch (error) {
          if (error?.code === 'MODEL_CANCELLED' || this.disposed) break;
          // Keep going: completed assets stay ready and the failed row can be retried.
        }
      }
    } finally {
      this.batchActive = false;
      this.#emitStatus(true);
    }
    return this.getStatus();
  }

  cancel() {
    if (!this.active || !this.active.controller) return false;
    this.active.cancelled = true;
    this.active.controller.abort();
    return true;
  }

  async importFile(assetId, filePath) {
    this.#assertUsable();
    this.#assertIdle();
    const asset = this.assetMap.get(assetId);
    if (!asset) throw new ModelManagerError('MODEL_INVALID', modelErrors.unknownAsset);
    if (!filePath || typeof filePath !== 'string') {
      throw new ModelManagerError('MODEL_IMPORT_FAILED', modelErrors.importChoose);
    }
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      throw new ModelManagerError('MODEL_IMPORT_FAILED', modelErrors.importOpen);
    }
    if (!stat.isFile() || stat.size !== asset.bytes) {
      throw new ModelManagerError(
        'MODEL_INVALID',
        modelErrors.importWrong
      );
    }

    try {
      fs.mkdirSync(this.modelDir, { recursive: true, mode: 0o700 });
    } catch (error) {
      const diskError = new ModelManagerError(
        'MODEL_DISK_ERROR',
        modelErrors.createFolder,
        error.message
      );
      this.errors.set(assetId, safeError(diskError));
      this.#emitStatus(true);
      throw diskError;
    }
    const partPath = this.#partPath(asset);
    this.importing.set(assetId, 'installing');
    this.errors.delete(assetId);
    this.#emitStatus(true);
    try {
      await fs.promises.copyFile(filePath, partPath);
      this.importing.set(assetId, 'verifying');
      this.#emitStatus(true);
      await this.#verifyAndInstall(asset, partPath);
      this.#emitStatus(true);
      return this.#assetStatus(asset);
    } catch (error) {
      fs.rmSync(partPath, { force: true });
      this.errors.set(assetId, safeError(error));
      this.#emitStatus(true);
      throw error;
    } finally {
      this.importing.delete(assetId);
      this.#emitStatus(true);
    }
  }

  async importFolder(directory) {
    this.#assertUsable();
    this.#assertIdle();
    if (!directory) return this.getStatus();
    const imported = [];
    const failed = [];
    for (const asset of this.assets) {
      const candidate = path.join(directory, asset.file);
      if (!fs.existsSync(candidate)) continue;
      try {
        await this.importFile(asset.id, candidate);
        imported.push(asset.id);
      } catch (error) {
        failed.push({ id: asset.id, error: safeError(error) });
      }
    }
    return { status: this.getStatus(), imported, failed };
  }

  removeDownloaded() {
    this.#assertUsable();
    this.#assertIdle();
    let failure = null;
    for (const asset of this.assets) {
      for (const name of [asset.file, `${asset.file}.part`, `${asset.file}.sha256`]) {
        try {
          fs.rmSync(path.join(this.modelDir, name), { force: true });
        } catch (error) {
          failure = failure || error;
        }
      }
    }
    this.errors.clear();
    this.#emitStatus(true);
    if (failure) {
      throw new ModelManagerError(
        'MODEL_CLEAR_FAILED',
        modelErrors.clearFailed,
        typeof failure.message === 'string' ? failure.message.slice(0, 400) : undefined
      );
    }
    return this.getStatus();
  }

  dispose() {
    this.disposed = true;
    this.cancel();
  }
}

module.exports = { ModelStore, ModelManagerError, safeError };
