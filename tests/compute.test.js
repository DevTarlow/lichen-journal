import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ComputeController } from '../src/main/compute.js';

function makeSettings(overrides = {}) {
  let compute = {
    mode: 'cpu',
    choiceMade: false,
    verified: false,
    backend: null,
    lastError: null,
    updatedAt: null,
    ...overrides
  };
  return {
    get: () => ({
      version: 1,
      compute: {
        ...compute,
        lastError: compute.lastError ? { ...compute.lastError } : null
      }
    }),
    updateCompute: (patch) => {
      compute = { ...compute, ...patch, updatedAt: '2026-11-11T00:00:00.000Z' };
      return { ...compute };
    }
  };
}

class FakeAi extends EventEmitter {
  constructor({ modelPresent = true, busy = false } = {}) {
    super();
    this.mode = 'cpu';
    this.modelPresent = modelPresent;
    this.busy = busy;
    this.unload = vi.fn(async () => {
      this.state = 'idle';
    });
    this.state = 'idle';
  }

  getStatus() {
    return {
      state: this.state,
      modelPresent: this.modelPresent,
      modelPath: '/models/companion.gguf',
      computeMode: this.mode,
      backend: this.mode === 'gpu' ? 'gpu' : 'cpu',
      gpuActive: false,
      gpuLayers: 0
    };
  }

  setComputeMode(mode) {
    this.mode = mode;
  }

  isBusy() {
    return this.busy;
  }
}

function makeOcr() {
  return {
    mode: 'cpu',
    getStatus() {
      return { backend: this.mode === 'gpu' ? 'gpu' : 'cpu' };
    },
    setComputeMode(mode) {
      this.mode = mode;
    }
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('compute controller', () => {
  it('reports the processor default and the available choice', () => {
    const ai = new FakeAi();
    const controller = new ComputeController({
      settings: makeSettings(),
      ai,
      ocr: makeOcr(),
      platform: 'linux',
      arch: 'x64',
      probe: vi.fn()
    });
    const status = controller.getStatus();
    expect(status).toMatchObject({
      mode: 'cpu',
      canChooseGpu: true,
      choiceMade: false,
      modelPresent: true,
      noun: 'video card'
    });
  });

  it('saves GPU only after a successful real probe', async () => {
    const ai = new FakeAi();
    const ocr = makeOcr();
    const settings = makeSettings();
    const probe = vi.fn(async () => ({
      ok: true,
      backend: 'vulkan',
      gpuLayers: 17
    }));
    const controller = new ComputeController({
      settings,
      ai,
      ocr,
      platform: 'linux',
      arch: 'x64',
      probe
    });

    const result = await controller.testGpu();
    expect(result.ok).toBe(true);
    expect(probe).toHaveBeenCalledWith(
      expect.objectContaining({ modelPath: '/models/companion.gguf' })
    );
    expect(ai.mode).toBe('gpu');
    expect(ocr.mode).toBe('gpu');
    expect(controller.getStatus()).toMatchObject({
      mode: 'gpu',
      choiceMade: true,
      verified: true,
      backend: 'vulkan'
    });
  });

  it('saves the processor and a friendly message when the probe fails', async () => {
    const ai = new FakeAi();
    const ocr = makeOcr();
    const settings = makeSettings({ mode: 'gpu', choiceMade: true, verified: true });
    const controller = new ComputeController({
      settings,
      ai,
      ocr,
      platform: 'linux',
      arch: 'x64',
      probe: vi.fn(async () => ({
        ok: false,
        error: { code: 'GPU_UNAVAILABLE', message: 'CUDA error 999 at /usr/lib' },
        details: 'CUDA error 999 at /usr/lib'
      }))
    });

    const result = await controller.testGpu();
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain('CUDA');
    expect(ai.mode).toBe('cpu');
    expect(ocr.mode).toBe('cpu');
    const status = controller.getStatus();
    expect(status.mode).toBe('cpu');
    expect(status.lastError.message).toContain('processor');
    expect(status.lastError.details).toContain('CUDA');
  });

  it('switches off to the processor without a probe', async () => {
    const ai = new FakeAi();
    const ocr = makeOcr();
    const settings = makeSettings({ mode: 'gpu', choiceMade: true, verified: true });
    const probe = vi.fn();
    const controller = new ComputeController({
      settings,
      ai,
      ocr,
      platform: 'linux',
      arch: 'x64',
      probe
    });

    const status = await controller.useCpu();
    expect(status.mode).toBe('cpu');
    expect(probe).not.toHaveBeenCalled();
    expect(ai.unload).toHaveBeenCalled();
    expect(ai.mode).toBe('cpu');
    expect(ocr.mode).toBe('cpu');
  });

  it('returns to the processor when a later GPU load falls back', () => {
    const ai = new FakeAi();
    const ocr = makeOcr();
    const settings = makeSettings({ mode: 'gpu', choiceMade: true, verified: true });
    const controller = new ComputeController({
      settings,
      ai,
      ocr,
      platform: 'linux',
      arch: 'x64',
      probe: vi.fn()
    });

    ai.emit('fallback', {
      code: 'GPU_UNAVAILABLE',
      message: 'Vulkan device lost',
      details: 'VK_ERROR_DEVICE_LOST'
    });

    const status = controller.getStatus();
    expect(status.mode).toBe('cpu');
    expect(status.lastError.message).toContain('processor');
    expect(status.lastError.message).not.toContain('Vulkan');
    expect(ai.mode).toBe('cpu');
    expect(ocr.mode).toBe('cpu');
  });

  it('refuses to test without a model or while the companion is busy', async () => {
    const missing = new ComputeController({
      settings: makeSettings(),
      ai: new FakeAi({ modelPresent: false }),
      ocr: makeOcr(),
      platform: 'linux',
      arch: 'x64',
      probe: vi.fn()
    });
    await expect(missing.testGpu()).rejects.toMatchObject({
      code: 'COMPUTE_MODEL_MISSING'
    });

    const busy = new ComputeController({
      settings: makeSettings(),
      ai: new FakeAi({ busy: true }),
      ocr: makeOcr(),
      platform: 'linux',
      arch: 'x64',
      probe: vi.fn()
    });
    await expect(busy.testGpu()).rejects.toMatchObject({ code: 'COMPUTE_BUSY' });
  });

  it('hides the choice on platforms with no supported GPU backend', async () => {
    const controller = new ComputeController({
      settings: makeSettings({ mode: 'cpu', choiceMade: true }),
      ai: new FakeAi(),
      ocr: makeOcr(),
      platform: 'darwin',
      arch: 'x64',
      probe: vi.fn()
    });
    expect(controller.getStatus().canChooseGpu).toBe(false);
    await expect(controller.testGpu()).rejects.toMatchObject({
      code: 'COMPUTE_UNAVAILABLE'
    });
  });
});
