import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Vault } from '../src/main/db.js';
import {
  MOCK_ENTRY_COUNT,
  dateAtOffset,
  seedMockJournal
} from '../src/main/dev-mock-data.js';

const tempDirs = [];

function makeVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lichen-mock-data-'));
  tempDirs.push(dir);
  const vault = new Vault({
    dbPath: path.join(dir, 'vault', 'lichen_journal.sqlite'),
    appVersion: 'test'
  });
  vault.init();
  return vault;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('developer mock journal', () => {
  const now = new Date(2026, 2, 15, 12, 0, 0, 0);

  it('builds local calendar dates around the supplied day', () => {
    expect(dateAtOffset(now, 0)).toBe('2026-03-15');
    expect(dateAtOffset(now, 1)).toBe('2026-03-14');
    expect(dateAtOffset(now, 32)).toBe('2026-02-11');
  });

  it('seeds eight unique, coherent entries', () => {
    const vault = makeVault();
    const seeded = seedMockJournal(vault, { now });

    expect(seeded.count).toBe(MOCK_ENTRY_COUNT);
    expect(new Set(seeded.dates).size).toBe(MOCK_ENTRY_COUNT);
    expect(vault.getStats().entryCount).toBe(MOCK_ENTRY_COUNT);
    expect(vault.getStats().wordCount).toBeGreaterThan(0);

    const today = vault.getEntry('2026-03-15');
    expect(today).toMatchObject({
      title: 'Moss after the rain',
      mood: 7,
      primaryEmotion: 'calm'
    });
    expect(today.tags).toEqual(expect.arrayContaining(['walking', 'rain', 'moss']));
    expect(today.palette.hex_colors).toHaveLength(3);
    expect(today.palette.vibe_name).toBe('rain-washed green');
    expect(today.reflection).toBe('What did the rain make easier to notice?');
    expect(today.reflections).toEqual([]);

    const answered = vault.getEntry('2026-03-13');
    expect(answered.reflection).toBe('What helped you stay in the room today?');
    expect(answered.reflections).toHaveLength(1);
    expect(answered.reflections[0].answer).toMatch(/silence/i);
    expect(vault.getPreviousReflection('2026-03-15')).toMatchObject({
      date: '2026-03-13'
    });

    const fallback = vault.getEntry('2026-03-06');
    expect(fallback.metadataSource).toBe('fallback');
    expect(fallback.mood).toBeNull();

    const previousMonth = vault.getEntry('2026-02-11');
    expect(previousMonth.title).toBe('The first frost');
    expect(previousMonth.palette).toBeTruthy();

    vault.close();
  });
});
