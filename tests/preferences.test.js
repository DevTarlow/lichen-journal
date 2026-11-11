import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PREFERENCES,
  THEME_PALETTES,
  sanitizePreferences
} from '../src/renderer/src/lib/preferences.js';

describe('preferences', () => {
  it('falls back to the lichen palette for missing or unknown values', () => {
    expect(sanitizePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(sanitizePreferences({ palette: 'neon' }).palette).toBe('lichen');
    expect(sanitizePreferences({ palette: 'river' }).palette).toBe('river');
  });

  it('keeps the page-turn on unless it was explicitly turned off', () => {
    expect(sanitizePreferences({}).pageTurn).toBe(true);
    expect(sanitizePreferences({ pageTurn: 'no' }).pageTurn).toBe(true);
    expect(sanitizePreferences({ pageTurn: false }).pageTurn).toBe(false);
  });

  it('only enables reduced motion for an explicit true', () => {
    expect(sanitizePreferences({}).reduceMotion).toBe(false);
    expect(sanitizePreferences({ reduceMotion: 'yes' }).reduceMotion).toBe(false);
    expect(sanitizePreferences({ reduceMotion: true }).reduceMotion).toBe(true);
  });

  it('remembers a known reflection angle and ignores unknown ones', () => {
    expect(sanitizePreferences({}).reflectLens).toBe('gentle');
    expect(sanitizePreferences({ reflectLens: 'body' }).reflectLens).toBe('body');
    expect(sanitizePreferences({ reflectLens: 'therapy' }).reflectLens).toBe('gentle');
  });

  it('offers four distinct palettes with preview swatches', () => {
    expect(THEME_PALETTES.map((palette) => palette.id)).toEqual([
      'lichen',
      'river',
      'heather',
      'ember'
    ]);
    for (const palette of THEME_PALETTES) {
      expect(palette.name).toBeTruthy();
      expect(palette.hint).toBeTruthy();
      expect(palette.swatches).toHaveLength(3);
      expect(palette.darkSwatches).toHaveLength(3);
    }
  });
});
