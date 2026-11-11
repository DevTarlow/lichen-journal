import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppSettings } from '../src/main/app-settings.js';

const tempDirs = [];

function makeSettingsPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichen-settings-'));
  tempDirs.push(dir);
  return path.join(dir, 'settings.json');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('app settings', () => {
  it('defaults Windows/Linux x64 to the processor before a choice', () => {
    const settings = new AppSettings({
      filePath: makeSettingsPath(),
      platform: 'linux',
      arch: 'x64'
    });
    expect(settings.get().compute).toMatchObject({
      mode: 'cpu',
      choiceMade: false,
      verified: false,
      backend: null,
      lastError: null
    });
  });

  it('defaults Apple Silicon to the graphics chip before a choice', () => {
    const settings = new AppSettings({
      filePath: makeSettingsPath(),
      platform: 'darwin',
      arch: 'arm64'
    });
    expect(settings.get().compute.mode).toBe('gpu');
    expect(settings.get().compute.choiceMade).toBe(false);
  });

  it('treats a fixed platform as already decided', () => {
    const settings = new AppSettings({
      filePath: makeSettingsPath(),
      platform: 'darwin',
      arch: 'x64'
    });
    expect(settings.get().compute.mode).toBe('cpu');
    expect(settings.get().compute.choiceMade).toBe(true);
  });

  it('persists the choice and the friendly failure detail with private file mode', () => {
    const filePath = makeSettingsPath();
    const settings = new AppSettings({ filePath, platform: 'linux', arch: 'x64' });
    settings.updateCompute({
      mode: 'cpu',
      choiceMade: true,
      verified: false,
      backend: 'cpu',
      lastError: {
        code: 'GPU_UNAVAILABLE',
        message: 'We could not use your video card.',
        details: 'CUDA error 999 at /usr/lib',
        at: '2026-11-11T00:00:00.000Z'
      }
    });

    const reopened = new AppSettings({ filePath, platform: 'linux', arch: 'x64' });
    expect(reopened.get().compute).toMatchObject({
      mode: 'cpu',
      choiceMade: true,
      verified: false,
      lastError: {
        code: 'GPU_UNAVAILABLE',
        message: 'We could not use your video card.',
        details: 'CUDA error 999 at /usr/lib'
      }
    });
    if (process.platform !== 'win32') {
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    }
  });

  it('falls back to platform defaults for missing or corrupt files', () => {
    const filePath = makeSettingsPath();
    fs.writeFileSync(filePath, '{not json', 'utf8');
    const settings = new AppSettings({ filePath, platform: 'linux', arch: 'x64' });
    expect(settings.get().compute.mode).toBe('cpu');
    expect(settings.get().compute.choiceMade).toBe(false);
  });

  it('sanitizes unknown modes, backends and error shapes', () => {
    const filePath = makeSettingsPath();
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: 99,
        compute: {
          mode: 'turbo',
          choiceMade: 'yes',
          verified: 'yes',
          backend: 'directx',
          lastError: { code: 'X', message: '', details: 12 }
        }
      }),
      'utf8'
    );
    const settings = new AppSettings({ filePath, platform: 'linux', arch: 'x64' });
    expect(settings.get().compute).toMatchObject({
      mode: 'cpu',
      choiceMade: false,
      verified: false,
      backend: null,
      lastError: null
    });
  });
});
