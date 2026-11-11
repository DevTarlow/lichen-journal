export function countWords(text) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) return 0;
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    let count = 0;
    for (const part of segmenter.segment(value)) {
      if (part.isWordLike) count += 1;
    }
    return count;
  } catch {
    return value.split(/\s+/u).filter(Boolean).length;
  }
}

export function sanitizeCompanionText(text) {
  if (typeof text !== 'string' || !text) return '';
  return text
    .replace(/<\|[^|>\n]{1,64}\|>/g, ' ')
    .replace(/<\/?[A-Za-z][\w:.-]*(?:\s[^<>\n]*)?\/?>/g, ' ')
    .replace(/\[\/?(?:query|question|answer|entry|reflection|inst|sys)\]/gi, ' ')
    .replace(/\[(?:Start|End)\s+thinking\]/gi, ' ')
    .replace(/<<\/?SYS>>/gi, ' ')
    .replace(/\r/g, '')
    // Hide an unfinished tag at the end so streaming never flashes half a tag.
    .replace(/<\|[^|>\n]*$/, '')
    .replace(/<\/?[A-Za-z][\w:.-]*(?:\s[^<>\n]*)?$/, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function entryTitle(entry) {
  if (!entry) return 'Untitled reflection';
  const title = typeof entry.title === 'string' ? entry.title.trim() : '';
  if (title) return title;
  const body = typeof entry.body === 'string' ? entry.body : entry.excerpt || '';
  const firstLine = body.split(/\r?\n/).find((line) => line.trim());
  if (firstLine) return firstLine.trim().slice(0, 80);
  return 'Untitled reflection';
}

export function excerpt(text, length = 120) {
  const cleaned = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= length) return cleaned;
  return `${cleaned.slice(0, length).trimEnd()}…`;
}

export function snippetParts(snippet) {
  if (!snippet) return [];
  const parts = [];
  let buffer = '';
  let highlighted = false;

  const push = () => {
    if (!buffer) return;
    parts.push({ text: buffer, highlighted });
    buffer = '';
  };

  for (const character of snippet) {
    if (character === '\u0001') {
      push();
      highlighted = true;
    } else if (character === '\u0002') {
      push();
      highlighted = false;
    } else {
      buffer += character;
    }
  }
  push();
  return parts;
}

export function mergePageText(existingBody, addition) {
  const base = String(existingBody || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+$/u, '');
  const next = String(addition || '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!next) return base;
  if (!base) return next;
  return `${base}\n\n${next}`;
}
