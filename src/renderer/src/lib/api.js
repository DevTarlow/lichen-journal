export class LichenApiError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'LichenApiError';
    this.code = code || 'API_ERROR';
    this.details = details;
  }
}

function bridge() {
  if (!window.lichen) {
    throw new LichenApiError(
      'NO_BRIDGE',
      'Lichen Journal needs its Electron shell to reach the local vault.'
    );
  }
  return window.lichen;
}

async function call(operation) {
  try {
    const response = await operation();
    if (!response || response.ok !== true) {
      const error = (response && response.error) || {};
      throw new LichenApiError(
        error.code || 'API_ERROR',
        error.message || 'The local vault did not answer.',
        error.details
      );
    }
    return response.data;
  } catch (error) {
    if (error instanceof LichenApiError) throw error;
    throw new LichenApiError(
      error.code || 'API_ERROR',
      error.message || 'The local vault did not answer.',
      error.details
    );
  }
}

export const api = {
  app: {
    info: () => call(() => bridge().app.info()),
    copyText: (text) => call(() => bridge().app.copyText(text)),
    setTheme: (theme) => call(() => bridge().app.setTheme(theme)),
    offlineCheck: () => call(() => bridge().app.offlineCheck()),
    onFlushBeforeClose: (callback) => bridge().app.onFlushBeforeClose(callback),
    flushComplete: () => bridge().app.flushComplete()
  },
  vault: {
    info: () => call(() => bridge().vault.info()),
    get: (date) => call(() => bridge().vault.get(date)),
    list: (options = {}) => call(() => bridge().vault.list(options)),
    range: (from, to) => call(() => bridge().vault.range(from, to)),
    search: (query, tags = [], limit = 100) =>
      call(() => bridge().vault.search(query, tags, limit)),
    tags: () => call(() => bridge().vault.tags()),
    save: (date, title, body) => call(() => bridge().vault.save(date, title, body)),
    deleteEntry: (date) => call(() => bridge().vault.deleteEntry(date)),
    setMood: (date, mood) => call(() => bridge().vault.setMood(date, mood)),
    previousReflection: (date) => call(() => bridge().vault.previousReflection(date)),
    saveReflectionAnswer: (date, question, answer) =>
      call(() => bridge().vault.saveReflectionAnswer(date, question, answer)),
    exportZip: () => call(() => bridge().vault.exportZip()),
    purge: (confirm) => call(() => bridge().vault.purge(confirm)),
    openFolder: () => call(() => bridge().vault.openFolder()),
    onChanged: (callback) => bridge().vault.onChanged(callback)
  },
  model: {
    status: () => call(() => bridge().model.status()),
    download: (assetId) => call(() => bridge().model.download(assetId)),
    cancel: () => call(() => bridge().model.cancel()),
    importFolder: () => call(() => bridge().model.importFolder()),
    importFile: (assetId) => call(() => bridge().model.importFile(assetId)),
    onStatus: (callback) => bridge().model.onStatus(callback)
  },
  compute: {
    status: () => call(() => bridge().compute.status()),
    useCpu: () => call(() => bridge().compute.useCpu()),
    testGpu: () => call(() => bridge().compute.testGpu()),
    onChanged: (callback) => bridge().compute.onChanged(callback)
  },
  ocr: {
    status: () => call(() => bridge().ocr.status()),
    pickImage: () => call(() => bridge().ocr.pickImage()),
    recognize: (token, requestId) =>
      call(() => bridge().ocr.recognize(token, requestId)),
    cancel: (requestId) => call(() => bridge().ocr.cancel(requestId)),
    onStatus: (callback) => bridge().ocr.onStatus(callback)
  },
  ai: {
    status: () => call(() => bridge().ai.status()),
    reflect: (requestId, date, text, options = {}) =>
      call(() => bridge().ai.reflect(requestId, date, text, options)),
    extractMetadata: (requestId, date, text) =>
      call(() => bridge().ai.extractMetadata(requestId, date, text)),
    moodPalette: (requestId, date, text) =>
      call(() => bridge().ai.moodPalette(requestId, date, text)),
    cancel: (requestId) => call(() => bridge().ai.cancel(requestId)),
    reload: () => call(() => bridge().ai.reload()),
    onStatus: (callback) => bridge().ai.onStatus(callback),
    onStream: (callback) => bridge().ai.onStream(callback)
  }
};
