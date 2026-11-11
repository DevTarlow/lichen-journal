'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => {
    try {
      callback(payload);
    } catch (error) {
      console.error('Lichen listener error', error);
    }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  app: {
    info: () => invoke('app:info'),
    copyText: (text) => invoke('app:copy-text', { text }),
    setTheme: (theme) => invoke('app:set-theme', { theme }),
    offlineCheck: () => invoke('app:offline-check'),
    onFlushBeforeClose: (callback) => subscribe('app:flush-before-close', callback),
    flushComplete: () => ipcRenderer.send('app:flush-complete')
  },
  vault: {
    info: () => invoke('vault:info'),
    getPath: () => invoke('vault:get-path'),
    get: (date) => invoke('vault:get', { date }),
    list: (options) => invoke('vault:list', options),
    range: (from, to) => invoke('vault:range', { from, to }),
    search: (query, tags, limit) => invoke('vault:search', { query, tags, limit }),
    tags: () => invoke('vault:tags'),
    save: (date, title, body) => invoke('vault:save', { date, title, body }),
    deleteEntry: (date) => invoke('vault:delete-entry', { date }),
    setMood: (date, mood) => invoke('vault:set-mood', { date, mood }),
    previousReflection: (date) => invoke('vault:previous-reflection', { date }),
    saveReflectionAnswer: (date, question, answer) =>
      invoke('vault:save-reflection-answer', { date, question, answer }),
    exportZip: () => invoke('vault:export'),
    purge: (confirm) => invoke('vault:purge', { confirm }),
    openFolder: () => invoke('vault:open-folder'),
    onChanged: (callback) => subscribe('vault:changed', callback)
  },
  model: {
    status: () => invoke('model:status'),
    download: (assetId) => invoke('model:download', { assetId }),
    cancel: () => invoke('model:cancel'),
    importFolder: () => invoke('model:import-folder'),
    importFile: (assetId) => invoke('model:import-file', { assetId }),
    onStatus: (callback) => subscribe('model:status', callback)
  },
  ocr: {
    status: () => invoke('ocr:status'),
    pickImage: () => invoke('ocr:pick-image'),
    recognize: (token, requestId) => invoke('ocr:recognize', { token, requestId }),
    cancel: (requestId) => invoke('ocr:cancel', { requestId }),
    onStatus: (callback) => subscribe('ocr:status', callback)
  },
  ai: {
    status: () => invoke('ai:status'),
    reflect: (requestId, date, text, options = {}) =>
      invoke('ai:reflect', {
        requestId,
        date,
        text,
        lens: options.lens,
        carry: options.carry
      }),
    extractMetadata: (requestId, date, text) =>
      invoke('ai:extract-metadata', { requestId, date, text }),
    moodPalette: (requestId, date, text) =>
      invoke('ai:mood-palette', { requestId, date, text }),
    cancel: (requestId) => invoke('ai:cancel', { requestId }),
    reload: () => invoke('ai:reload'),
    onStatus: (callback) => subscribe('ai:status', callback),
    onStream: (callback) => subscribe('ai:stream', callback)
  }
};

contextBridge.exposeInMainWorld('lichen', Object.freeze(api));
