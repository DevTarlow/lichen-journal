import { DEFAULT_REFLECT_LENS, normalizeLens } from './lenses.js';

export const THEME_PALETTES = Object.freeze([
  {
    id: 'lichen',
    name: 'Lichen',
    hint: 'Moss and warm parchment',
    swatches: ['#7c9172', '#b0825a', '#f1ebdc'],
    darkSwatches: ['#9db28f', '#c79b70', '#17201a']
  },
  {
    id: 'river',
    name: 'River',
    hint: 'Cool stone and quiet teal',
    swatches: ['#6d8f9b', '#b07e5b', '#e9edee'],
    darkSwatches: ['#8fb6c2', '#c99c74', '#131d22']
  },
  {
    id: 'heather',
    name: 'Heather',
    hint: 'Soft lilac and dusk',
    swatches: ['#8b7299', '#b08062', '#efeaf0'],
    darkSwatches: ['#b49bc3', '#c99c74', '#1d1722']
  },
  {
    id: 'ember',
    name: 'Ember',
    hint: 'Sand, clay, and lamplight',
    swatches: ['#a8794f', '#a85f45', '#f3e8d8'],
    darkSwatches: ['#c49a6c', '#cf8a68', '#211913']
  }
]);

export const PREFERENCE_STORAGE_KEY = 'lichen.preferences';

export const DEFAULT_PREFERENCES = Object.freeze({
  palette: 'lichen',
  pageTurn: true,
  reduceMotion: false,
  reflectLens: DEFAULT_REFLECT_LENS
});

const PALETTE_IDS = new Set(THEME_PALETTES.map((palette) => palette.id));

export function sanitizePreferences(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    palette: PALETTE_IDS.has(source.palette) ? source.palette : DEFAULT_PREFERENCES.palette,
    pageTurn: source.pageTurn !== false,
    reduceMotion: source.reduceMotion === true,
    reflectLens: normalizeLens(source.reflectLens)
  };
}

export function readPreferences() {
  try {
    const raw = window.localStorage.getItem(PREFERENCE_STORAGE_KEY);
    return sanitizePreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function applyPreferencesToDocument(preferences) {
  const root = document.documentElement;
  root.dataset.palette = preferences.palette;
  if (preferences.reduceMotion) {
    root.dataset.reduceMotion = 'true';
  } else {
    delete root.dataset.reduceMotion;
  }
}
