import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Vault, buildFtsQuery } from '../src/main/db.js';

let tempDir;
let vault;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-search-'));
  vault = new Vault({ dbPath: path.join(tempDir, 'vault.sqlite'), appVersion: 'test' });
  vault.init();

  const entries = [
    {
      date: '2026-11-01',
      title: 'Mossy morning',
      body: 'Green moss covered the stones after the rain. A hopeful start.',
      tags: ['nature', 'walking'],
      mood: 7,
      emotion: 'hopeful'
    },
    {
      date: '2026-11-02',
      title: 'Rainy afternoon',
      body: 'I stayed inside with tea and watched the rain on the window.',
      tags: ['weather', 'rest'],
      mood: 5,
      emotion: 'calm'
    },
    {
      date: '2026-11-03',
      title: 'A difficult call',
      body: 'The conversation left me tired, but the evening walk helped.',
      tags: ['family', 'rest'],
      mood: 3,
      emotion: 'tired'
    }
  ];

  for (const entry of entries) {
    vault.saveEntry(entry);
    vault.applyMetadata(entry.date, {
      summary: `Summary for ${entry.title}`,
      tags: entry.tags,
      mood: entry.mood,
      primary_emotion: entry.emotion
    });
  }
});

afterEach(() => {
  vault.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('full-text search', () => {
  it('searches body and title with highlighted snippets', () => {
    const bodyResult = vault.searchEntries({ query: 'moss' });
    expect(bodyResult.mode).toBe('fts');
    expect(bodyResult.entries).toHaveLength(1);
    expect(bodyResult.entries[0].title).toBe('Mossy morning');
    expect(bodyResult.entries[0].snippet).toContain('\u0001');
    expect(bodyResult.entries[0].snippet).toContain('\u0002');

    const titleResult = vault.searchEntries({ query: 'rainy' });
    expect(titleResult.entries[0].date).toBe('2026-11-02');
  });

  it('supports prefixes and multi-term AND queries', () => {
    expect(vault.searchEntries({ query: 'mos' }).entries[0].date).toBe('2026-11-01');
    expect(vault.searchEntries({ query: 'rain window' }).entries[0].date).toBe('2026-11-02');
    expect(vault.searchEntries({ query: 'rain esperanza' }).entries).toHaveLength(0);
  });

  it('sanitizes FTS syntax and punctuation safely', () => {
    for (const query of ['moss OR rain', '"unclosed', 'moss*', '!!', '(', 'rain -window']) {
      expect(() => vault.searchEntries({ query })).not.toThrow();
      expect(Array.isArray(vault.searchEntries({ query }).entries)).toBe(true);
    }
    expect(buildFtsQuery('Moss & Rain!')).toBe('"moss"* AND "rain"*');
    expect(buildFtsQuery('!!!')).toBeNull();
  });

  it('combines text search with AND tag filters', () => {
    expect(vault.searchEntries({ tags: ['rest'] }).entries).toHaveLength(2);
    expect(vault.searchEntries({ tags: ['rest', 'family'] }).entries).toHaveLength(1);
    expect(vault.searchEntries({ tags: ['rest', 'nature'] }).entries).toHaveLength(0);
    expect(vault.searchEntries({ query: 'walk', tags: ['rest'] }).entries).toHaveLength(1);
  });

  it('returns recent entries when the query is empty and respects limits', () => {
    const recent = vault.searchEntries({ query: '' });
    expect(recent.mode).toBe('recent');
    expect(recent.entries.map((entry) => entry.date)).toEqual([
      '2026-11-03',
      '2026-11-02',
      '2026-11-01'
    ]);
    expect(vault.searchEntries({ query: '', limit: 1 }).entries).toHaveLength(1);
    expect(vault.searchEntries({ query: 'a', limit: 1 }).entries.length).toBeLessThanOrEqual(1);
  });

  it('falls back to a safe substring search for single characters', () => {
    const result = vault.searchEntries({ query: 'm' });
    expect(['like', 'fts']).toContain(result.mode);
    expect(result.entries.some((entry) => entry.title === 'Mossy morning')).toBe(true);
  });
});
