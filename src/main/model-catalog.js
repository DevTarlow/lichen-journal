'use strict';

const { model } = require('./copy');

// Pinned model artifacts. These weights are not redistributed with the app;
// they are downloaded once from Hugging Face and verified locally. The labels
// live in copy.js so the interface never shows product-internal wording.
const COMPANION_MODEL = Object.freeze({
  id: 'companion',
  label: model.labels.companion,
  file: 'MiniCPM-V-4_7-1B-Q4_K_M.gguf',
  bytes: 672003680,
  sha256: 'f18f594747e5317ab490cff9c06339c9cfb89acbe2f02ebc48a4e167bc23576d',
  url: 'https://huggingface.co/openbmb/MiniCPM-V-4.7-1B-gguf/resolve/e81247fa2eac0d99e43aeac55da199221959af15/MiniCPM-V-4_7-1B-Q4_K_M.gguf?download=true'
});

const OCR_MODEL = Object.freeze({
  id: 'ocrModel',
  label: model.labels.photoReader,
  file: 'MiniCPM-OCR-1_0-Q4_K_M.gguf',
  bytes: 529106816,
  sha256: 'c80a703400633f298cc2fddf6d493a541be36918c0801c0b1bf3f14c5703ce49',
  url: 'https://huggingface.co/openbmb/MiniCPM-OCR-1.0-gguf/resolve/0133ad8db635210441a55dcf421e25bfb9915142/MiniCPM-OCR-1_0-Q4_K_M.gguf?download=true'
});

const OCR_PROJECTOR = Object.freeze({
  id: 'ocrProjector',
  label: model.labels.photoReaderSupport,
  file: 'mmproj-model-f16-4x.gguf',
  bytes: 901017536,
  sha256: 'ceed82261b3b1380c3165f8b37c10117a50093be1362cbfeeb692fa036444682',
  url: 'https://huggingface.co/openbmb/MiniCPM-OCR-1.0-gguf/resolve/0133ad8db635210441a55dcf421e25bfb9915142/mmproj-model-f16-4x.gguf?download=true'
});

const DOWNLOADABLE_MODELS = Object.freeze([COMPANION_MODEL, OCR_MODEL, OCR_PROJECTOR]);
const MODEL_BY_ID = Object.freeze(
  Object.fromEntries(DOWNLOADABLE_MODELS.map((model) => [model.id, model]))
);

module.exports = {
  COMPANION_MODEL,
  OCR_MODEL,
  OCR_PROJECTOR,
  DOWNLOADABLE_MODELS,
  MODEL_BY_ID
};
