import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ModelStore } from '../src/main/model-manager.js';

const tempDirs = [];
const servers = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichen-model-store-'));
  tempDirs.push(dir);
  return dir;
}

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function makeAsset(id, data, url, overrides = {}) {
  return {
    id,
    label: id,
    file: `${id}.bin`,
    bytes: data.length,
    sha256: digest(data),
    url,
    ...overrides
  };
}

async function startServer(files, slowPaths = new Set()) {
  const server = http.createServer((request, response) => {
    const requestPath = request.url.split('?')[0];
    const item = files[requestPath];
    if (!item) {
      response.writeHead(404);
      response.end('missing');
      return;
    }
    const range = request.headers.range;
    if (range) {
      const start = Number(range.match(/bytes=(\d+)-/)?.[1] || 0);
      const body = item.subarray(start);
      response.writeHead(206, {
        'Content-Length': body.length,
        'Content-Range': `bytes ${start}-${item.length - 1}/${item.length}`
      });
      response.end(body);
      return;
    }
    response.writeHead(200, { 'Content-Length': item.length });
    if (!slowPaths.has(requestPath)) {
      response.end(item);
      return;
    }
    let offset = 0;
    const timer = setInterval(() => {
      if (offset >= item.length) {
        clearInterval(timer);
        response.end();
        return;
      }
      const next = item.subarray(offset, offset + 64);
      offset += next.length;
      response.write(next);
    }, 12);
    response.on('close', () => clearInterval(timer));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise((resolve) => server.close(resolve));
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('model store', () => {
  it('downloads and verifies an asset atomically', async () => {
    const data = Buffer.from('model-data-'.repeat(200));
    const base = await startServer({ '/asset.bin': data });
    const modelDir = makeTempDir();
    const asset = makeAsset('asset', data, `${base}/asset.bin`);
    const store = new ModelStore({ modelDir, assets: [asset] });

    const status = await store.download('asset');
    expect(status.state).toBe('ready');
    expect(status.source).toBe('download');
    expect(fs.readFileSync(path.join(modelDir, 'asset.bin'))).toEqual(data);
    expect(fs.existsSync(path.join(modelDir, 'asset.bin.sha256'))).toBe(true);
  });

  it('continues after one asset fails and keeps completed assets', async () => {
    const first = Buffer.from('first-'.repeat(300));
    const second = Buffer.from('second-'.repeat(300));
    const base = await startServer({ '/first.bin': first, '/second.bin': second });
    const modelDir = makeTempDir();
    const store = new ModelStore({
      modelDir,
      assets: [
        makeAsset('first', first, `${base}/first.bin`),
        makeAsset('missing', Buffer.from('missing'), `${base}/nope.bin`),
        makeAsset('second', second, `${base}/second.bin`)
      ]
    });

    const status = await store.downloadAll();
    expect(status.assets.first.state).toBe('ready');
    expect(status.assets.second.state).toBe('ready');
    expect(status.assets.missing.state).toBe('error');
    expect(status.errors.missing).toBeTruthy();
    expect(fs.existsSync(path.join(modelDir, 'first.bin'))).toBe(true);
  });

  it('resumes a partial file with a Range request', async () => {
    const data = Buffer.from('resume-data-'.repeat(500));
    const base = await startServer({ '/resume.bin': data });
    const modelDir = makeTempDir();
    fs.writeFileSync(path.join(modelDir, 'resume.bin.part'), data.subarray(0, 300));
    const store = new ModelStore({
      modelDir,
      assets: [makeAsset('resume', data, `${base}/resume.bin`)]
    });

    const status = await store.download('resume');
    expect(status.state).toBe('ready');
    expect(fs.readFileSync(path.join(modelDir, 'resume.bin'))).toEqual(data);
  });

  it('cancels without deleting the partial file', async () => {
    const data = Buffer.from('slow-data-'.repeat(1000));
    const base = await startServer({ '/slow.bin': data }, new Set(['/slow.bin']));
    const modelDir = makeTempDir();
    const store = new ModelStore({
      modelDir,
      assets: [makeAsset('slow', data, `${base}/slow.bin`)],
      stallTimeoutMs: 5000
    });

    const job = store.download('slow');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.cancel()).toBe(true);
    await expect(job).rejects.toMatchObject({ code: 'MODEL_CANCELLED' });
    expect(fs.existsSync(path.join(modelDir, 'slow.bin.part'))).toBe(true);
  });

  it('rejects a checksum mismatch and removes the bad part', async () => {
    const data = Buffer.from('bad-checksum-'.repeat(200));
    const base = await startServer({ '/bad.bin': data });
    const modelDir = makeTempDir();
    const store = new ModelStore({
      modelDir,
      assets: [
        makeAsset('bad', data, `${base}/bad.bin`, { sha256: '0'.repeat(64) })
      ]
    });

    await expect(store.download('bad')).rejects.toMatchObject({
      code: 'MODEL_CHECKSUM_MISMATCH'
    });
    expect(fs.existsSync(path.join(modelDir, 'bad.bin'))).toBe(false);
    expect(fs.existsSync(path.join(modelDir, 'bad.bin.part'))).toBe(false);
    expect(store.getStatus().assets.bad.state).toBe('error');
  });

  it('imports expected files from a folder', async () => {
    const data = Buffer.from('import-data-'.repeat(500));
    const modelDir = makeTempDir();
    const sourceDir = makeTempDir();
    fs.writeFileSync(path.join(sourceDir, 'imported.bin'), data);
    const store = new ModelStore({
      modelDir,
      assets: [makeAsset('imported', data, 'https://example.invalid/imported.bin')]
    });

    const result = await store.importFolder(sourceDir);
    expect(result.imported).toEqual(['imported']);
    expect(result.status.assets.imported.state).toBe('ready');
  });

  it('prefers a legacy model without downloading', async () => {
    const data = Buffer.from('legacy-data');
    const modelDir = makeTempDir();
    const legacyDir = makeTempDir();
    fs.writeFileSync(path.join(legacyDir, 'legacy.bin'), data);
    const store = new ModelStore({
      modelDir,
      legacyDir,
      assets: [makeAsset('legacy', data, 'https://example.invalid/legacy.bin')]
    });

    const status = store.getStatus();
    expect(status.assets.legacy.state).toBe('ready');
    expect(status.assets.legacy.source).toBe('legacy');
    expect(store.getActivePath('legacy')).toBe(path.join(legacyDir, 'legacy.bin'));
  });

  it('rejects overlapping downloads', async () => {
    const data = Buffer.from('busy-data-'.repeat(1000));
    const base = await startServer({ '/busy.bin': data });
    const modelDir = makeTempDir();
    const store = new ModelStore({
      modelDir,
      assets: [makeAsset('busy', data, `${base}/busy.bin`)]
    });

    const job = store.download('busy');
    await expect(store.download('busy')).rejects.toMatchObject({
      code: 'MODEL_DOWNLOAD_BUSY'
    });
    store.cancel();
    await job.catch(() => {});
  });
});
