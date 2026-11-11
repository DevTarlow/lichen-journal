import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  Vault,
  VaultError,
  assertValidDate,
  countWords,
  sanitizeTag,
  sanitizeTags
} from '../src/main/db.js';

let tempDir;
let vault;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-db-'));
  vault = new Vault({
    dbPath: path.join(tempDir, 'vault', 'lichen_journal.sqlite'),
    appVersion: 'test'
  });
  vault.init();
});

afterEach(() => {
  vault.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('date and tag helpers', () => {
  it('accepts real local dates and rejects impossible ones', () => {
    expect(assertValidDate('2026-11-03')).toBe('2026-11-03');
    expect(() => assertValidDate('2026-02-30')).toThrow(VaultError);
    expect(() => assertValidDate('11/03/2026')).toThrow(VaultError);
    expect(() => assertValidDate('2026-13-01')).toThrow(VaultError);
  });

  it('slugifies tags and removes duplicates', () => {
    expect(sanitizeTag('  #River Bank  ')).toBe('river-bank');
    expect(sanitizeTag('Café')).toBe('café');
    expect(sanitizeTags(['Rain', 'rain', '#rain', 'wet stones', ''])).toEqual([
      'rain',
      'wet-stones'
    ]);
  });

  it('counts words for latin and spaced text', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('Hello world')).toBe(2);
    expect(countWords('One\ntwo\tthree')).toBe(3);
  });
});

describe('vault entries', () => {
  it('creates, hydrates, and updates a daily entry', () => {
    const created = vault.saveEntry({
      date: '2026-11-03',
      title: 'River notes',
      body: 'The moss was bright after the rain.'
    });
    expect(created.skipped).toBe(false);
    expect(created.entry.title).toBe('River notes');
    expect(created.entry.wordCount).toBe(7);
    expect(created.entry.tags).toEqual([]);

    const updated = vault.saveEntry({
      date: '2026-11-03',
      title: 'River notes, again',
      body: 'The moss was bright after the rain. I stayed a while.'
    });
    expect(updated.entry.id).toBe(created.entry.id);
    expect(updated.entry.title).toBe('River notes, again');
    expect(updated.entry.wordCount).toBe(11);
  });

  it('does not create an empty entry, but can persist clearing an existing one', () => {
    const skipped = vault.saveEntry({ date: '2026-11-04', title: '  ', body: '\n' });
    expect(skipped.skipped).toBe(true);
    expect(vault.getEntry('2026-11-04')).toBeNull();

    vault.saveEntry({ date: '2026-11-04', title: 'A title', body: 'Some body.' });
    const cleared = vault.saveEntry({ date: '2026-11-04', title: '', body: '' });
    expect(cleared.entry.title).toBe('');
    expect(cleared.entry.body).toBe('');
    expect(cleared.entry.wordCount).toBe(0);
  });

  it('lists, ranges, stats, and reopens with the index intact', () => {
    vault.saveEntry({ date: '2026-11-01', title: 'One', body: 'Moss and rain.' });
    vault.saveEntry({ date: '2026-11-02', title: 'Two', body: 'A quieter day.' });
    vault.applyMetadata('2026-11-01', {
      summary: 'A mossy walk.',
      tags: ['moss', 'rain'],
      mood: 7,
      primary_emotion: 'hopeful'
    });

    expect(vault.listEntries().map((entry) => entry.date)).toEqual([
      '2026-11-02',
      '2026-11-01'
    ]);
    expect(vault.getEntriesRange('2026-11-01', '2026-11-01')).toHaveLength(1);
    expect(vault.getStats()).toMatchObject({
      entryCount: 2,
      wordCount: 6,
      tagCount: 2,
      firstDate: '2026-11-01',
      lastDate: '2026-11-02'
    });
    expect(vault.getTags()).toEqual([
      { name: 'moss', count: 1 },
      { name: 'rain', count: 1 }
    ]);

    vault.close();
    vault = new Vault({
      dbPath: path.join(tempDir, 'vault', 'lichen_journal.sqlite'),
      appVersion: 'test'
    });
    vault.init();
    expect(vault.getEntry('2026-11-01').tags).toEqual(['moss', 'rain']);
    expect(vault.searchEntries({ query: 'moss' }).entries[0].date).toBe('2026-11-01');
  });

  it('sets and validates mood, and requires an existing entry', () => {
    vault.saveEntry({ date: '2026-11-03', title: 'Mood', body: 'A few words.' });
    const updated = vault.setMood('2026-11-03', 8);
    expect(updated.mood).toBe(8);
    expect(() => vault.setMood('2026-11-03', 11)).toThrow(VaultError);
    expect(() => vault.setMood('2026-11-09', 7)).toThrow(/no entry/i);
  });
});

describe('metadata, palette, and reflections', () => {
  beforeEach(() => {
    vault.saveEntry({
      date: '2026-11-03',
      title: 'Soft day',
      body: 'I sat by the window and watched the rain. It felt tender.'
    });
  });

  it('replaces tags transactionally and removes orphan tags', () => {
    const first = vault.applyMetadata('2026-11-03', {
      summary: 'A tender rain-watching day.',
      tags: ['Rain', 'window', 'tender', 'rain'],
      mood: 6,
      primary_emotion: 'tender'
    });
    expect(first.tags).toEqual(['rain', 'tender', 'window']);
    expect(first.mood).toBe(6);
    expect(first.summary).toBe('A tender rain-watching day.');

    const second = vault.applyMetadata('2026-11-03', {
      summary: 'A tender rain-watching day.',
      tags: ['window'],
      mood: 5,
      primary_emotion: 'calm'
    });
    expect(second.tags).toEqual(['window']);
    expect(vault.getTags()).toEqual([{ name: 'window', count: 1 }]);
  });

  it('stores validated palettes and reflections', () => {
    const palette = {
      hex_colors: ['#4F6B52', '#9db28f', '#E7E2D3'],
      vibe_name: 'quiet moss'
    };
    const withPalette = vault.applyPalette('2026-11-03', palette);
    expect(withPalette.palette.hex_colors).toEqual(['#4f6b52', '#9db28f', '#e7e2d3']);
    expect(() =>
      vault.applyPalette('2026-11-03', { hex_colors: ['red', '#fff', '#000000'], vibe_name: 'x' })
    ).toThrow(VaultError);

    const withReflection = vault.saveReflection(
      '2026-11-03',
      'What did the rain make room for?'
    );
    expect(withReflection.reflection).toBe('What did the rain make room for?');
    expect(() => vault.saveReflection('2026-11-03', '   ')).toThrow(VaultError);
  });
});

describe('previous reflection', () => {
  it('returns the nearest earlier page that has a reflection', () => {
    vault.saveEntry({ date: '2026-05-01', title: 'First', body: 'First page words.' });
    vault.saveReflection('2026-05-01', 'What was the quietest part?');

    vault.saveEntry({ date: '2026-05-03', title: 'Middle', body: 'Middle page words.' });
    vault.saveReflection('2026-05-03', 'Where did the day soften?');

    vault.saveEntry({ date: '2026-05-04', title: 'Later', body: 'Later page words.' });
    vault.saveReflection('2026-05-04', 'What is still open?');

    expect(vault.getPreviousReflection('2026-05-05')).toEqual({
      date: '2026-05-04',
      reflection: 'What is still open?'
    });
    expect(vault.getPreviousReflection('2026-05-03')).toEqual({
      date: '2026-05-01',
      reflection: 'What was the quietest part?'
    });
  });

  it('skips pages without a reflection and stops at the beginning', () => {
    vault.saveEntry({ date: '2026-06-01', title: 'Only', body: 'The only reflected page.' });
    vault.saveReflection('2026-06-01', 'What did you leave unsaid?');

    vault.saveEntry({ date: '2026-06-03', title: 'Bare', body: 'A page with no question yet.' });

    expect(vault.getPreviousReflection('2026-06-04')).toEqual({
      date: '2026-06-01',
      reflection: 'What did you leave unsaid?'
    });
    expect(vault.getPreviousReflection('2026-06-01')).toBeNull();
    expect(() => vault.getPreviousReflection('3 June 2026')).toThrow(VaultError);
  });
});

describe('reflection answers', () => {
  const date = '2026-11-05';
  const question = 'What did the rain make room for?';

  beforeEach(() => {
    vault.saveEntry({ date, title: 'After rain', body: 'The rain stopped and I stayed.' });
    vault.saveReflection(date, question);
  });

  it('saves, trims, and updates an answer without duplicating it', () => {
    const first = vault.saveReflectionAnswer(date, question, '  Room for a slower breath.  ');
    expect(first.reflections).toHaveLength(1);
    expect(first.reflections[0]).toMatchObject({
      question,
      answer: 'Room for a slower breath.'
    });
    expect(first.reflections[0].createdAt).toBe(first.reflections[0].updatedAt);

    const updated = vault.saveReflectionAnswer(date, question, 'Room for a longer pause.');
    expect(updated.reflections).toHaveLength(1);
    expect(updated.reflections[0].answer).toBe('Room for a longer pause.');
  });

  it('keeps earlier answers when another question is asked', () => {
    vault.saveReflectionAnswer(date, question, 'A slower breath.');
    const secondQuestion = 'Where did the quiet land?';
    vault.saveReflection(date, secondQuestion);
    const entry = vault.saveReflectionAnswer(date, secondQuestion, 'In my shoulders.');

    expect(entry.reflections.map((item) => item.question)).toEqual([question, secondQuestion]);
    expect(entry.reflections.map((item) => item.answer)).toEqual([
      'A slower breath.',
      'In my shoulders.'
    ]);
  });

  it('rejects empty answers and pages that do not exist', () => {
    expect(() => vault.saveReflectionAnswer(date, question, '   ')).toThrow(VaultError);
    expect(() => vault.saveReflectionAnswer(date, '   ', 'An answer.')).toThrow(VaultError);
    expect(() => vault.saveReflectionAnswer('2026-11-06', question, 'An answer.')).toThrow(
      /no entry/i
    );
  });

  it('includes answers in full entries and export data', () => {
    vault.saveReflectionAnswer(date, question, 'Room for a longer pause.');
    const entry = vault.getEntry(date);
    expect(entry.reflections).toHaveLength(1);
    const exported = vault.getAllEntriesForExport().find((item) => item.date === date);
    expect(exported.reflections).toHaveLength(1);
    expect(exported.reflections[0].answer).toBe('Room for a longer pause.');
  });

  it('clears answers when the vault is purged', () => {
    vault.saveReflectionAnswer(date, question, 'Temporary.');
    vault.purge({ confirm: 'PURGE' });
    expect(vault.getEntry(date)).toBeNull();

    vault.saveEntry({ date, title: 'Fresh', body: 'A fresh start.' });
    expect(vault.getEntry(date).reflections).toEqual([]);
  });
});

describe('deleting a page', () => {
  it('removes the entry, tags, reflections, and full-text row', () => {
    vault.saveEntry({ date: '2026-07-01', title: 'Delete me', body: 'A page about otters.' });
    vault.saveEntry({ date: '2026-07-02', title: 'Keep me', body: 'A page about moss.' });
    vault.applyMetadata('2026-07-01', {
      summary: 'A river page about otters.',
      tags: ['otters', 'river'],
      mood: 5,
      primary_emotion: 'calm'
    });
    vault.saveReflection('2026-07-01', 'What did the otters leave?');
    vault.saveReflectionAnswer('2026-07-01', 'What did the otters leave?', 'A ripple.');

    const result = vault.deleteEntry('2026-07-01');
    expect(result).toEqual({ deleted: true, date: '2026-07-01' });
    expect(vault.getEntry('2026-07-01')).toBeNull();
    expect(vault.searchEntries({ query: 'otters' }).entries).toEqual([]);
    expect(vault.getTags()).toEqual([]);
    expect(vault.getEntry('2026-07-02')).not.toBeNull();
    expect(vault.getStats().entryCount).toBe(1);

    vault.saveEntry({ date: '2026-07-01', title: 'Fresh', body: 'A fresh page.' });
    expect(vault.getEntry('2026-07-01').reflections).toEqual([]);
  });

  it('rejects pages that do not exist and invalid dates', () => {
    expect(() => vault.deleteEntry('2026-07-03')).toThrow(/no entry/i);
    expect(() => vault.deleteEntry('3 July 2026')).toThrow(VaultError);
  });
});

describe('companion provenance', () => {
  const date = '2026-11-04';
  const page = 'I walked by the moss and felt quiet. The rain had stopped.';

  beforeEach(() => {
    vault.saveEntry({ date, title: 'Moss', body: page });
  });

  it('stores anchors and reading provenance without inventing it', () => {
    const read = vault.applyMetadata(date, {
      summary: 'A quiet walk after rain.',
      tags: ['moss', 'rain'],
      mood: 7,
      primary_emotion: 'hopeful',
      anchors: [
        'I walked by the moss and felt quiet.',
        'I walked by the moss and felt quiet.',
        'The rain had stopped.',
        'A line that was never on the page.'
      ],
      source: 'model'
    });
    expect(read.anchors).toEqual([
      'I walked by the moss and felt quiet.',
      'The rain had stopped.',
      'A line that was never on the page.'
    ]);
    expect(read.metadataSource).toBe('model');
    expect(read.paletteSource).toBeNull();

    const painted = vault.applyPalette(date, {
      hex_colors: ['#4f6b52', '#9db28f', '#e7e2d3'],
      vibe_name: 'quiet moss',
      fallback: true
    });
    expect(painted.paletteSource).toBe('fallback');
    expect(painted.metadataSource).toBe('model');
    expect(painted.anchors).toHaveLength(3);
  });

  it('keeps provenance across a failed re-read and a reopen', () => {
    vault.applyMetadata(date, {
      summary: 'A quiet walk after rain.',
      tags: ['moss'],
      mood: 7,
      primary_emotion: 'hopeful',
      anchors: ['The rain had stopped.'],
      source: 'model'
    });
    vault.applyPalette(date, {
      hex_colors: ['#7a6f63', '#a89a8a', '#e4d8c6'],
      vibe_name: 'warm clay',
      fallback: false
    });

    const fallback = vault.applyMetadata(date, {
      summary: 'I walked by the moss and felt quiet. The rain had stopped.',
      tags: [],
      mood: null,
      primary_emotion: 'reflective',
      anchors: [],
      source: 'fallback'
    });
    expect(fallback.anchors).toEqual([]);
    expect(fallback.metadataSource).toBe('fallback');
    expect(fallback.paletteSource).toBe('model');

    vault.close();
    vault.init();
    const reopened = vault.getEntry(date);
    expect(reopened.metadataSource).toBe('fallback');
    expect(reopened.paletteSource).toBe('model');
    expect(reopened.anchors).toEqual([]);

    const exported = vault.getAllEntriesForExport().find((item) => item.date === date);
    expect(exported.metadataSource).toBe('fallback');
    expect(exported.paletteSource).toBe('model');
  });

  it('leaves provenance alone for callers that do not send it', () => {
    vault.applyMetadata(date, {
      summary: 'A quiet walk after rain.',
      tags: ['moss'],
      mood: 7,
      primary_emotion: 'hopeful',
      anchors: ['The rain had stopped.'],
      source: 'model'
    });
    const legacy = vault.applyMetadata(date, {
      summary: 'A quiet walk.',
      tags: ['moss', 'walk'],
      mood: 6,
      primary_emotion: 'calm'
    });
    expect(legacy.anchors).toEqual(['The rain had stopped.']);
    expect(legacy.metadataSource).toBe('model');
  });
});

describe('schema migration', () => {
  it('adds the companion column to a version 1 vault without losing pages', () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-migrate-'));
    const dbPath = path.join(dir, 'vault', 'lichen_journal.sqlite');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        mood INTEGER,
        primary_emotion TEXT,
        summary TEXT,
        palette_json TEXT,
        reflection TEXT,
        word_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 1;
    `);
    const stamp = new Date().toISOString();
    legacy
      .prepare(
        `INSERT INTO entries (date, title, body, mood, summary, word_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run('2026-10-30', 'Older page', 'The old page still loads.', 5, 'Old summary.', 5, stamp, stamp);
    legacy.close();

    const migrated = new Vault({ dbPath, appVersion: 'test' });
    try {
      migrated.init();
      const entry = migrated.getEntry('2026-10-30');
      expect(entry.body).toBe('The old page still loads.');
      expect(entry.mood).toBe(5);
      expect(entry.anchors).toEqual([]);
      expect(entry.metadataSource).toBeNull();
      expect(entry.paletteSource).toBeNull();
      expect(entry.reflections).toEqual([]);

      const read = migrated.applyMetadata('2026-10-30', {
        summary: 'Still here.',
        tags: ['legacy'],
        mood: 5,
        primary_emotion: 'calm',
        anchors: ['The old page still loads.'],
        source: 'model'
      });
      expect(read.anchors).toEqual(['The old page still loads.']);
      expect(read.metadataSource).toBe('model');

      const answered = migrated.saveReflectionAnswer(
        '2026-10-30',
        'What still holds?',
        'The old page still does.'
      );
      expect(answered.reflections).toHaveLength(1);

      const version = new Database(dbPath, { readonly: true });
      expect(version.pragma('user_version', { simple: true })).toBe(3);
      version.close();
    } finally {
      migrated.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
