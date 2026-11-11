import { describe, expect, it } from 'vitest';
import {
  ComputeError,
  computeCapabilities,
  friendlyComputeError,
  normalizeComputeMode,
  resolveRuntimeOptions
} from '../src/main/compute-utils.js';

describe('compute capabilities', () => {
  it('defaults Windows and Linux x64 to the processor with a choice', () => {
    for (const platform of ['win32', 'linux']) {
      const capabilities = computeCapabilities(platform, 'x64');
      expect(capabilities.canChooseGpu).toBe(true);
      expect(capabilities.defaultMode).toBe('cpu');
      expect(capabilities.noun).toBe('video card');
    }
  });

  it('defaults Apple Silicon to the graphics chip', () => {
    const capabilities = computeCapabilities('darwin', 'arm64');
    expect(capabilities.canChooseGpu).toBe(true);
    expect(capabilities.defaultMode).toBe('gpu');
    expect(capabilities.noun).toBe('graphics chip');
  });

  it('does not offer a choice where there is no prebuilt GPU backend', () => {
    const intelMac = computeCapabilities('darwin', 'x64');
    expect(intelMac.canChooseGpu).toBe(false);
    expect(intelMac.fixedMode).toBe('cpu');
    const armLinux = computeCapabilities('linux', 'arm64');
    expect(armLinux.canChooseGpu).toBe(false);
    expect(armLinux.fixedMode).toBe('cpu');
  });
});

describe('compute runtime options', () => {
  it('uses strict auto GPU options for the check', () => {
    expect(resolveRuntimeOptions('gpu', 'linux', 'x64', { strictGpu: true })).toEqual({
      gpu: { type: 'auto', exclude: [false] },
      gpuLayers: 'auto'
    });
  });

  it('uses auto GPU options for normal loads', () => {
    expect(resolveRuntimeOptions('gpu', 'win32', 'x64')).toEqual({
      gpu: 'auto',
      gpuLayers: 'auto'
    });
  });

  it('uses the Metal build with zero offloaded layers on Apple Silicon', () => {
    expect(resolveRuntimeOptions('cpu', 'darwin', 'arm64')).toEqual({
      gpu: 'metal',
      gpuLayers: 0
    });
  });

  it('uses the CPU build elsewhere', () => {
    expect(resolveRuntimeOptions('cpu', 'linux', 'x64')).toEqual({
      gpu: false,
      gpuLayers: 0
    });
    expect(resolveRuntimeOptions('cpu', 'darwin', 'x64')).toEqual({
      gpu: false,
      gpuLayers: 0
    });
  });
});

describe('compute messages', () => {
  it('normalizes the mode', () => {
    expect(normalizeComputeMode('gpu')).toBe('gpu');
    expect(normalizeComputeMode('cpu')).toBe('cpu');
    expect(normalizeComputeMode('something')).toBe('cpu');
    expect(normalizeComputeMode(null, 'gpu')).toBe('gpu');
  });

  it('maps missing models and busy checks', () => {
    expect(
      friendlyComputeError(new ComputeError('COMPUTE_MODEL_MISSING', 'missing'))
    ).toContain('Set up the companion model');
    expect(friendlyComputeError(new ComputeError('COMPUTE_BUSY', 'busy'))).toContain(
      'Wait for the current companion request'
    );
  });

  it('maps memory and timeout failures without raw driver text', () => {
    const memory = friendlyComputeError(
      new Error('CUDA error 999: out of memory at /usr/lib/libggml-cuda.so')
    );
    expect(memory).toContain('free memory');
    expect(memory).not.toContain('CUDA');
    expect(memory).not.toContain('/usr/lib');

    const timeout = friendlyComputeError(
      new Error('The video card took too long to start')
    );
    expect(timeout).toContain('too long');
  });

  it('uses a generic friendly fallback for unknown driver errors', () => {
    const message = friendlyComputeError(new Error('VK_ERROR_DEVICE_LOST'));
    expect(message).toContain('processor');
    expect(message).not.toContain('VK_ERROR');
  });
});
