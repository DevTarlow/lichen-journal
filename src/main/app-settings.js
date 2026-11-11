'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  computeCapabilities,
  normalizeComputeMode
} = require('./compute-utils');

const SETTINGS_VERSION = 1;
const BACKENDS = new Set(['cpu', 'gpu', 'metal', 'cuda', 'vulkan']);

function defaultCompute(platform, arch) {
  const capabilities = computeCapabilities(platform, arch);
  return {
    mode: capabilities.canChooseGpu ? capabilities.defaultMode : capabilities.fixedMode,
    choiceMade: !capabilities.canChooseGpu,
    verified: false,
    backend: null,
    lastError: null,
    updatedAt: null
  };
}

function sanitizeLastError(value) {
  if (!value || typeof value !== 'object') return null;
  const message = typeof value.message === 'string' ? value.message.trim() : '';
  if (!message) return null;
  return {
    code: typeof value.code === 'string' ? value.code : 'GPU_UNAVAILABLE',
    message: Array.from(message).slice(0, 400).join(''),
    details:
      typeof value.details === 'string'
        ? Array.from(value.details).slice(0, 800).join('')
        : '',
    at: typeof value.at === 'string' ? value.at : null
  };
}

function sanitizeCompute(value, defaults) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    mode: normalizeComputeMode(source.mode, defaults.mode),
    choiceMade:
      typeof source.choiceMade === 'boolean' ? source.choiceMade : defaults.choiceMade,
    verified: source.verified === true,
    backend: BACKENDS.has(source.backend) ? source.backend : null,
    lastError: sanitizeLastError(source.lastError),
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null
  };
}

class AppSettings {
  constructor({ filePath, platform = process.platform, arch = process.arch } = {}) {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('AppSettings requires a settings file path.');
    }
    this.filePath = filePath;
    this.platform = platform;
    this.arch = arch;
    this.defaults = {
      version: SETTINGS_VERSION,
      compute: defaultCompute(platform, arch)
    };
    this.data = this.#read();
  }

  #read() {
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      parsed = null;
    }
    const source = parsed && typeof parsed === 'object' ? parsed : {};
    return {
      version: SETTINGS_VERSION,
      compute: sanitizeCompute(source.compute, this.defaults.compute)
    };
  }

  get() {
    return {
      version: SETTINGS_VERSION,
      compute: {
        ...this.data.compute,
        lastError: this.data.compute.lastError
          ? { ...this.data.compute.lastError }
          : null
      }
    };
  }

  #write() {
    const directory = path.dirname(this.filePath);
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    } catch {
      // The write below reports the actionable error.
    }
    const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const payload = `${JSON.stringify(this.data, null, 2)}\n`;
    fs.writeFileSync(temporary, payload, { mode: 0o600 });
    try {
      fs.renameSync(temporary, this.filePath);
    } catch {
      try {
        fs.rmSync(this.filePath, { force: true });
        fs.renameSync(temporary, this.filePath);
      } catch (error) {
        fs.rmSync(temporary, { force: true });
        throw error;
      }
    }
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      // Windows and some filesystems do not expose POSIX modes.
    }
  }

  updateCompute(patch) {
    const next = {
      ...this.data.compute,
      ...(patch && typeof patch === 'object' ? patch : {}),
      updatedAt: new Date().toISOString()
    };
    this.data = {
      version: SETTINGS_VERSION,
      compute: sanitizeCompute(next, this.defaults.compute)
    };
    this.#write();
    return this.get().compute;
  }
}

module.exports = {
  AppSettings,
  SETTINGS_VERSION,
  defaultCompute,
  sanitizeCompute
};
