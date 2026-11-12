import { describe, expect, it } from 'vitest';
import { model, companion, photoReader } from '../src/main/copy.js';
import { COMPANION_MODEL, OCR_MODEL, OCR_PROJECTOR } from '../src/main/model-catalog.js';

// Product-internal words that should never reach a writer through the
// interface. Model names and file paths stay in the catalog and the logs.
const TECHNICAL_TERMS = /GGUF|hugging ?face|OCR|weights|sha-?256|checksum|tensor|llama/i;

function collectStrings(value, found = []) {
  if (typeof value === 'string') {
    found.push(value);
  } else if (typeof value === 'function') {
    found.push(value(500));
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, found);
  }
  return found;
}

describe('user-facing copy', () => {
  it('uses plain language in model and photo-reader messages', () => {
    const strings = [
      ...collectStrings(model),
      ...collectStrings(companion),
      ...collectStrings(photoReader)
    ];
    expect(strings.length).toBeGreaterThan(10);
    for (const text of strings) {
      expect(text).not.toMatch(TECHNICAL_TERMS);
      expect(text.trim()).not.toBe('');
    }
  });

  it('keeps the model labels in one place', () => {
    expect(COMPANION_MODEL.label).toBe(model.labels.companion);
    expect(OCR_MODEL.label).toBe(model.labels.photoReader);
    expect(OCR_PROJECTOR.label).toBe(model.labels.photoReaderSupport);
  });
});
