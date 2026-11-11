import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import {
  PROBE_MARKER,
  parseProbeOutput,
  runGpuProbe
} from '../src/main/compute-probe.js';

const REAL_FILE = path.join(process.cwd(), 'package.json');

function makeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.kill = vi.fn();
  return child;
}

describe('GPU probe output', () => {
  it('parses the last result line and ignores logs', () => {
    const result = parseProbeOutput(
      `loading…\n${PROBE_MARKER}{"ok":true,"backend":"vulkan","gpuLayers":17}\n`
    );
    expect(result).toMatchObject({ ok: true, backend: 'vulkan', gpuLayers: 17 });
    expect(parseProbeOutput('no marker here')).toBeNull();
    expect(parseProbeOutput(`${PROBE_MARKER}{broken`)).toBeNull();
  });
});

describe('GPU probe runner', () => {
  it('reports a missing model without spawning', async () => {
    const spawnImpl = vi.fn();
    const result = await runGpuProbe({
      modelPath: path.join(process.cwd(), 'does-not-exist.gguf'),
      spawnImpl
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('MODEL_MISSING');
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it('returns a successful GPU result', async () => {
    const child = makeChild();
    const promise = runGpuProbe({
      modelPath: REAL_FILE,
      spawnImpl: () => child,
      timeoutMs: 1000
    });
    child.stdout.emit(
      'data',
      `${PROBE_MARKER}${JSON.stringify({ ok: true, backend: 'vulkan', gpuLayers: 9 })}\n`
    );
    child.emit('exit', 0);
    const result = await promise;
    expect(result).toMatchObject({ ok: true, backend: 'vulkan', gpuLayers: 9 });
  });

  it('returns a friendly failure from the probe result', async () => {
    const child = makeChild();
    const promise = runGpuProbe({
      modelPath: REAL_FILE,
      spawnImpl: () => child,
      timeoutMs: 1000
    });
    child.stdout.emit(
      'data',
      `${PROBE_MARKER}${JSON.stringify({
        ok: false,
        error: { code: 'GPU_UNAVAILABLE', message: 'CUDA error 999' }
      })}\n`
    );
    child.emit('exit', 0);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('GPU_UNAVAILABLE');
    expect(result.error.message).toBe('CUDA error 999');
  });

  it('reports a crash when no result line is printed', async () => {
    const child = makeChild();
    const promise = runGpuProbe({
      modelPath: REAL_FILE,
      spawnImpl: () => child,
      timeoutMs: 1000
    });
    child.emit('exit', 1, null);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('GPU_PROBE_FAILED');
  });

  it('kills a hung probe and reports a timeout', async () => {
    const child = makeChild();
    const result = await runGpuProbe({
      modelPath: REAL_FILE,
      spawnImpl: () => child,
      timeoutMs: 5
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('GPU_TIMEOUT');
    expect(child.kill).toHaveBeenCalled();
  });
});
