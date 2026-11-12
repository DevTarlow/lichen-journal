'use strict';

// User-facing main-process copy. These strings can reach the interface
// directly, so keep product-internal terms (GGUF, Hugging Face, OCR, weights,
// checksums, runtimes) out of them. Writers should read plain sentences, while
// the technical detail stays in `details` fields and the logs.

const MODEL_LABELS = Object.freeze({
  companion: 'Companion',
  photoReader: 'Photo reader',
  photoReaderSupport: 'Photo reader support'
});

const model = Object.freeze({
  labels: MODEL_LABELS,
  dialog: Object.freeze({
    importFileTitle: 'Choose a model file',
    importFileButton: 'Use this file',
    importFileFilter: 'Model file',
    importFolderTitle: 'Choose the folder with your model files',
    importFolderButton: 'Use this folder'
  }),
  errors: Object.freeze({
    genericDownload: 'The model could not be downloaded.',
    shuttingDown: 'Model setup is closing.',
    busy: 'Another download is already running. Wait for it to finish and try again.',
    missingPart: 'The downloaded file went missing before it could be checked. Try again.',
    wrongSize: 'The downloaded file was the wrong size, so it was removed. Try again.',
    damaged: 'The downloaded file was damaged, so it was removed. Try again.',
    cancelled: 'The download was cancelled.',
    connection: 'The download could not finish. Check your connection and try again.',
    http: (status) => `The download stopped with an error (${status}). Try again.`,
    insecure: 'The download was sent to an unsecured address, so it was stopped.',
    noData: 'The download returned no data. Try again.',
    disk: 'The file could not be saved. Check free space and permissions.',
    tooLarge: 'The downloaded file was larger than expected. Try again.',
    incomplete: 'The download ended before it finished. Try again.',
    unknownAsset: 'That download is not part of Lichen Journal.',
    importChoose: 'Choose a model file to add.',
    importOpen: 'That file could not be opened. Choose it again.',
    importWrong:
      'That file is not the one Lichen Journal needs. Choose the right file and try again.',
    createFolder:
      'Lichen Journal could not create its model folder. Check free space and permissions.',
    clearFailed:
      'Some model files could not be removed. Close any app using them and try again.'
  })
});

const companion = Object.freeze({
  errors: Object.freeze({
    missing:
      'The local companion is not installed. Download it again in Settings, or reinstall Lichen Journal.',
    loadFailed:
      'The companion could not start. Its files may be missing or damaged, or the computer may need more free memory.'
  })
});

const photoReader = Object.freeze({
  errors: Object.freeze({
    runtimeMissing:
      'The photo reader is missing from this installation. Reinstall Lichen Journal.',
    notInstalled:
      'The photo reader is not installed yet. Download it in Settings, then try again.',
    runtimeStart:
      'The photo reader could not start. Try again, or reinstall Lichen Journal if it keeps happening.',
    readFailed: 'The photo reader could not read this photo. Try a clearer or smaller photo.'
  })
});

module.exports = { model, companion, photoReader };
