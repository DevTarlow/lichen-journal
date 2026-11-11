'use strict';

const { sanitizeTags, isHexColor, normalizePalette } = require('./db');

const MAX_AI_INPUT_CHARS = 6000;
const FALLBACK_QUESTION = 'What part of this feels most important to stay with for a moment?';

function stripModelTags(value) {
  return String(value || '')
    .replace(/<\|[^|>\n]{1,64}\|>/g, ' ')
    .replace(/<\/?[A-Za-z][\w:.-]*(?:\s[^<>\n]*)?\/?>/g, ' ')
    .replace(/\[\/?(?:query|question|answer|entry|reflection|inst|sys)\]/gi, ' ')
    .replace(/<<\/?SYS>>/gi, ' ');
}

const CURATED_PALETTES = Object.freeze([
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
]);

function truncateForModel(text, maxChars = MAX_AI_INPUT_CHARS) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (value.length <= maxChars) return value;
  const cut = value.slice(0, maxChars);
  const lastSpace = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return `${lastSpace > maxChars * 0.7 ? cut.slice(0, lastSpace) : cut}. [entry continues]`;
}

function parseJsonObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const FIELD_TAG_NAMES = new Set([
  'summary',
  'tags',
  'mood',
  'emotion',
  'primary-emotion',
  'primary_emotion',
  'anchors',
  'hex-colors',
  'hex_colors',
  'vibe-name',
  'vibe_name',
  'json'
]);

function trimFieldValue(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/^[\s"'[\],;]+/, '')
    .replace(/[\s"'\],;]+$/, '');
}

function fieldString(raw, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`"${escaped}"\\s*:\\s*"([^"]*)"`, 'i'),
    new RegExp(`"${escaped}"\\s*:\\s*'([^']*)'`, 'i'),
    new RegExp(`"${escaped}"\\s*:\\s*([^,}\\n]+)`, 'i'),
    new RegExp(`\\b${escaped}\\b\\s*[:=]\\s*"([^"]*)"`, 'i'),
    new RegExp(`\\b${escaped}\\b\\s*[:=]\\s*([^,}\\n]+)`, 'i')
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) return trimFieldValue(match[1]);
  }
  return '';
}

function looseTags(raw) {
  const arrayMatch = raw.match(/"tags"\s*:\s*\[([^\]]*)\]/i);
  const stringMatch =
    raw.match(/"tags"\s*:\s*"([^"]*)"/i) ||
    raw.match(/\btags\b\s*[:=]\s*([^\n}]+)/i);
  const source = arrayMatch ? arrayMatch[1] : stringMatch ? stringMatch[1] : '';
  if (!source) return [];
  return source
    .split(/[,;|]/)
    .map(trimFieldValue)
    .filter((tag) => {
      if (!tag) return false;
      const normalized = tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      return !FIELD_TAG_NAMES.has(normalized);
    });
}

function looseAnchors(raw) {
  const marker = raw.search(/\banchors\b/i);
  if (marker === -1) return [];
  let segment = raw.slice(marker);
  segment = segment.split(/[}\n]/)[0];
  segment = segment.split(/"mood"|"primary_emotion"|"primary emotion"/i)[0];
  const numbers = segment.match(/\d{1,3}/g) || [];
  return numbers.map((value) => Number.parseInt(value, 10)).filter(Number.isInteger);
}

function normalizeQuoteCharacters(value) {
  return String(value || '')
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’]/g, "'");
}

function extractLooseFields(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  const text = normalizeQuoteCharacters(raw);
  return {
    summary: fieldString(text, 'summary'),
    tags: looseTags(text),
    mood: fieldString(text, 'mood'),
    primary_emotion:
      fieldString(text, 'primary_emotion') || fieldString(text, 'emotion'),
    anchors: looseAnchors(text),
    vibe_name: fieldString(text, 'vibe_name')
  };
}

function normalizeTagInput(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value
      .split(/[,;|]/)
      .map(trimFieldValue)
      .filter(Boolean);
  }
  return [];
}

function extractHexColors(raw, parsed) {
  const colors = [];
  const seen = new Set();
  const add = (value) => {
    if (typeof value !== 'string') return;
    const color = value.trim().toLowerCase();
    if (!isHexColor(color) || seen.has(color)) return;
    seen.add(color);
    colors.push(color);
  };
  if (parsed && Array.isArray(parsed.hex_colors)) {
    for (const value of parsed.hex_colors) add(value);
  }
  if (typeof raw === 'string') {
    for (const value of raw.match(/#[0-9a-f]{6}/gi) || []) add(value);
  }
  return colors.slice(0, 3);
}

function cleanReflection(raw) {
  let text = typeof raw === 'string' ? raw : '';
  text = stripModelTags(
    text
      .replace(/\[(?:Start|End)\s+thinking\]/gi, ' ')
      .replace(/<\/?think>/gi, ' ')
      .replace(/^\s*thinking\s*[:\-–]?\s*/i, ' ')
      .replace(/```[\w-]*\n?/g, '')
      .replace(/```/g, '')
      .replace(/\r/g, '')
  )
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  if (!text) return FALLBACK_QUESTION;

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  text = lines.find((line) => line.includes('?')) || lines[0] || text;

  text = text
    .replace(/^(?:companion|assistant|question|query|answer|reflection|user|system)\s*:\s*/i, '')
    .replace(/^["'“”‘’]+/, '')
    .replace(/["'“”‘’]+$/, '')
    .trim();

  const questionIndex = text.indexOf('?');
  if (questionIndex !== -1) {
    text = text.slice(0, questionIndex + 1);
  } else {
    const sentence = text.match(/^[^.!?]+[.!]?/);
    text = sentence ? sentence[0].trim() : text;
    text = text.replace(/[.!]+$/, '').trim();
    if (text) text = `${text}?`;
  }

  if (!text || text === '?') return FALLBACK_QUESTION;
  return Array.from(text).slice(0, 320).join('');
}

function fallbackSummary(text) {
  const cleaned = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'A private journal entry.';
  const sentence = cleaned.match(/^.{0,200}?[.!?](?:\s|$)/);
  const summary = (sentence ? sentence[0] : cleaned).trim();
  return Array.from(summary).slice(0, 200).join('');
}

function clampMood(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(1, Math.min(10, Math.round(numeric)));
}

function cleanEmotion(value) {
  if (typeof value !== 'string') return 'reflective';
  const emotion = value
    .toLowerCase()
    .replace(/[^\p{L}\s-]+/gu, '')
    .trim()
    .split(/\s+/)[0];
  return Array.from(emotion || 'reflective').slice(0, 40).join('');
}

function pickAnchors(value, sentences) {
  if (!Array.isArray(value) || !Array.isArray(sentences) || sentences.length === 0) return [];
  const anchors = [];
  const seen = new Set();
  for (const candidate of value) {
    const match = String(candidate).match(/\d+/);
    const index = match ? Number.parseInt(match[0], 10) : NaN;
    if (!Number.isInteger(index) || index < 1 || index > sentences.length) continue;
    if (seen.has(index)) continue;
    const sentence = String(sentences[index - 1] || '').trim();
    if (!sentence) continue;
    seen.add(index);
    anchors.push(Array.from(sentence).slice(0, 240).join(''));
    if (anchors.length >= 3) break;
  }
  return anchors;
}

function normalizeMetadata(raw, text, sentences = []) {
  const parsed = parseJsonObject(raw) || {};
  const loose = extractLooseFields(raw);
  const summaryValue =
    (typeof parsed.summary === 'string' && parsed.summary.trim()) || loose.summary;
  const summaryFromModel = Boolean(summaryValue && String(summaryValue).trim());
  const summary = summaryFromModel
    ? Array.from(String(summaryValue).replace(/\s+/g, ' ').trim())
        .slice(0, 240)
        .join('')
    : fallbackSummary(text);
  const tags = sanitizeTags(
    normalizeTagInput(
      Array.isArray(parsed.tags) || typeof parsed.tags === 'string'
        ? parsed.tags
        : loose.tags
    ),
    6
  ).filter((tag) => !FIELD_TAG_NAMES.has(tag));
  const mood = clampMood(parsed.mood ?? loose.mood);
  const emotionValue =
    (typeof parsed.primary_emotion === 'string' && parsed.primary_emotion.trim()) ||
    loose.primary_emotion;
  const primaryEmotion = cleanEmotion(emotionValue);
  const anchorsValue = Array.isArray(parsed.anchors) ? parsed.anchors : loose.anchors;
  const fromModel =
    summaryFromModel &&
    mood !== null &&
    tags.length > 0 &&
    typeof emotionValue === 'string' &&
    Boolean(emotionValue.trim());
  return {
    summary,
    tags,
    mood,
    primary_emotion: primaryEmotion,
    anchors: fromModel ? pickAnchors(anchorsValue, sentences) : [],
    source: fromModel ? 'model' : 'fallback'
  };
}

function hashText(text) {
  let hash = 0;
  const value = String(text || '');
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function fallbackPalette(mood, text) {
  const numericMood = clampMood(mood);
  const index = numericMood
    ? numericMood - 1
    : hashText(text) % CURATED_PALETTES.length;
  const palette = CURATED_PALETTES[index] || CURATED_PALETTES[4];
  return {
    hex_colors: [...palette.hex_colors],
    vibe_name: palette.vibe_name
  };
}

function normalizePaletteResult(raw, { text = '', mood = null } = {}) {
  const parsed = parseJsonObject(raw) || {};
  const colors = extractHexColors(raw, parsed);
  if (colors.length !== 3) {
    return { ...fallbackPalette(mood, text), fallback: true };
  }
  const loose = extractLooseFields(raw);
  const rawVibe =
    (typeof parsed.vibe_name === 'string' && parsed.vibe_name.trim()) ||
    loose.vibe_name ||
    '';
  const vibe =
    rawVibe && !/[{}\[\]":]/.test(rawVibe)
      ? Array.from(rawVibe.toLowerCase()).slice(0, 48).join('')
      : fallbackPalette(mood, text).vibe_name;
  try {
    return {
      ...normalizePalette({
        hex_colors: colors,
        vibe_name: vibe
      }),
      fallback: false
    };
  } catch {
    return { ...fallbackPalette(mood, text), fallback: true };
  }
}

function formatAiError(error) {
  if (!error) return { code: 'AI_ERROR', message: 'The companion could not respond.' };
  return {
    code: typeof error.code === 'string' ? error.code : 'AI_ERROR',
    message: typeof error.message === 'string' ? error.message : 'The companion could not respond.'
  };
}

module.exports = {
  MAX_AI_INPUT_CHARS,
  FALLBACK_QUESTION,
  CURATED_PALETTES,
  truncateForModel,
  parseJsonObject,
  cleanReflection,
  stripModelTags,
  fallbackSummary,
  clampMood,
  cleanEmotion,
  normalizeMetadata,
  normalizePaletteResult,
  fallbackPalette,
  formatAiError,
  hashText
};
