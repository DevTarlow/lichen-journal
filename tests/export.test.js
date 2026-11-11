import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { Vault } from '../src/main/db.js';

let tempDir;
let vault;
let exportPath;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(process.cwd(), '.test-tmp-export-'));
  exportPath = path.join(tempDir, 'lichen-export.zip');
  vault = new Vault({
    dbPath: path.join(tempDir, 'vault', 'lichen_journal.sqlite'),
    appVersion: '1.0.0'
  });
  vault.init();
});

afterEach(() => {
  vault.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('vault export', () => {
  it('exports clean Markdown, metadata, and a readme', async () => {
    vault.saveEntry({
      date: '2026-11-03',
      title: 'River notes',
      body: 'The moss was bright after the rain.\nI stayed a while.'
    });
    vault.applyMetadata('2026-11-03', {
      summary: 'A mossy walk after rain.',
      tags: ['moss', 'rain'],
      mood: 7,
      primary_emotion: 'hopeful'
    });
    vault.applyPalette('2026-11-03', {
      hex_colors: ['#4f6b52', '#9db28f', '#e7e2d3'],
      vibe_name: 'quiet moss'
    });
    vault.saveReflection('2026-11-03', 'What did the rain make room for?');
    vault.saveReflectionAnswer(
      '2026-11-03',
      'What did the rain make room for?',
      'It made room for a slower walk and a longer breath.'
    );

    const result = await vault.exportToZip(exportPath);
    expect(result.entryCount).toBe(1);
    expect(result.bytes).toBeGreaterThan(0);

    const zip = new AdmZip(exportPath);
    const names = zip.getEntries().map((entry) => entry.entryName).sort();
    expect(names).toEqual([
      'README.txt',
      'entries/2026-11-03-river-notes.md',
      'metadata.json'
    ]);

    const markdown = zip.readAsText('entries/2026-11-03-river-notes.md');
    expect(markdown).toContain('title: "River notes"');
    expect(markdown).toContain('date: 2026-11-03');
    expect(markdown).toContain('tags: ["moss", "rain"]');
    expect(markdown).toContain('mood: 7');
    expect(markdown).toContain('palette: {"hex_colors":["#4f6b52","#9db28f","#e7e2d3"]');
    expect(markdown).toContain('# River notes');
    expect(markdown).toContain('The moss was bright after the rain.');
    expect(markdown).toContain('## Reflections');
    expect(markdown).toContain('> What did the rain make room for?');
    expect(markdown).toContain('It made room for a slower walk and a longer breath.');

    const metadata = JSON.parse(zip.readAsText('metadata.json'));
    expect(metadata.format).toBe('lichen-journal-vault');
    expect(metadata.entries).toHaveLength(1);
    expect(metadata.entries[0].reflection).toBe('What did the rain make room for?');
    expect(metadata.entries[0].reflections).toHaveLength(1);
    expect(metadata.entries[0].reflections[0]).toMatchObject({
      question: 'What did the rain make room for?',
      answer: 'It made room for a slower walk and a longer breath.'
    });
    expect(metadata.entries[0].tags).toEqual(['moss', 'rain']);
    expect(metadata.entries[0].palette.vibe_name).toBe('quiet moss');
    expect(zip.readAsText('README.txt')).toContain('It never left your machine.');
  });

  it('exports a valid archive for an empty vault', async () => {
    const result = await vault.exportToZip(exportPath);
    expect(result.entryCount).toBe(0);
    const zip = new AdmZip(exportPath);
    expect(zip.getEntries()).toHaveLength(2);
    expect(JSON.parse(zip.readAsText('metadata.json')).entries).toEqual([]);
  });
});

describe('vault purge', () => {
  it('requires the literal confirmation token', () => {
    expect(() => vault.purge({ confirm: 'purge' })).toThrow(/PURGE/);
    expect(() => vault.purge({})).toThrow(/PURGE/);
    expect(vault.getStats().entryCount).toBe(0);
  });

  it('clears all tables, unlinks the database, and reinitializes', () => {
    vault.saveEntry({ date: '2026-11-03', title: 'Temporary', body: 'This will be cleared.' });
    vault.applyMetadata('2026-11-03', {
      summary: 'Temporary.',
      tags: ['temporary'],
      mood: 4,
      primary_emotion: 'tired'
    });
    const dbPath = vault.dbPath;
    expect(fs.existsSync(dbPath)).toBe(true);

    const result = vault.purge({ confirm: 'PURGE' });
    expect(result.purged).toBe(true);
    expect(result.stats.entryCount).toBe(0);
    expect(result.stats.wordCount).toBe(0);
    expect(result.stats.tagCount).toBe(0);
    expect(fs.existsSync(dbPath)).toBe(true);
    expect(vault.getStats().entryCount).toBe(0);
    expect(vault.getTags()).toEqual([]);
    expect(vault.searchEntries({ query: 'temporary' }).entries).toEqual([]);

    vault.saveEntry({ date: '2026-11-04', title: 'Fresh', body: 'A fresh start.' });
    expect(vault.getStats().entryCount).toBe(1);
  });
});
