import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Vault } from '../src/main/db.js';
import { ModelStore } from '../src/main/model-manager.js';
import { AppSettings } from '../src/main/app-settings.js';
import { MOCK_ENTRY_COUNT } from '../src/main/dev-mock-data.js';
import { performDevReset } from '../src/main/dev-reset.js';

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichen-dev-reset-'));
  tempDirs.push(dir);
  return dir;
}

function makeVault(dir, date = '2026-03-15') {
  const vault = new Vault({
    dbPath: path.join(dir, 'vault', 'lichen_journal.sqlite'),
    appVersion: 'test'
  });
  vault.init();
  vault.saveEntry({ date, title: 'Existing page', body: 'Existing words.' });
  return vault;
}

function makeModelStore() {
  const data = Buffer.from('mock-model-data-'.repeat(100));
  const asset = {
    id: 'companion',
    label: 'Companion',
    file: 'companion.bin',
    bytes: data.length,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    url: 'https://example.invalid/companion.bin'
  };
  const modelDir = makeTempDir();
  fs.writeFileSync(path.join(modelDir, asset.file), data);
  fs.writeFileSync(path.join(modelDir, `${asset.file}.sha256`), `${asset.sha256}\n`);
  const store = new ModelStore({ modelDir, assets: [asset] });
  return { store, modelDir, asset };
}

function makeRuntime() {
  return {
    ai: { cancelAll: vi.fn(), unload: vi.fn(async () => {}) },
    ocr: { cancelAll: vi.fn() },
    compute: { apply: vi.fn() }
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('developer reset', () => {
  it('fresh reset removes models, empties the vault, and restores settings', async () => {
    const dir = makeTempDir();
    const vault = makeVault(dir);
    const { store, modelDir, asset } = makeModelStore();
    const settings = new AppSettings({
      filePath: path.join(dir, 'settings.json'),
      platform: 'linux',
      arch: 'x64'
    });
    settings.updateCompute({
      mode: 'gpu',
      choiceMade: true,
      verified: true,
      backend: 'vulkan'
    });
    const runtime = makeRuntime();

    const result = await performDevReset({
      mode: 'fresh',
      vault,
      modelStore: store,
      settings,
      ...runtime
    });

    expect(result).toEqual({ mode: 'fresh', seeded: null });
    expect(vault.getStats().entryCount).toBe(0);
    expect(fs.existsSync(path.join(modelDir, asset.file))).toBe(false);
    expect(fs.existsSync(path.join(modelDir, `${asset.file}.sha256`))).toBe(false);
    expect(settings.get().compute).toMatchObject({
      mode: 'cpu',
      choiceMade: false,
      verified: false,
      backend: null,
      lastError: null
    });
    expect(runtime.ai.cancelAll).toHaveBeenCalledTimes(1);
    expect(runtime.ai.unload).toHaveBeenCalledTimes(1);
    expect(runtime.ocr.cancelAll).toHaveBeenCalledTimes(1);
    expect(runtime.compute.apply).toHaveBeenCalledTimes(1);

    vault.close();
  });

  it('mock reset keeps models and settings and seeds the demo journal', async () => {
    const dir = makeTempDir();
    const vault = makeVault(dir);
    const { store, modelDir, asset } = makeModelStore();
    const settings = new AppSettings({
      filePath: path.join(dir, 'settings.json'),
      platform: 'linux',
      arch: 'x64'
    });
    settings.updateCompute({
      mode: 'gpu',
      choiceMade: true,
      verified: true,
      backend: 'vulkan'
    });
    const runtime = makeRuntime();

    const result = await performDevReset({
      mode: 'mock',
      vault,
      modelStore: store,
      settings,
      now: new Date(2026, 2, 15, 12, 0, 0, 0),
      ...runtime
    });

    expect(result.mode).toBe('mock');
    expect(result.seeded.count).toBe(MOCK_ENTRY_COUNT);
    expect(vault.getStats().entryCount).toBe(MOCK_ENTRY_COUNT);
    expect(vault.getEntry('2026-03-15')?.title).toBe('Moss after the rain');
    expect(vault.getEntry('2026-03-15')).not.toBeNull();
    expect(fs.existsSync(path.join(modelDir, asset.file))).toBe(true);
    expect(settings.get().compute).toMatchObject({
      mode: 'gpu',
      choiceMade: true,
      verified: true,
      backend: 'vulkan'
    });
    expect(runtime.compute.apply).not.toHaveBeenCalled();

    vault.close();
  });

  it('rejects a reset while a model download is running and keeps the journal', async () => {
    const dir = makeTempDir();
    const vault = makeVault(dir);
    const removeDownloaded = vi.fn();
    const modelStore = {
      getStatus: () => ({ busy: true }),
      removeDownloaded
    };
    const runtime = makeRuntime();

    await expect(
      performDevReset({
        mode: 'fresh',
        vault,
        modelStore,
        settings: null,
        ...runtime
      })
    ).rejects.toMatchObject({ code: 'RESET_BUSY' });

    expect(vault.getStats().entryCount).toBe(1);
    expect(removeDownloaded).not.toHaveBeenCalled();
    expect(runtime.ai.unload).not.toHaveBeenCalled();

    vault.close();
  });
});
