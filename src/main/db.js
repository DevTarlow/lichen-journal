'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const archiver = require('archiver');

const SCHEMA_VERSION = 3;
const MAX_TITLE_LENGTH = 300;
const MAX_BODY_LENGTH = 2_000_000;
const MAX_QUERY_LENGTH = 500;
const MAX_REFLECTION_LENGTH = 4000;
const MAX_REFLECTION_ANSWER_LENGTH = 20_000;
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;

class VaultError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'VaultError';
    this.code = code;
    this.details = details;
  }
}

function assertValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new VaultError('INVALID_DATE', 'A journal date must use YYYY-MM-DD.');
  }
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new VaultError('INVALID_DATE', 'That journal date is not a real calendar date.');
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new VaultError('INVALID_DATE', 'That journal date is not a real calendar date.');
  }
  return value;
}

function sanitizeTag(value) {
  if (typeof value !== 'string') return '';
  const tag = value
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return Array.from(tag).slice(0, 32).join('').replace(/-+$/g, '');
}

function sanitizeTags(values, limit = 8) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const tags = [];
  for (const value of values) {
    const tag = sanitizeTag(value);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= limit) break;
  }
  return tags;
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function normalizePalette(value) {
  if (!value || typeof value !== 'object') {
    throw new VaultError('INVALID_PALETTE', 'A mood palette must be an object.');
  }
  const colors = Array.isArray(value.hex_colors) ? value.hex_colors : [];
  if (colors.length !== 3 || !colors.every(isHexColor)) {
    throw new VaultError('INVALID_PALETTE', 'A mood palette needs exactly three hex colors.');
  }
  const vibe = typeof value.vibe_name === 'string' ? value.vibe_name.trim() : '';
  return {
    hex_colors: colors.map((color) => color.toLowerCase()),
    vibe_name: Array.from(vibe || 'quiet tone').slice(0, 48).join('')
  };
}

function countWords(text) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) return 0;
  try {
    const segmenter = new Intl.Segmenter('und', { granularity: 'word' });
    let count = 0;
    for (const part of segmenter.segment(value)) {
      if (part.isWordLike) count += 1;
    }
    return count;
  } catch {
    return value.split(/\s+/u).filter(Boolean).length;
  }
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

function filenameForEntry(entry) {
  const slug = slugify(entry.title) || 'entry';
  return `${entry.date}-${slug}.md`;
}

function yamlScalar(value) {
  return JSON.stringify(value == null ? null : String(value));
}

function markdownForEntry(entry) {
  const lines = [
    '---',
    `title: ${yamlScalar(entry.title)}`,
    `date: ${entry.date}`,
    `mood: ${entry.mood == null ? 'null' : entry.mood}`,
    `primary_emotion: ${yamlScalar(entry.primaryEmotion)}`,
    `summary: ${yamlScalar(entry.summary)}`,
    `tags: [${entry.tags.map((tag) => JSON.stringify(tag)).join(', ')}]`,
    `palette: ${entry.palette ? JSON.stringify(entry.palette) : 'null'}`,
    `word_count: ${entry.wordCount}`,
    `created_at: ${yamlScalar(entry.createdAt)}`,
    `updated_at: ${yamlScalar(entry.updatedAt)}`,
    '---',
    '',
    `# ${entry.title.trim() || entry.date}`,
    '',
    entry.body.replace(/\r\n/g, '\n').replace(/\s+$/u, ''),
    ''
  ];

  const reflections = Array.isArray(entry.reflections) ? entry.reflections : [];
  if (reflections.length > 0) {
    lines.push('## Reflections', '');
    for (const reflection of reflections) {
      const question = String(reflection.question || '')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
      lines.push(question, '', String(reflection.answer || '').replace(/\r\n/g, '\n'), '');
    }
  }

  return `${lines.join('\n')}\n`;
}

function buildFtsQuery(query) {
  const tokens = String(query || '')
    .normalize('NFKC')
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];
  const unique = [];
  const seen = new Set();
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    unique.push(token);
    if (unique.length >= 12) break;
  }
  if (unique.length === 0) return null;
  return unique.map((token) => `"${token.replace(/"/g, '""')}"*`).join(' AND ');
}

function clampLimit(value, fallback = DEFAULT_LIST_LIMIT, max = MAX_LIST_LIMIT) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(parsed)));
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, (match) => `\\${match}`);
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function safeStatSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function setPrivatePermissions(filePath, mode) {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // Permissions are best-effort; the vault still lives under the user's profile.
  }
}

const COMPANION_SOURCES = Object.freeze(['model', 'fallback']);

function normalizeAnchorList(value) {
  if (!Array.isArray(value)) return [];
  const anchors = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const anchor = Array.from(item.replace(/\s+/g, ' ').trim()).slice(0, 240).join('');
    if (!anchor || seen.has(anchor)) continue;
    seen.add(anchor);
    anchors.push(anchor);
    if (anchors.length >= 3) break;
  }
  return anchors;
}

function readCompanion(value) {
  const parsed = parseJson(value);
  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  return {
    anchors: normalizeAnchorList(record.anchors),
    metadataSource: COMPANION_SOURCES.includes(record.metadataSource) ? record.metadataSource : null,
    paletteSource: COMPANION_SOURCES.includes(record.paletteSource) ? record.paletteSource : null
  };
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  mood INTEGER CHECK (mood IS NULL OR (mood >= 1 AND mood <= 10)),
  primary_emotion TEXT,
  summary TEXT,
  palette_json TEXT,
  reflection TEXT,
  companion_json TEXT,
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, tag_id)
);

CREATE TABLE IF NOT EXISTS reflections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (entry_id, question)
);

CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date DESC);
CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  title,
  body,
  content='entries',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS entries_fts_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;

CREATE TRIGGER IF NOT EXISTS entries_fts_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
END;

CREATE TRIGGER IF NOT EXISTS entries_fts_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
  INSERT INTO entries_fts(rowid, title, body) VALUES (new.id, new.title, new.body);
END;
`;

class Vault {
  constructor({ dbPath, appVersion = '0.0.0' } = {}) {
    if (!dbPath || typeof dbPath !== 'string') {
      throw new VaultError('INVALID_PATH', 'A vault database path is required.');
    }
    this.dbPath = path.resolve(dbPath);
    this.vaultDir = path.dirname(this.dbPath);
    this.appVersion = appVersion;
    this.db = null;
  }

  get isOpen() {
    return this.db !== null;
  }

  #conn() {
    if (!this.db) {
      throw new VaultError('VAULT_CLOSED', 'The journal vault is not open.');
    }
    return this.db;
  }

  init() {
    if (this.db) return this;
    try {
      fs.mkdirSync(this.vaultDir, { recursive: true, mode: 0o700 });
      setPrivatePermissions(this.vaultDir, 0o700);
    } catch (error) {
      throw new VaultError(
        'VAULT_DIRECTORY',
        `Could not create the vault folder at ${this.vaultDir}.`,
        error.message
      );
    }

    let db;
    try {
      db = new Database(this.dbPath);
    } catch (error) {
      throw new VaultError(
        'VAULT_OPEN_FAILED',
        `Could not open the journal vault at ${this.dbPath}.`,
        error.message
      );
    }

    this.db = db;
    try {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('foreign_keys = ON');
      db.pragma('busy_timeout = 5000');
      db.pragma('secure_delete = ON');
      db.pragma('temp_store = MEMORY');

      const version = db.pragma('user_version', { simple: true });
      if (version > SCHEMA_VERSION) {
        throw new VaultError(
          'VAULT_VERSION_UNSUPPORTED',
          `This vault was created by a newer version of Lichen Journal (schema ${version}).`
        );
      }
      db.exec(SCHEMA_SQL);
      const columns = new Set(
        db.prepare('PRAGMA table_info(entries)').all().map((column) => column.name)
      );
      if (!columns.has('companion_json')) {
        db.exec('ALTER TABLE entries ADD COLUMN companion_json TEXT');
      }
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
      db.exec("INSERT INTO entries_fts(entries_fts) VALUES ('rebuild')");
      setPrivatePermissions(this.dbPath, 0o600);
      setPrivatePermissions(`${this.dbPath}-wal`, 0o600);
      setPrivatePermissions(`${this.dbPath}-shm`, 0o600);
      return this;
    } catch (error) {
      try {
        db.close();
      } catch {
        // Ignore close failures while surfacing the original init error.
      }
      this.db = null;
      if (error instanceof VaultError) throw error;
      throw new VaultError(
        'VAULT_INIT_FAILED',
        `The journal vault could not be initialized at ${this.dbPath}.`,
        error.message
      );
    }
  }

  close() {
    if (!this.db) return;
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // A checkpoint is best-effort; closing remains safe.
    }
    try {
      this.db.close();
    } catch {
      // Never throw during shutdown.
    }
    this.db = null;
  }

  #entryTagsFor(entryIds) {
    if (!entryIds.length) return new Map();
    const placeholders = entryIds.map(() => '?').join(', ');
    const rows = this.#conn()
      .prepare(
        `SELECT et.entry_id AS entryId, t.name AS name
         FROM entry_tags et
         JOIN tags t ON t.id = et.tag_id
         WHERE et.entry_id IN (${placeholders})
         ORDER BY t.name COLLATE NOCASE ASC`
      )
      .all(...entryIds);
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.entryId)) map.set(row.entryId, []);
      map.get(row.entryId).push(row.name);
    }
    return map;
  }

  #reflectionsFor(entryIds) {
    if (!entryIds.length) return new Map();
    const placeholders = entryIds.map(() => '?').join(', ');
    const rows = this.#conn()
      .prepare(
        `SELECT entry_id AS entryId, id, question, answer, created_at AS createdAt,
                updated_at AS updatedAt
         FROM reflections
         WHERE entry_id IN (${placeholders})
         ORDER BY id ASC`
      )
      .all(...entryIds);
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.entryId)) map.set(row.entryId, []);
      map.get(row.entryId).push({
        id: row.id,
        question: row.question,
        answer: row.answer,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      });
    }
    return map;
  }

  #mapEntry(row, tags = [], reflections = []) {
    const companion = readCompanion(row.companion_json);
    return {
      id: row.id,
      date: row.date,
      title: row.title,
      body: row.body,
      mood: row.mood,
      primaryEmotion: row.primary_emotion,
      summary: row.summary,
      palette: parseJson(row.palette_json),
      reflection: row.reflection,
      reflections,
      anchors: companion.anchors,
      metadataSource: companion.metadataSource,
      paletteSource: companion.paletteSource,
      wordCount: row.word_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      tags
    };
  }

  #mapSummary(row, tags = []) {
    return {
      id: row.id,
      date: row.date,
      title: row.title,
      excerpt: row.excerpt || '',
      mood: row.mood,
      primaryEmotion: row.primary_emotion,
      palette: parseJson(row.palette_json),
      wordCount: row.word_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      snippet: row.snippet || null,
      tags
    };
  }

  #hydrateSummaries(rows) {
    const tagMap = this.#entryTagsFor(rows.map((row) => row.id));
    return rows.map((row) => this.#mapSummary(row, tagMap.get(row.id) || []));
  }

  getEntry(date) {
    const safeDate = assertValidDate(date);
    const row = this.#conn()
      .prepare('SELECT * FROM entries WHERE date = ?')
      .get(safeDate);
    if (!row) return null;
    const tags = this.#entryTagsFor([row.id]).get(row.id) || [];
    const reflections = this.#reflectionsFor([row.id]).get(row.id) || [];
    return this.#mapEntry(row, tags, reflections);
  }

  listEntries({ limit = DEFAULT_LIST_LIMIT, offset = 0, from = null, to = null } = {}) {
    const safeLimit = clampLimit(limit);
    const safeOffset = Math.max(0, Math.trunc(Number(offset) || 0));
    const conditions = [];
    const params = [];
    if (from) {
      conditions.push('date >= ?');
      params.push(assertValidDate(from));
    }
    if (to) {
      conditions.push('date <= ?');
      params.push(assertValidDate(to));
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.#conn()
      .prepare(
        `SELECT id, date, title, substr(body, 1, 240) AS excerpt, mood, primary_emotion,
                palette_json, word_count, created_at, updated_at
         FROM entries
         ${where}
         ORDER BY date DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, safeLimit, safeOffset);
    return this.#hydrateSummaries(rows);
  }

  getEntriesRange(from, to) {
    const safeFrom = assertValidDate(from);
    const safeTo = assertValidDate(to);
    if (safeFrom > safeTo) {
      throw new VaultError('INVALID_RANGE', 'The start date must be before the end date.');
    }
    const rows = this.#conn()
      .prepare(
        `SELECT id, date, title, substr(body, 1, 240) AS excerpt, mood, primary_emotion,
                palette_json, word_count, created_at, updated_at
         FROM entries
         WHERE date >= ? AND date <= ?
         ORDER BY date ASC
         LIMIT 1000`
      )
      .all(safeFrom, safeTo);
    return this.#hydrateSummaries(rows);
  }

  #tagConditions(tags) {
    const clauses = [];
    const params = [];
    for (const tag of tags) {
      clauses.push(
        `EXISTS (
           SELECT 1 FROM entry_tags et
           JOIN tags t ON t.id = et.tag_id
           WHERE et.entry_id = e.id AND t.name = ?
         )`
      );
      params.push(tag);
    }
    return { sql: clauses.length ? `AND ${clauses.join(' AND ')}` : '', params };
  }

  #searchRecent(limit, tags) {
    const tagFilter = this.#tagConditions(tags);
    const rows = this.#conn()
      .prepare(
        `SELECT e.id, e.date, e.title, substr(e.body, 1, 240) AS excerpt, e.mood,
                e.primary_emotion, e.palette_json, e.word_count, e.created_at, e.updated_at
         FROM entries e
         WHERE 1 = 1 ${tagFilter.sql}
         ORDER BY e.date DESC
         LIMIT ?`
      )
      .all(...tagFilter.params, limit);
    return this.#hydrateSummaries(rows);
  }

  #searchLike(query, limit, tags) {
    const tagFilter = this.#tagConditions(tags);
    const pattern = `%${escapeLike(query)}%`;
    const rows = this.#conn()
      .prepare(
        `SELECT e.id, e.date, e.title, substr(e.body, 1, 240) AS excerpt, e.mood,
                e.primary_emotion, e.palette_json, e.word_count, e.created_at, e.updated_at
         FROM entries e
         WHERE (e.title LIKE ? ESCAPE '\\' OR e.body LIKE ? ESCAPE '\\')
         ${tagFilter.sql}
         ORDER BY e.date DESC
         LIMIT ?`
      )
      .all(pattern, pattern, ...tagFilter.params, limit);
    return this.#hydrateSummaries(rows);
  }

  searchEntries({ query = '', tags = [], limit = 100 } = {}) {
    const safeLimit = clampLimit(limit, 100, MAX_LIST_LIMIT);
    const safeTags = sanitizeTags(tags, 20);
    const trimmed = String(query || '').trim().slice(0, MAX_QUERY_LENGTH);

    if (!trimmed) {
      return { entries: this.#searchRecent(safeLimit, safeTags), mode: 'recent' };
    }

    const match = buildFtsQuery(trimmed);
    if (!match || trimmed.length < 2) {
      return { entries: this.#searchLike(trimmed, safeLimit, safeTags), mode: 'like' };
    }

    const tagFilter = this.#tagConditions(safeTags);
    try {
      const rows = this.#conn()
        .prepare(
          `SELECT e.id, e.date, e.title, substr(e.body, 1, 240) AS excerpt, e.mood,
                  e.primary_emotion, e.palette_json, e.word_count, e.created_at, e.updated_at,
                  snippet(entries_fts, -1, char(1), char(2), '…', 18) AS snippet
           FROM entries_fts
           JOIN entries e ON e.id = entries_fts.rowid
           WHERE entries_fts MATCH ? ${tagFilter.sql}
           ORDER BY bm25(entries_fts), e.date DESC
           LIMIT ?`
        )
        .all(match, ...tagFilter.params, safeLimit);
      return { entries: this.#hydrateSummaries(rows), mode: 'fts' };
    } catch {
      return { entries: this.#searchLike(trimmed, safeLimit, safeTags), mode: 'like' };
    }
  }

  getTags() {
    return this.#conn()
      .prepare(
        `SELECT t.name AS name, COUNT(et.entry_id) AS count
         FROM tags t
         JOIN entry_tags et ON et.tag_id = t.id
         GROUP BY t.id
         ORDER BY count DESC, name COLLATE NOCASE ASC
         LIMIT 100`
      )
      .all()
      .map((row) => ({ name: row.name, count: row.count }));
  }

  saveEntry({ date, title = '', body = '' } = {}) {
    const safeDate = assertValidDate(date);
    const safeTitle = typeof title === 'string' ? Array.from(title).slice(0, MAX_TITLE_LENGTH).join('') : '';
    if (typeof body !== 'string') {
      throw new VaultError('INVALID_BODY', 'Entry text must be a string.');
    }
    if (body.length > MAX_BODY_LENGTH) {
      throw new VaultError('ENTRY_TOO_LARGE', 'This entry is too large to save (over 2 million characters).');
    }

    const db = this.#conn();
    const words = countWords(body);
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT id FROM entries WHERE date = ?').get(safeDate);

    if (!existing && !safeTitle.trim() && !body.trim()) {
      return { entry: null, skipped: true };
    }

    db.transaction(() => {
      if (existing) {
        db.prepare(
          'UPDATE entries SET title = ?, body = ?, word_count = ?, updated_at = ? WHERE id = ?'
        ).run(safeTitle, body, words, now, existing.id);
      } else {
        db.prepare(
          `INSERT INTO entries (date, title, body, word_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(safeDate, safeTitle, body, words, now, now);
      }
    })();

    return { entry: this.getEntry(safeDate), skipped: false };
  }

  deleteEntry(date) {
    const safeDate = assertValidDate(date);
    const db = this.#conn();
    const existing = db.prepare('SELECT id FROM entries WHERE date = ?').get(safeDate);
    if (!existing) throw new VaultError('ENTRY_NOT_FOUND', 'There is no entry for that date yet.');

    db.transaction(() => {
      db.prepare('DELETE FROM entries WHERE id = ?').run(existing.id);
      db.prepare(
        'DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM entry_tags)'
      ).run();
    })();

    return { deleted: true, date: safeDate };
  }

  setMood(date, mood) {
    const safeDate = assertValidDate(date);
    const safeMood = mood == null ? null : Number(mood);
    if (safeMood !== null && (!Number.isInteger(safeMood) || safeMood < 1 || safeMood > 10)) {
      throw new VaultError('INVALID_MOOD', 'Mood must be a whole number from 1 to 10.');
    }
    const db = this.#conn();
    const existing = db.prepare('SELECT id FROM entries WHERE date = ?').get(safeDate);
    if (!existing) throw new VaultError('ENTRY_NOT_FOUND', 'There is no entry for that date yet.');
    db.prepare('UPDATE entries SET mood = ?, updated_at = ? WHERE id = ?').run(
      safeMood,
      new Date().toISOString(),
      existing.id
    );
    return this.getEntry(safeDate);
  }

  applyMetadata(date, metadata = {}) {
    const safeDate = assertValidDate(date);
    const db = this.#conn();
    const existing = db
      .prepare('SELECT id, companion_json FROM entries WHERE date = ?')
      .get(safeDate);
    if (!existing) throw new VaultError('ENTRY_NOT_FOUND', 'There is no entry for that date yet.');

    const previousCompanion = readCompanion(existing.companion_json);
    const summary = typeof metadata.summary === 'string'
      ? Array.from(metadata.summary.trim()).slice(0, 600).join('')
      : null;
    const emotion = typeof metadata.primary_emotion === 'string'
      ? Array.from(metadata.primary_emotion.trim().toLowerCase()).slice(0, 60).join('')
      : null;
    let mood = metadata.mood == null ? null : Number(metadata.mood);
    if (mood !== null && (!Number.isFinite(mood) || mood < 1 || mood > 10)) mood = null;
    if (mood !== null) mood = Math.round(mood);
    const tags = sanitizeTags(metadata.tags, 8);
    const anchors = Array.isArray(metadata.anchors)
      ? normalizeAnchorList(metadata.anchors)
      : previousCompanion.anchors;
    const metadataSource = COMPANION_SOURCES.includes(metadata.source)
      ? metadata.source
      : previousCompanion.metadataSource;
    const companion = JSON.stringify({ ...previousCompanion, anchors, metadataSource });
    const now = new Date().toISOString();

    db.transaction(() => {
      db.prepare(
        `UPDATE entries
         SET summary = ?, mood = ?, primary_emotion = ?, companion_json = ?, updated_at = ?
         WHERE id = ?`
      ).run(summary, mood, emotion, companion, now, existing.id);

      db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(existing.id);
      const upsertTag = db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
      const findTag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE');
      const linkTag = db.prepare(
        'INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)'
      );
      for (const tag of tags) {
        upsertTag.run(tag);
        const tagRow = findTag.get(tag);
        if (tagRow) linkTag.run(existing.id, tagRow.id);
      }
      db.prepare(
        'DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM entry_tags)'
      ).run();
    })();

    return this.getEntry(safeDate);
  }

  applyPalette(date, palette) {
    const safeDate = assertValidDate(date);
    const safePalette = normalizePalette(palette);
    const db = this.#conn();
    const existing = db
      .prepare('SELECT id, companion_json FROM entries WHERE date = ?')
      .get(safeDate);
    if (!existing) throw new VaultError('ENTRY_NOT_FOUND', 'There is no entry for that date yet.');
    const previousCompanion = readCompanion(existing.companion_json);
    const paletteSource = palette && palette.fallback === true
      ? 'fallback'
      : palette && palette.fallback === false
        ? 'model'
        : previousCompanion.paletteSource;
    db.prepare(
      'UPDATE entries SET palette_json = ?, companion_json = ?, updated_at = ? WHERE id = ?'
    ).run(
      JSON.stringify(safePalette),
      JSON.stringify({ ...previousCompanion, paletteSource }),
      new Date().toISOString(),
      existing.id
    );
    return this.getEntry(safeDate);
  }

  saveReflection(date, reflection) {
    const safeDate = assertValidDate(date);
    const safeReflection = typeof reflection === 'string'
      ? Array.from(reflection.trim()).slice(0, MAX_REFLECTION_LENGTH).join('')
      : '';
    if (!safeReflection) {
      throw new VaultError('INVALID_REFLECTION', 'A reflection cannot be empty.');
    }
    const db = this.#conn();
    const existing = db.prepare('SELECT id FROM entries WHERE date = ?').get(safeDate);
    if (!existing) throw new VaultError('ENTRY_NOT_FOUND', 'There is no entry for that date yet.');
    db.prepare('UPDATE entries SET reflection = ?, updated_at = ? WHERE id = ?').run(
      safeReflection,
      new Date().toISOString(),
      existing.id
    );
    return this.getEntry(safeDate);
  }

  saveReflectionAnswer(date, question, answer) {
    const safeDate = assertValidDate(date);
    const safeQuestion = typeof question === 'string'
      ? Array.from(question.trim()).slice(0, MAX_REFLECTION_LENGTH).join('')
      : '';
    if (!safeQuestion) {
      throw new VaultError('INVALID_REFLECTION', 'A reflection question cannot be empty.');
    }
    const safeAnswer = typeof answer === 'string'
      ? Array.from(answer.trim()).slice(0, MAX_REFLECTION_ANSWER_LENGTH).join('')
      : '';
    if (!safeAnswer) {
      throw new VaultError('INVALID_REFLECTION_ANSWER', 'A reflection answer cannot be empty.');
    }

    const db = this.#conn();
    const existing = db.prepare('SELECT id FROM entries WHERE date = ?').get(safeDate);
    if (!existing) throw new VaultError('ENTRY_NOT_FOUND', 'There is no entry for that date yet.');
    const now = new Date().toISOString();

    db.transaction(() => {
      db.prepare(
        `INSERT INTO reflections (entry_id, question, answer, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(entry_id, question) DO UPDATE SET
           answer = excluded.answer,
           updated_at = excluded.updated_at`
      ).run(existing.id, safeQuestion, safeAnswer, now, now);
      db.prepare('UPDATE entries SET updated_at = ? WHERE id = ?').run(now, existing.id);
    })();

    return this.getEntry(safeDate);
  }

  getPreviousReflection(date) {
    const safeDate = assertValidDate(date);
    const row = this.#conn()
      .prepare(
        `SELECT date, reflection
         FROM entries
         WHERE date < ? AND reflection IS NOT NULL AND TRIM(reflection) <> ''
         ORDER BY date DESC
         LIMIT 1`
      )
      .get(safeDate);
    if (!row) return null;
    return { date: row.date, reflection: row.reflection };
  }

  getStats() {
    const row = this.#conn()
      .prepare(
        `SELECT COUNT(*) AS entryCount,
                COALESCE(SUM(word_count), 0) AS wordCount,
                MIN(date) AS firstDate,
                MAX(date) AS lastDate
         FROM entries`
      )
      .get();
    const tagCount = this.#conn().prepare('SELECT COUNT(*) AS count FROM tags').get().count;
    const dbBytes = safeStatSize(this.dbPath);
    const walBytes = safeStatSize(`${this.dbPath}-wal`);
    return {
      entryCount: row.entryCount,
      wordCount: row.wordCount,
      tagCount,
      firstDate: row.firstDate || null,
      lastDate: row.lastDate || null,
      dbBytes,
      walBytes,
      vaultBytes: dbBytes + walBytes,
      schemaVersion: this.#conn().pragma('user_version', { simple: true })
    };
  }

  getInfo() {
    return {
      dbPath: this.dbPath,
      vaultDir: this.vaultDir,
      dbExists: fs.existsSync(this.dbPath),
      stats: this.getStats()
    };
  }

  #allFullEntries() {
    const rows = this.#conn().prepare('SELECT * FROM entries ORDER BY date ASC').all();
    const tagMap = this.#entryTagsFor(rows.map((row) => row.id));
    const reflectionMap = this.#reflectionsFor(rows.map((row) => row.id));
    return rows.map((row) =>
      this.#mapEntry(row, tagMap.get(row.id) || [], reflectionMap.get(row.id) || [])
    );
  }

  async exportToZip(destinationPath) {
    if (!destinationPath || typeof destinationPath !== 'string') {
      throw new VaultError('INVALID_EXPORT_PATH', 'A destination path is required for export.');
    }
    const dest = path.resolve(destinationPath);
    const entries = this.#allFullEntries();
    const tags = this.getTags();
    const stats = this.getStats();
    const exportedAt = new Date().toISOString();

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const metadata = {
      format: 'lichen-journal-vault',
      formatVersion: 1,
      appVersion: this.appVersion,
      exportedAt,
      stats,
      tags,
      entries
    };
    const readme = [
      'Lichen Journal vault export',
      '===========================',
      '',
      `Exported: ${exportedAt}`,
      `Entries: ${entries.length}`,
      `Words: ${stats.wordCount}`,
      '',
      'Each files in entries/ is a plain Markdown journal entry with YAML frontmatter.',
      'metadata.json contains the complete machine-readable vault, including tags,',
      'summaries, reflection answers, and mood palettes.',
      '',
      'This archive was created locally by Lichen Journal. It never left your machine.',
      ''
    ].join('\n');

    return new Promise((resolve, reject) => {
      let settled = false;
      const output = fs.createWriteStream(dest);
      const archive = archiver('zip', { zlib: { level: 6 } });

      const fail = (error) => {
        if (settled) return;
        settled = true;
        try {
          archive.abort();
        } catch {
          // Ignore abort failures.
        }
        output.destroy();
        try {
          fs.rmSync(dest, { force: true });
        } catch {
          // Ignore cleanup failures.
        }
        reject(
          error instanceof VaultError
            ? error
            : new VaultError('EXPORT_FAILED', 'The vault export could not be created.', error.message)
        );
      };

      output.on('close', () => {
        if (settled) return;
        settled = true;
        resolve({
          filePath: dest,
          entryCount: entries.length,
          bytes: archive.pointer()
        });
      });
      output.on('error', fail);
      archive.on('warning', (error) => {
        if (error.code !== 'ENOENT') fail(error);
      });
      archive.on('error', fail);

      archive.pipe(output);
      archive.append(readme, { name: 'README.txt' });
      archive.append(`${JSON.stringify(metadata, null, 2)}\n`, { name: 'metadata.json' });
      for (const entry of entries) {
        archive.append(markdownForEntry(entry), { name: `entries/${filenameForEntry(entry)}` });
      }
      archive.finalize().catch(fail);
    });
  }

  purge({ confirm } = {}) {
    if (confirm !== 'PURGE') {
      throw new VaultError(
        'CONFIRMATION_REQUIRED',
        'Type PURGE to confirm clearing the entire vault.'
      );
    }
    const db = this.#conn();
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.transaction(() => {
        db.exec(`
          DROP TRIGGER IF EXISTS entries_fts_ai;
          DROP TRIGGER IF EXISTS entries_fts_ad;
          DROP TRIGGER IF EXISTS entries_fts_au;
          DROP TABLE IF EXISTS entries_fts;
          DROP TABLE IF EXISTS reflections;
          DROP TABLE IF EXISTS entry_tags;
          DROP TABLE IF EXISTS tags;
          DROP TABLE IF EXISTS entries;
        `);
        db.pragma('user_version = 0');
      })();
    } catch (error) {
      throw new VaultError(
        'PURGE_FAILED',
        'The vault tables could not be cleared. Your existing data was left in place.',
        error.message
      );
    }

    this.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const target = `${this.dbPath}${suffix}`;
      try {
        fs.rmSync(target, { force: true });
      } catch (error) {
        try {
          this.init();
        } catch {
          // Surface the unlink failure below.
        }
        throw new VaultError(
          'PURGE_FAILED',
          `Could not remove the vault file at ${target}.`,
          error.message
        );
      }
    }

    try {
      this.init();
    } catch (error) {
      throw new VaultError(
        'PURGE_REINIT_FAILED',
        'The vault was cleared but a fresh vault could not be created.',
        error.message
      );
    }
    return { purged: true, stats: this.getStats() };
  }

  getAllEntriesForExport() {
    return this.#allFullEntries();
  }
}

module.exports = {
  Vault,
  VaultError,
  SCHEMA_VERSION,
  assertValidDate,
  sanitizeTag,
  sanitizeTags,
  normalizePalette,
  isHexColor,
  countWords,
  slugify,
  filenameForEntry,
  markdownForEntry,
  buildFtsQuery
};
