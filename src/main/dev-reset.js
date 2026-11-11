'use strict';

const { seedMockJournal } = require('./dev-mock-data');

class DevResetError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'DevResetError';
    this.code = code;
    this.details = details;
  }
}

function preserveError(error) {
  if (error instanceof DevResetError) return error;
  if (error && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)) {
    return new DevResetError(
      error.code,
      typeof error.message === 'string' ? error.message : 'The app could not be reset.',
      typeof error.details === 'string' ? error.details : undefined
    );
  }
  return new DevResetError(
    'RESET_FAILED',
    'The app could not finish resetting. Check the logs and try again.',
    error && typeof error.message === 'string' ? error.message : undefined
  );
}

async function performDevReset({
  mode,
  vault,
  modelStore,
  settings,
  ai,
  ocr,
  compute,
  now = new Date()
} = {}) {
  if (mode !== 'fresh' && mode !== 'mock') {
    throw new DevResetError('RESET_INVALID_MODE', 'Choose either a fresh reset or a mock reset.');
  }
  if (!vault || typeof vault.purge !== 'function') {
    throw new DevResetError('RESET_FAILED', 'The journal vault is unavailable.');
  }

  let status = null;
  try {
    status = modelStore ? modelStore.getStatus() : null;
  } catch {
    status = null;
  }
  if (status && status.busy) {
    throw new DevResetError(
      'RESET_BUSY',
      'Wait for the current model download to finish, then reset again.'
    );
  }

  try {
    if (ai) {
      if (typeof ai.cancelAll === 'function') ai.cancelAll();
      if (typeof ai.unload === 'function') await ai.unload();
    }
    if (ocr && typeof ocr.cancelAll === 'function') ocr.cancelAll();

    if (mode === 'fresh') {
      if (!modelStore || typeof modelStore.removeDownloaded !== 'function') {
        throw new DevResetError('RESET_FAILED', 'The model store is unavailable.');
      }
      // Remove the model files before touching the journal. A locked file
      // should leave the journal intact instead of half-wiping the app.
      modelStore.removeDownloaded();
    }

    vault.purge({ confirm: 'PURGE' });

    if (mode === 'fresh') {
      if (settings && typeof settings.reset === 'function') settings.reset();
      if (compute && typeof compute.apply === 'function') compute.apply();
      return { mode, seeded: null };
    }

    const seeded = seedMockJournal(vault, { now });
    return { mode, seeded };
  } catch (error) {
    throw preserveError(error);
  }
}

module.exports = { DevResetError, performDevReset };
