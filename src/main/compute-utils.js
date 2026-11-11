'use strict';

// Shared, dependency-free helpers for the optional video-card path. Keeping
// these pure makes the platform policy and the user-facing wording testable
// without loading a native model runtime.

class ComputeError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ComputeError';
    this.code = code;
    this.details = details;
  }
}

function normalizeComputeMode(value, fallback = 'cpu') {
  if (value === 'gpu') return 'gpu';
  if (value === 'cpu') return 'cpu';
  return fallback;
}

/**
 * Where the app may offer a processor/video-card choice, and what the default
 * is. Apple Silicon defaults to Metal because that is the reliable native
 * path; Windows and Linux default to the processor on purpose.
 */
function computeCapabilities(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && arch === 'arm64') {
    return {
      canChooseGpu: true,
      defaultMode: 'gpu',
      fixedMode: null,
      reason: null,
      noun: 'graphics chip'
    };
  }
  if (platform === 'darwin') {
    return {
      canChooseGpu: false,
      defaultMode: 'cpu',
      fixedMode: 'cpu',
      reason: 'mac-intel',
      noun: 'processor'
    };
  }
  if ((platform === 'win32' || platform === 'linux') && arch === 'x64') {
    return {
      canChooseGpu: true,
      defaultMode: 'cpu',
      fixedMode: null,
      reason: null,
      noun: 'video card'
    };
  }
  return {
    canChooseGpu: false,
    defaultMode: 'cpu',
    fixedMode: 'cpu',
    reason: 'unsupported-arch',
    noun: 'processor'
  };
}

/**
 * The exact getLlama()/loadModel() options for a mode. Processor mode on Apple
 * Silicon deliberately loads the Metal build with zero offloaded layers: that
 * is the only prebuilt arm64 runtime, and zero layers keeps all compute on the
 * processor without needing a separate CPU-only package.
 */
function resolveRuntimeOptions(mode, platform = process.platform, arch = process.arch, { strictGpu = false } = {}) {
  if (mode === 'gpu') {
    return {
      gpu: strictGpu ? { type: 'auto', exclude: [false] } : 'auto',
      gpuLayers: 'auto'
    };
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return { gpu: 'metal', gpuLayers: 0 };
  }
  return { gpu: false, gpuLayers: 0 };
}

const GENERIC_COMPUTE_ERROR =
  "We couldn't use your video card, so the companion will stay on the processor.";

/**
 * Turn any native/driver failure into a short, non-technical sentence. Raw
 * messages are logged and stored as `details`; they must not reach the UI.
 */
function friendlyComputeError(error) {
  const code = error && typeof error.code === 'string' ? error.code : '';
  const message = error && typeof error.message === 'string' ? error.message : '';

  if (code === 'COMPUTE_MODEL_MISSING' || code === 'MODEL_MISSING') {
    return 'Set up the companion model first, then you can check your video card.';
  }
  if (code === 'COMPUTE_BUSY') {
    return 'Wait for the current companion request to finish, then try again.';
  }
  if (code === 'COMPUTE_UNAVAILABLE') {
    return "Video card acceleration isn't available on this computer. The companion will use the processor.";
  }
  if (code === 'GPU_TIMEOUT' || /timed?\s*out|timeout|too long/i.test(message)) {
    return 'The video card took too long to start, so the companion will use the processor.';
  }
  if (
    code === 'GPU_OUT_OF_MEMORY' ||
    /out of memory|not enough memory|insufficient memory|vram|memory allocation/i.test(message)
  ) {
    return "Your video card doesn't have enough free memory right now, so the companion will use the processor.";
  }
  if (
    /no prebuilt|no binary|not found|unsupported|no usable|no gpu|no cuda|no vulkan|not compatible/i.test(
      message
    )
  ) {
    return "We couldn't find a video card that Lichen Journal can use, so the companion will use the processor.";
  }
  if (
    /cuda|vulkan|metal|driver|device|initialize|failed to load|failed to start|offload/i.test(
      message
    )
  ) {
    return "We couldn't use your video card, so the companion will use the processor.";
  }
  return GENERIC_COMPUTE_ERROR;
}

module.exports = {
  ComputeError,
  GENERIC_COMPUTE_ERROR,
  normalizeComputeMode,
  computeCapabilities,
  resolveRuntimeOptions,
  friendlyComputeError
};
