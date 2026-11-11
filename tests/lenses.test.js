import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REFLECT_LENS,
  REFLECT_LENSES,
  REFLECT_LENS_IDS,
  lensById,
  normalizeLens
} from '../src/renderer/src/lib/lenses.js';
import {
  DEFAULT_REFLECT_LENS as MAIN_DEFAULT_REFLECT_LENS,
  MAX_CARRY_CHARS,
  REFLECT_LENSES as MAIN_REFLECT_LENSES,
  buildReflectSystemPrompt,
  reflectionPrompt
} from '../src/main/ai-prompts.js';

describe('reflection lenses', () => {
  it('stays in sync with the main-process whitelist', () => {
    expect([...REFLECT_LENS_IDS].sort()).toEqual(Object.keys(MAIN_REFLECT_LENSES).sort());
    expect(DEFAULT_REFLECT_LENS).toBe(MAIN_DEFAULT_REFLECT_LENS);
    expect(MAIN_REFLECT_LENSES[DEFAULT_REFLECT_LENS]).toBeTruthy();
  });

  it('describes every angle for the chip row', () => {
    expect(REFLECT_LENSES).toHaveLength(4);
    for (const lens of REFLECT_LENSES) {
      expect(lens.id).toBeTruthy();
      expect(lens.label).toBeTruthy();
      expect(lens.hint).toBeTruthy();
      expect(lens.questionLabel).toBeTruthy();
    }
  });

  it('falls back to the default for unknown angles', () => {
    expect(normalizeLens('body')).toBe('body');
    expect(normalizeLens('therapy')).toBe(DEFAULT_REFLECT_LENS);
    expect(normalizeLens(undefined)).toBe(DEFAULT_REFLECT_LENS);
    expect(lensById('curious').id).toBe('curious');
    expect(lensById('nope').id).toBe(DEFAULT_REFLECT_LENS);
  });

  it('appends the chosen angle without weakening the base rules', () => {
    const gentle = buildReflectSystemPrompt();
    const body = buildReflectSystemPrompt('body');
    const unknown = buildReflectSystemPrompt('therapy');

    expect(gentle).toContain(MAIN_REFLECT_LENSES.gentle);
    expect(body).toContain(MAIN_REFLECT_LENSES.body);
    expect(body).not.toContain(MAIN_REFLECT_LENSES.gentle);
    expect(unknown).toBe(gentle);
    for (const prompt of [gentle, body]) {
      expect(prompt).toContain('never the rules above');
      expect(prompt).toContain('Ask one question only, ending with a question mark.');
      expect(prompt).toContain('Never give advice, instructions, diagnoses, or interpretations.');
    }
  });

  it('carries the previous question without letting it crowd out the entry', () => {
    const plain = reflectionPrompt('A short page.');
    expect(plain).not.toContain('<previous_question>');

    const carried = reflectionPrompt('A short page.', { carry: 'What felt unfinished?' });
    expect(carried).toContain('<previous_question>\nWhat felt unfinished?\n</previous_question>');
    expect(carried).toContain('Do not repeat, rephrase, or mirror that question.');
    expect(carried.indexOf('<previous_question>')).toBeLessThan(carried.indexOf('<entry>'));

    const capped = reflectionPrompt('A short page.', { carry: 'x'.repeat(MAX_CARRY_CHARS + 120) });
    const carriedBlock = capped.slice(
      capped.indexOf('<previous_question>'),
      capped.indexOf('</previous_question>')
    );
    expect(carriedBlock.length).toBeLessThanOrEqual(MAX_CARRY_CHARS + 40);
  });
});
