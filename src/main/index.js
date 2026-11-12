'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  session,
  shell
} = require('electron');
const { Vault, VaultError } = require('./db');
const { AiEngine, AiEngineError } = require('./ai');
const { OcrEngine, OcrEngineError } = require('./ocr');
const { AppSettings } = require('./app-settings');
const { ComputeController } = require('./compute');
const { ComputeError, computeCapabilities } = require('./compute-utils');
const { runGpuProbe } = require('./compute-probe');
const {
  MAX_IMAGE_BYTES,
  MAX_OCR_TEXT_CHARS,
  resolveOcrPaths,
  supportedImageExtension
} = require('./ocr-utils');
const { ModelStore, ModelManagerError } = require('./model-manager');
const { DOWNLOADABLE_MODELS } = require('./model-catalog');
const { model: modelCopy } = require('./copy');
const {
  applyOfflineSwitches,
  hardenSession,
  hardenWebContents,
  normalizeDevOrigin,
  verifyOffline
} = require('./security');
const { runSelftest } = require('./selftest');

const IS_SELFTEST = process.env.LICHEN_SELFTEST === '1';
const BACKGROUND = { light: '#f3eee1', dark: '#111713' };
const MAX_PREVIEW_WIDTH = 1200;
const MAX_NORMALIZED_IMAGE_BYTES = 60 * 1024 * 1024;
const PHOTO_TOKEN_TTL_MS = 10 * 60 * 1000;

let selftestTempDir = null;
if (IS_SELFTEST && !process.env.LICHEN_USER_DATA_DIR) {
  selftestTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichen-selftest-'));
  process.env.LICHEN_USER_DATA_DIR = selftestTempDir;
}

if (process.env.LICHEN_USER_DATA_DIR) {
  const testDataDir = path.resolve(process.env.LICHEN_USER_DATA_DIR);
  fs.mkdirSync(testDataDir, { recursive: true, mode: 0o700 });
  app.setPath('userData', testDataDir);
}

applyOfflineSwitches(app.isPackaged);
if (process.env.LICHEN_ENABLE_GPU !== '1') {
  app.disableHardwareAcceleration();
}
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const devServerUrl = !app.isPackaged ? process.env.VITE_DEV_SERVER_URL || null : null;
const devOrigin = normalizeDevOrigin(devServerUrl);
const appRoot = path.join(__dirname, '../..');
const defaultModelDir = app.isPackaged
  ? path.join(app.getPath('userData'), 'models')
  : path.join(appRoot, 'models');
const modelDir = process.env.LICHEN_MODEL_DIR
  ? path.resolve(process.env.LICHEN_MODEL_DIR)
  : defaultModelDir;
const legacyModelDir = app.isPackaged
  ? path.join(process.resourcesPath, 'models')
  : null;
const catalogAssets = (() => {
  if (!app.isPackaged && process.env.LICHEN_MODEL_TEST_MANIFEST) {
    try {
      const parsed = JSON.parse(process.env.LICHEN_MODEL_TEST_MANIFEST);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // Ignore a malformed test override and use the real catalog.
    }
  }
  return DOWNLOADABLE_MODELS;
})();

let mainWindow = null;
let vault = null;
let ai = null;
let ocr = null;
let modelStore = null;
let settingsStore = null;
let compute = null;
const pendingImages = new Map();
const tempOcrImages = new Set();
let allowClose = false;
let closeRequested = false;
let quitRequested = false;
let closeTimer = null;
let cleanupStarted = false;
let cleanupFinished = false;
let ipcRegistered = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function todayLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function broadcast(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
    try {
      window.webContents.send(channel, payload);
    } catch {
      // A window may be closing; ignore delivery failures.
    }
  }
}

function serializeError(error) {
  if (
    error instanceof VaultError ||
    error instanceof AiEngineError ||
    error instanceof OcrEngineError ||
    error instanceof ModelManagerError ||
    error instanceof ComputeError
  ) {
    return {
      code: error.code || 'ERROR',
      message: error.message,
      details:
        typeof error.details === 'string' ? error.details.slice(0, 800) : undefined
    };
  }
  if (error && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)) {
    return {
      code: error.code,
      message: typeof error.message === 'string' ? error.message : 'The operation failed.'
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong inside Lichen Journal. Your notes are still on disk.'
  };
}

function ok(data) {
  return { ok: true, data };
}

function fail(error, channel = '') {
  if (channel) {
    console.error(`[lichen] ${channel} failed:`, error && error.message ? error.message : error);
  }
  return { ok: false, error: serializeError(error) };
}

function trustedSender(event) {
  const url = event && event.senderFrame ? event.senderFrame.url : '';
  if (!url) return false;
  if (url.startsWith('file://')) return true;
  if (devOrigin && url.startsWith(`${devOrigin}/`)) return true;
  if (devOrigin && url === devOrigin) return true;
  return false;
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    if (!trustedSender(event)) {
      return { ok: false, error: { code: 'UNTRUSTED_SENDER', message: 'Request rejected.' } };
    }
    try {
      return ok(await fn(payload || {}, event));
    } catch (error) {
      return fail(error, channel);
    }
  });
}

function requireText(value, name, maxLength = 2_000_000) {
  if (typeof value !== 'string') {
    throw new VaultError('INVALID_INPUT', `${name} must be text.`);
  }
  if (value.length > maxLength) {
    throw new VaultError('INPUT_TOO_LARGE', `${name} is too large.`);
  }
  return value;
}

function requireDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new VaultError('INVALID_DATE', 'A journal date must use YYYY-MM-DD.');
  }
  return value;
}

function requireRequestId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) {
    throw new VaultError('INVALID_REQUEST', 'The companion request identifier is invalid.');
  }
  return value;
}

function getOcrPaths() {
  const paths = resolveOcrPaths({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appRoot,
    modelDir
  });
  if (!modelStore) return paths;
  return {
    ...paths,
    modelPath: modelStore.getActivePath('ocrModel'),
    projectorPath: modelStore.getActivePath('ocrProjector')
  };
}

function modelFacts() {
  const status = modelStore ? modelStore.getStatus() : null;
  const aiStatus = ai ? ai.getStatus() : {};
  const companion = status?.assets?.companion;
  return {
    modelPath: aiStatus.modelPath || companion?.path || '',
    modelPresent: Boolean(aiStatus.modelPresent),
    modelBytes: Number(aiStatus.modelBytes) || companion?.bytes || 0,
    modelStatus: status,
    modelSource: companion?.source || null
  };
}

function ocrFacts() {
  const status = ocr ? ocr.getStatus() : {};
  return {
    ocrModelPath: status.modelPath || '',
    ocrProjectorPath: status.projectorPath || '',
    ocrRuntimePath: status.runtimePath || '',
    ocrModelPresent: Boolean(status.modelPresent),
    ocrProjectorPresent: Boolean(status.projectorPresent),
    ocrRuntimePresent: Boolean(status.runtimePresent),
    ocrStatus: status
  };
}

function fullVaultInfo() {
  const info = vault.getInfo();
  return {
    ...info,
    userDataPath: app.getPath('userData'),
    appVersion: app.getVersion(),
    compute: compute ? compute.getStatus() : null,
    ...modelFacts(),
    ...ocrFacts()
  };
}

function purgeExpiredImages() {
  const now = Date.now();
  for (const [token, item] of pendingImages) {
    if (!item || item.expiresAt <= now) pendingImages.delete(token);
  }
}

function previewDataUrl(image) {
  const size = image.getSize();
  const preview =
    size.width > MAX_PREVIEW_WIDTH
      ? image.resize({ width: MAX_PREVIEW_WIDTH, quality: 'good' })
      : image;
  const jpeg = preview.toJPEG(82);
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

function ensureEntryFor(date, text) {
  const existing = vault.getEntry(date);
  if (existing) return existing;
  const saved = vault.saveEntry({ date, title: '', body: text });
  return saved.entry;
}

function registerIpc() {
  if (ipcRegistered) return;
  ipcRegistered = true;

  handle('app:info', async () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    userDataPath: app.getPath('userData'),
    dbPath: vault.dbPath,
    vaultDir: vault.vaultDir,
    compute: compute ? compute.getStatus() : null,
    ...modelFacts(),
    aiStatus: ai.getStatus(),
    stats: vault.getStats(),
    ...ocrFacts()
  }));

  handle('app:copy-text', async ({ text }) => {
    const safeText = requireText(text, 'Clipboard text', 10_000);
    clipboard.writeText(safeText);
    return { copied: true };
  });

  handle('app:set-theme', async ({ theme }) => {
    const safeTheme = ['light', 'dark', 'system'].includes(theme) ? theme : 'system';
    nativeTheme.themeSource = safeTheme;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(
        safeTheme === 'dark' ? BACKGROUND.dark : BACKGROUND.light
      );
    }
    return { theme: safeTheme, resolved: nativeTheme.shouldUseDarkColors ? 'dark' : 'light' };
  });

  handle('app:offline-check', async () => verifyOffline());

  handle('vault:info', async () => fullVaultInfo());

  handle('vault:get-path', async () => fullVaultInfo());

  handle('vault:get', async ({ date }) => ({
    entry: vault.getEntry(requireDate(date))
  }));

  handle('vault:list', async (payload = {}) => ({
    entries: vault.listEntries({
      limit: payload.limit,
      offset: payload.offset
    })
  }));

  handle('vault:range', async ({ from, to }) => ({
    entries: vault.getEntriesRange(requireDate(from), requireDate(to))
  }));

  handle('vault:search', async (payload = {}) => {
    const result = vault.searchEntries({
      query: typeof payload.query === 'string' ? payload.query : '',
      tags: Array.isArray(payload.tags) ? payload.tags : [],
      limit: payload.limit
    });
    return { entries: result.entries, mode: result.mode };
  });

  handle('vault:tags', async () => ({ tags: vault.getTags() }));

  handle('vault:save', async ({ date, title, body }) => {
    const safeDate = requireDate(date);
    const result = vault.saveEntry({
      date: safeDate,
      title: requireText(title == null ? '' : title, 'Title', 2_000),
      body: requireText(body == null ? '' : body, 'Entry body', 2_000_000)
    });
    if (result.entry) {
      broadcast('vault:changed', { reason: 'save', date: safeDate });
    }
    return result;
  });

  handle('vault:delete-entry', async ({ date }) => {
    const safeDate = requireDate(date);
    const result = vault.deleteEntry(safeDate);
    broadcast('vault:changed', { reason: 'delete', date: safeDate });
    return result;
  });

  handle('vault:set-mood', async ({ date, mood }) => ({
    entry: vault.setMood(requireDate(date), mood)
  }));

  handle('vault:previous-reflection', async ({ date }) => ({
    previous: vault.getPreviousReflection(requireDate(date))
  }));

  handle('vault:save-reflection-answer', async ({ date, question, answer }) => {
    const safeDate = requireDate(date);
    const safeQuestion = requireText(question, 'Reflection question', 4_000);
    const safeAnswer = requireText(answer, 'Reflection answer', 20_000);
    const entry = vault.saveReflectionAnswer(safeDate, safeQuestion, safeAnswer);
    broadcast('vault:changed', { reason: 'reflection-answer', date: safeDate });
    return { entry };
  });

  handle('vault:export', async () => {
    const options = {
      title: 'Export Lichen Journal',
      buttonLabel: 'Export vault',
      defaultPath: path.join(
        app.getPath('documents'),
        `lichen-journal-export-${todayLocal()}.zip`
      ),
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    };
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    const exported = await vault.exportToZip(result.filePath);
    return { canceled: false, ...exported };
  });

  handle('vault:purge', async ({ confirm }) => {
    ai.cancelAll();
    if (ocr) ocr.cancelAll();
    const result = vault.purge({ confirm });
    broadcast('vault:changed', { reason: 'purge' });
    return { ...result, info: fullVaultInfo() };
  });

  if (!app.isPackaged) {
    const { performDevReset } = require('./dev-reset');
    handle('dev:reset', async ({ mode }) => {
      pendingImages.clear();
      const result = await performDevReset({
        mode,
        vault,
        modelStore,
        settings: settingsStore,
        ai,
        ocr,
        compute
      });
      syncModelPaths();
      broadcast('vault:changed', { reason: 'dev-reset' });
      broadcast('model:status', modelStore.getStatus());
      broadcast('ai:status', ai.getStatus());
      if (compute) broadcast('compute:changed', compute.getStatus());
      return {
        ...result,
        info: fullVaultInfo(),
        modelStatus: modelStore.getStatus()
      };
    });
  }

  handle('vault:open-folder', async () => {
    const error = await shell.openPath(vault.vaultDir);
    return { opened: !error, error: error || null };
  });

  handle('ai:status', async () => ai.getStatus());

  handle('ai:reload', async () => {
    if (compute) compute.apply();
    return ai.reload();
  });

  handle('ai:cancel', async ({ requestId }) => ({
    cancelled: ai.cancel(requireRequestId(requestId))
  }));

  handle('compute:status', async () => (compute ? compute.getStatus() : null));

  handle('compute:use-cpu', async () => {
    if (!compute) throw new ComputeError('COMPUTE_UNAVAILABLE', 'The accelerator is unavailable.');
    return compute.useCpu();
  });

  handle('compute:test-gpu', async () => {
    if (!compute) throw new ComputeError('COMPUTE_UNAVAILABLE', 'The accelerator is unavailable.');
    return compute.testGpu();
  });

  handle('ai:reflect', async ({ date, text, requestId, lens, carry }) => {
    const safeDate = requireDate(date);
    const safeRequestId = requireRequestId(requestId);
    const safeText = requireText(text, 'Entry text', 2_000_000);
    ensureEntryFor(safeDate, safeText);
    const reflection = await ai.reflect({
      text: safeText,
      requestId: safeRequestId,
      lens: typeof lens === 'string' ? lens : undefined,
      carry: typeof carry === 'string' ? carry : '',
      onChunk: (chunk) => {
        if (typeof chunk === 'string' && chunk) {
          broadcast('ai:stream', { requestId: safeRequestId, chunk });
        }
      }
    });
    let entry = null;
    try {
      entry = vault.saveReflection(safeDate, reflection);
    } catch (error) {
      if (!(error instanceof VaultError) || error.code !== 'ENTRY_NOT_FOUND') throw error;
    }
    broadcast('vault:changed', { reason: 'reflection', date: safeDate });
    return { reflection, entry };
  });

  handle('ai:extract-metadata', async ({ date, text, requestId }) => {
    const safeDate = requireDate(date);
    const safeRequestId = requireRequestId(requestId);
    const safeText = requireText(text, 'Entry text', 2_000_000);
    ensureEntryFor(safeDate, safeText);
    const metadata = await ai.extractMetadata({ text: safeText, requestId: safeRequestId });
    const entry = vault.applyMetadata(safeDate, metadata);
    broadcast('vault:changed', { reason: 'metadata', date: safeDate });
    return { metadata, entry };
  });

  handle('ai:mood-palette', async ({ date, text, requestId }) => {
    const safeDate = requireDate(date);
    const safeRequestId = requireRequestId(requestId);
    const safeText = requireText(text, 'Entry text', 2_000_000);
    const existing = ensureEntryFor(safeDate, safeText);
    const palette = await ai.moodPalette({
      text: safeText,
      requestId: safeRequestId,
      mood: existing ? existing.mood : null
    });
    const entry = vault.applyPalette(safeDate, palette);
    broadcast('vault:changed', { reason: 'palette', date: safeDate });
    return { palette, entry };
  });

  handle('model:status', async () => (modelStore ? modelStore.getStatus() : null));

  handle('model:download', async ({ assetId } = {}) => {
    const id = assetId == null ? '' : requireText(assetId, 'Model asset', 64);
    const status = id ? await modelStore.download(id) : await modelStore.downloadAll();
    syncModelPaths();
    return status;
  });

  handle('model:cancel', async () => ({
    cancelled: modelStore ? modelStore.cancel() : false
  }));

  handle('model:import-folder', async () => {
    const options = {
      title: modelCopy.dialog.importFolderTitle,
      buttonLabel: modelCopy.dialog.importFolderButton,
      properties: ['openDirectory']
    };
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths || !result.filePaths[0]) {
      return { canceled: true };
    }
    const imported = await modelStore.importFolder(result.filePaths[0]);
    syncModelPaths();
    return { canceled: false, ...imported };
  });

  handle('model:import-file', async ({ assetId }) => {
    const id = requireText(assetId, 'Model asset', 64);
    const options = {
      title: modelCopy.dialog.importFileTitle,
      buttonLabel: modelCopy.dialog.importFileButton,
      filters: [{ name: modelCopy.dialog.importFileFilter, extensions: ['gguf'] }],
      properties: ['openFile']
    };
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths || !result.filePaths[0]) {
      return { canceled: true };
    }
    const status = await modelStore.importFile(id, result.filePaths[0]);
    syncModelPaths();
    return { canceled: false, status };
  });

  handle('ocr:status', async () => (ocr ? ocr.getStatus() : null));

  handle('ocr:pick-image', async () => {
    purgeExpiredImages();
    const options = {
      title: 'Choose a page photo',
      buttonLabel: 'Use this photo',
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
      ],
      properties: ['openFile']
    };
    const result =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths || !result.filePaths[0]) {
      return { canceled: true };
    }

    const filePath = result.filePaths[0];
    if (!supportedImageExtension(filePath)) {
      throw new OcrEngineError(
        'UNSUPPORTED_IMAGE',
        'Choose a PNG, JPEG, or WebP photo of the page.'
      );
    }
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      throw new OcrEngineError('INVALID_IMAGE', 'That photo could not be opened.');
    }
    if (!stat.isFile() || stat.size <= 0) {
      throw new OcrEngineError('INVALID_IMAGE', 'That photo could not be opened.');
    }
    if (stat.size > MAX_IMAGE_BYTES) {
      throw new OcrEngineError(
        'IMAGE_TOO_LARGE',
        'That photo is too large. Choose an image under 25 MB.'
      );
    }

    let image;
    try {
      image = nativeImage.createFromPath(filePath);
    } catch {
      image = null;
    }
    if (!image || image.isEmpty()) {
      throw new OcrEngineError(
        'UNSUPPORTED_IMAGE',
        'That image format could not be read. Choose a PNG, JPEG, or WebP photo.'
      );
    }
    const size = image.getSize();
    if (size.width < 32 || size.height < 32) {
      throw new OcrEngineError('INVALID_IMAGE', 'That photo is too small to read.');
    }

    const token = crypto.randomBytes(24).toString('hex');
    pendingImages.set(token, {
      filePath,
      fileName: path.basename(filePath),
      bytes: stat.size,
      expiresAt: Date.now() + PHOTO_TOKEN_TTL_MS
    });
    return {
      canceled: false,
      token,
      fileName: path.basename(filePath),
      bytes: stat.size,
      width: size.width,
      height: size.height,
      previewDataUrl: previewDataUrl(image)
    };
  });

  handle('ocr:recognize', async ({ token, requestId }) => {
    purgeExpiredImages();
    const safeToken = requireText(token, 'Photo token', 200);
    const safeRequestId = requireRequestId(requestId);
    const item = pendingImages.get(safeToken);
    if (!item) {
      throw new OcrEngineError(
        'IMAGE_EXPIRED',
        'That photo is no longer available. Choose it again.'
      );
    }

    let image;
    try {
      image = nativeImage.createFromPath(item.filePath);
    } catch {
      image = null;
    }
    if (!image || image.isEmpty()) {
      pendingImages.delete(safeToken);
      throw new OcrEngineError('INVALID_IMAGE', 'That photo could not be opened. Choose it again.');
    }
    const png = image.toPNG();
    if (!png.length || png.length > MAX_NORMALIZED_IMAGE_BYTES) {
      throw new OcrEngineError('IMAGE_TOO_LARGE', 'That photo is too large to process.');
    }

    const tempPath = path.join(
      app.getPath('temp'),
      `lichen-ocr-${crypto.randomBytes(8).toString('hex')}.png`
    );
    fs.writeFileSync(tempPath, png, { mode: 0o600 });
    tempOcrImages.add(tempPath);
    try {
      const result = await ocr.recognize({ imagePath: tempPath, requestId: safeRequestId });
      pendingImages.delete(safeToken);
      return {
        ...result,
        text: Array.from(result.text).slice(0, MAX_OCR_TEXT_CHARS).join('')
      };
    } finally {
      fs.rmSync(tempPath, { force: true });
      tempOcrImages.delete(tempPath);
    }
  });

  handle('ocr:cancel', async ({ requestId }) => ({
    cancelled: ocr ? ocr.cancel(requireRequestId(requestId)) : false
  }));

  ipcMain.on('app:flush-complete', (event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (event.sender !== mainWindow.webContents) return;
    if (!closeRequested) return;
    finishClose();
  });
}

function buildMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const template = [
    {
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'close' }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function attachContextMenu(window) {
  window.webContents.on('context-menu', (_event, params) => {
    const template = [];
    if (params.isEditable) {
      template.push(
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' }
      );
    } else if (params.selectionText) {
      template.push({ role: 'copy' });
    }
    if (!template.length) return;
    Menu.buildFromTemplate(template).popup({ window });
  });
}

function finishClose() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  allowClose = true;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
  if (quitRequested) {
    app.quit();
  }
}

function requestRendererFlush() {
  if (closeRequested) return;
  closeRequested = true;
  if (modelStore) modelStore.cancel();
  if (ocr) ocr.cancelAll();
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    mainWindow.webContents.isDestroyed()
  ) {
    finishClose();
    return;
  }
  mainWindow.webContents.send('app:flush-before-close');
  closeTimer = setTimeout(finishClose, 1500);
}

function createWindow() {
  allowClose = false;
  closeRequested = false;
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'Lichen Journal',
    backgroundColor: BACKGROUND.light,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged || process.env.LICHEN_DEVTOOLS === '1',
      backgroundThrottling: false
    }
  });

  hardenWebContents(mainWindow.webContents, {
    devOrigin,
    isPackaged: app.isPackaged
  });
  attachContextMenu(mainWindow);

  const showWindow = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  };
  mainWindow.once('ready-to-show', showWindow);
  mainWindow.webContents.once('did-finish-load', showWindow);
  setTimeout(showWindow, 1500);

  mainWindow.on('close', (event) => {
    if (allowClose) return;
    event.preventDefault();
    requestRendererFlush();
  });

  mainWindow.on('closed', () => {
    pendingImages.clear();
    mainWindow = null;
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[lichen] renderer process gone:', details && details.reason);
  });

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    if (process.env.LICHEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

function syncModelPaths() {
  if (modelStore && ai) {
    ai.setModelPath(modelStore.getActivePath('companion'));
    ai.refreshModelPresence();
  }
  if (modelStore && ocr) {
    try {
      ocr.setModelPaths(getOcrPaths());
      ocr.refreshStatus();
    } catch {
      // An in-flight OCR read keeps the old paths until it finishes.
    }
  }
  if (compute) broadcast('compute:changed', compute.getStatus());
}

function initJournal() {
  const dbPath = path.join(app.getPath('userData'), 'vault', 'lichen_journal.sqlite');
  vault = new Vault({ dbPath, appVersion: app.getVersion() });
  vault.init();
  modelStore = new ModelStore({
    modelDir,
    legacyDir: legacyModelDir,
    assets: catalogAssets
  });
  modelStore.on('status', (status) => broadcast('model:status', status));
  settingsStore = new AppSettings({
    filePath: path.join(app.getPath('userData'), 'settings.json'),
    platform: process.platform,
    arch: process.arch
  });
  const capabilities = computeCapabilities(process.platform, process.arch);
  const rawOverride = process.env.LICHEN_COMPUTE_MODE;
  const overrideMode = rawOverride === 'gpu' || rawOverride === 'cpu' ? rawOverride : null;
  const storedMode = settingsStore.get().compute.mode;
  const initialMode = overrideMode || (capabilities.canChooseGpu ? storedMode : capabilities.fixedMode);
  ai = new AiEngine({
    modelPath: modelStore.getActivePath('companion'),
    appVersion: app.getVersion(),
    computeMode: initialMode
  });
  ai.on('status', (status) => broadcast('ai:status', status));
  ocr = new OcrEngine({
    ...getOcrPaths(),
    threads: ai.threads,
    computeMode: initialMode
  });
  ocr.on('status', (status) => broadcast('ocr:status', status));
  compute = new ComputeController({
    settings: settingsStore,
    ai,
    ocr,
    probe: runGpuProbe,
    platform: process.platform,
    arch: process.arch,
    overrideMode
  });
  compute.on('changed', (status) => broadcast('compute:changed', status));
  compute.apply();
}

function removeSelftestTempDir() {
  if (!selftestTempDir) return;
  try {
    fs.rmSync(selftestTempDir, { recursive: true, force: true });
  } catch {
    // Temporary test data is best-effort cleanup only.
  }
  selftestTempDir = null;
}

async function cleanup() {
  try {
    if (compute) compute.dispose();
  } catch (error) {
    console.error('[lichen] compute cleanup failed:', error.message);
  }
  try {
    if (modelStore) modelStore.dispose();
  } catch (error) {
    console.error('[lichen] model setup cleanup failed:', error.message);
  }
  try {
    if (ocr) ocr.dispose();
  } catch (error) {
    console.error('[lichen] OCR cleanup failed:', error.message);
  }
  pendingImages.clear();
  for (const tempPath of tempOcrImages) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Best effort; the OS temp directory is cleaned eventually.
    }
  }
  tempOcrImages.clear();
  try {
    if (ai) await ai.dispose();
  } catch (error) {
    console.error('[lichen] companion cleanup failed:', error.message);
  }
  try {
    if (vault) vault.close();
  } catch (error) {
    console.error('[lichen] vault cleanup failed:', error.message);
  }
}

function bootstrap() {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on('before-quit', (event) => {
    quitRequested = true;
    if (allowClose) return;
    event.preventDefault();
    requestRendererFlush();
  });

  app.on('will-quit', (event) => {
    if (cleanupFinished) return;
    event.preventDefault();
    if (cleanupStarted) return;
    cleanupStarted = true;
    Promise.race([cleanup(), delay(3500)])
      .then(() => delay(250))
      .finally(() => {
        cleanupFinished = true;
        app.exit(0);
      });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && !IS_SELFTEST) {
      createWindow();
    }
  });

  app
    .whenReady()
    .then(async () => {
      hardenSession(session.defaultSession, { devOrigin });
      nativeTheme.themeSource = 'system';
      buildMenu();

      try {
        initJournal();
      } catch (error) {
        console.error('[lichen] vault initialization failed:', error);
        if (IS_SELFTEST) {
          console.log(
            JSON.stringify({ ok: false, phase: 'vault-init', error: serializeError(error) })
          );
          removeSelftestTempDir();
          app.exit(1);
          return;
        }
        dialog.showErrorBox(
          'Lichen Journal could not open your vault',
          `${error.message || error}\n\nVault location: ${path.join(
            app.getPath('userData'),
            'vault',
            'lichen_journal.sqlite'
          )}\n\nYour existing vault was not modified.`
        );
        app.quit();
        return;
      }

      registerIpc();

      if (IS_SELFTEST) {
        try {
          const result = await runSelftest({
            vault,
            ai,
            ocr,
            modelStore,
            appVersion: app.getVersion()
          });
          console.log(`LICHEN_SELFTEST_RESULT ${JSON.stringify(result)}`);
          await cleanup();
          await delay(250);
          removeSelftestTempDir();
          app.exit(0);
        } catch (error) {
          console.error('[lichen] selftest failed:', error);
          console.log(
            `LICHEN_SELFTEST_RESULT ${JSON.stringify({
              ok: false,
              error: serializeError(error)
            })}`
          );
          await cleanup();
          await delay(250);
          removeSelftestTempDir();
          app.exit(1);
        }
        return;
      }

      createWindow();
    })
    .catch((error) => {
      console.error('[lichen] startup failed:', error);
      dialog.showErrorBox('Lichen Journal could not start', String(error.message || error));
      app.quit();
    });
}

const gotLock = IS_SELFTEST ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  bootstrap();
}
