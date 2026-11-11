const FALLBACKS = [
  { hex_colors: ['#4b5563', '#7c8794', '#d8d3c8'], vibe_name: 'still slate' },
  { hex_colors: ['#5b6670', '#8c949b', '#d9d5cc'], vibe_name: 'quiet fog' },
  { hex_colors: ['#7a6f63', '#a89a8a', '#e4d8c6'], vibe_name: 'warm clay' },
  { hex_colors: ['#6f7d68', '#a3ad95', '#e3ddce'], vibe_name: 'soft lichen' },
  { hex_colors: ['#4f6b52', '#9db28f', '#e7e2d3'], vibe_name: 'quiet moss' },
  { hex_colors: ['#4d7a6a', '#8ab5a2', '#eadfc9'], vibe_name: 'green spring' },
  { hex_colors: ['#7b8f5a', '#b8c48a', '#f0e6c8'], vibe_name: 'sunlit sage' },
  { hex_colors: ['#a5814f', '#d0b07d', '#f3e6c4'], vibe_name: 'golden hour' },
  { hex_colors: ['#a56a4f', '#d99a76', '#f3d8bd'], vibe_name: 'amber ember' },
  { hex_colors: ['#8a5a6b', '#bd8f9c', '#edd9d2'], vibe_name: 'rose dusk' }
];

export const MOOD_LABELS = [
  'very heavy',
  'heavy',
  'low',
  'tender',
  'steady',
  'open',
  'bright',
  'warm',
  'light',
  'radiant'
];

export function isHex(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function hashText(text) {
  let hash = 0;
  const value = String(text || '');
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function fallbackPalette(entry) {
  const mood = Number(entry && entry.mood);
  const index =
    Number.isInteger(mood) && mood >= 1 && mood <= 10
      ? mood - 1
      : hashText(`${entry && entry.date}:${entry && entry.title}`) % FALLBACKS.length;
  return FALLBACKS[index];
}

export function paletteForEntry(entry) {
  if (!entry) return null;
  const palette = entry.palette;
  if (
    palette &&
    Array.isArray(palette.hex_colors) &&
    palette.hex_colors.length === 3 &&
    palette.hex_colors.every(isHex)
  ) {
    return {
      hex_colors: palette.hex_colors,
      vibe_name: palette.vibe_name || 'quiet tone'
    };
  }
  if (entry.mood || entry.date) return fallbackPalette(entry);
  return null;
}

export function hexToRgba(hex, alpha = 1) {
  if (!isHex(hex)) return `rgba(124, 145, 114, ${alpha})`;
  const normalized = hex.slice(1);
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function moodLabel(mood) {
  const numeric = Number(mood);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 10) return 'unnamed';
  return MOOD_LABELS[numeric - 1];
}

export function ambientColors(entry, override) {
  if (override && isHex(override)) {
    const palette = paletteForEntry(entry) || fallbackPalette(entry || {});
    return [override, ...palette.hex_colors.filter((color) => color !== override)].slice(0, 3);
  }
  const palette = paletteForEntry(entry);
  return palette ? palette.hex_colors : FALLBACKS[4].hex_colors;
}
