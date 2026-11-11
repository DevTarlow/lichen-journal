import { describe, expect, it } from 'vitest';
import {
  FALLBACK_QUESTION,
  cleanReflection,
  fallbackSummary,
  normalizeMetadata,
  normalizePaletteResult,
  parseJsonObject,
  truncateForModel
} from '../src/main/ai-utils.js';

describe('reflection cleanup', () => {
  it('strips fences, labels, and keeps exactly one question', () => {
    expect(cleanReflection('```\nCompanion: What did the rain make room for?\n```')).toBe(
      'What did the rain make room for?'
    );
    expect(cleanReflection('What felt tender? I also wonder about more.')).toBe(
      'What felt tender?'
    );
  });

  it('turns a statement into a question and falls back for empty output', () => {
    expect(cleanReflection('Notice the quiet.')).toBe('Notice the quiet?');
    expect(cleanReflection('   ')).toBe(FALLBACK_QUESTION);
    expect(cleanReflection('?')).toBe(FALLBACK_QUESTION);
  });

  it('strips query tags, chat tokens, and role labels from model output', () => {
    expect(cleanReflection('<query>What did the rain make room for?</query>')).toBe(
      'What did the rain make room for?'
    );
    expect(cleanReflection('<|im_start|>assistant\nWhat felt tender?<|im_end|>')).toBe(
      'What felt tender?'
    );
    expect(cleanReflection('<entry>What did that open?</entry>')).toBe('What did that open?');
    expect(cleanReflection('query: What did that open?')).toBe('What did that open?');
    expect(cleanReflection('[query]What did that open?[/query]')).toBe('What did that open?');
    expect(cleanReflection('<query></query>')).toBe(FALLBACK_QUESTION);
  });
});

describe('metadata normalization', () => {
  it('accepts a clean object and clamps invalid values', () => {
    const metadata = normalizeMetadata(
      {
        summary: 'A quiet walk after rain.',
        tags: ['Rain', 'walking', 'rain', 'softness'],
        mood: 12,
        primary_emotion: 'Hopeful!'
      },
      'entry text'
    );
    expect(metadata).toEqual({
      summary: 'A quiet walk after rain.',
      tags: ['rain', 'walking', 'softness'],
      mood: 10,
      primary_emotion: 'hopeful',
      anchors: [],
      source: 'model'
    });
  });

  it('parses fenced JSON and falls back locally for malformed output', () => {
    const parsed = normalizeMetadata(
      '```json\n{"summary":"A tender day.","tags":["tender","rain"],"mood":6,"primary_emotion":"tender"}\n```',
      'I watched the rain. It felt tender.'
    );
    expect(parsed.summary).toBe('A tender day.');
    expect(parsed.mood).toBe(6);

    const fallback = normalizeMetadata('not json at all', 'I watched the rain. It felt tender.');
    expect(fallback.summary).toBe('I watched the rain.');
    expect(fallback.tags).toEqual([]);
    expect(fallback.mood).toBeNull();
    expect(fallback.primary_emotion).toBe('reflective');
    expect(fallback.anchors).toEqual([]);
    expect(fallback.source).toBe('fallback');
  });


  it('extracts metadata from the loose prefixed JSON the 1B model produces', () => {
    const sentences = [
      'I walked by the river after the rain.',
      'The air smelled of moss and wet stone.',
      'I felt quiet relief, then a small ache.',
      'I want to be gentler with myself this week.'
    ];
    const raw =
      '{"summary":"A quiet walk after rain evokes calm and gentle introspection." "tags":"mood,primary_emotion,tags,relief,ache," "anchors", "1", "2"}, "mood": 5, "primary_emotion": calm';
    const metadata = normalizeMetadata(raw, 'entry text', sentences);
    expect(metadata.summary).toBe(
      'A quiet walk after rain evokes calm and gentle introspection.'
    );
    expect(metadata.tags).toEqual(['relief', 'ache']);
    expect(metadata.mood).toBe(5);
    expect(metadata.primary_emotion).toBe('calm');
    expect(metadata.anchors).toEqual([
      'I walked by the river after the rain.',
      'The air smelled of moss and wet stone.'
    ]);
    expect(metadata.source).toBe('model');
  });

  it('accepts smart quotes around keys in the 1B metadata output', () => {
    const raw =
      '{"mood":5,"primary_emotion":"tender","summary":"A quiet walk stirred relief and a small ache. “tags":["river","moss","relief"],“anchors":[1,3]}';
    const metadata = normalizeMetadata(raw, 'entry text', [
      'I walked by the river after the rain.',
      'The air smelled of moss and wet stone.',
      'I felt quiet relief.'
    ]);
    expect(metadata.mood).toBe(5);
    expect(metadata.tags).toEqual(['river', 'moss', 'relief']);
    expect(metadata.source).toBe('model');
    expect(metadata.anchors).toEqual([
      'I walked by the river after the rain.',
      'I felt quiet relief.'
    ]);
  });

  it('accepts a string tag list and labelled anchors from another loose shape', () => {
    const sentences = ['A first line.', 'A second line.'];
    const raw =
      '{"summary":"A steady afternoon.", "tags":["rain", "walk"], "mood": 6, "primary_emotion": "tender", "anchors": ["1. A first line.", "2. A second line."]}';
    const metadata = normalizeMetadata(raw, 'entry text', sentences);
    expect(metadata.tags).toEqual(['rain', 'walk']);
    expect(metadata.anchors).toEqual(['A first line.', 'A second line.']);
    expect(metadata.source).toBe('model');
  });

  it('maps anchor numbers to sentences and keeps only usable ones', () => {
    const sentences = [
      'The moss by the river was bright after the rain.',
      'I felt quiet and a little hopeful.',
      'The walk home was slow.',
      'I forgot my keys.'
    ];
    const raw = {
      summary: 'A wet walk home.',
      tags: ['moss', 'rain'],
      mood: 7,
      primary_emotion: 'hopeful',
      anchors: [2, 2, 9, 0, 1, 3, 4]
    };
    const metadata = normalizeMetadata(raw, 'entry text', sentences);
    expect(metadata.source).toBe('model');
    expect(metadata.anchors).toEqual([
      'I felt quiet and a little hopeful.',
      'The moss by the river was bright after the rain.',
      'The walk home was slow.'
    ]);

    const noSentences = normalizeMetadata(raw, 'entry text');
    expect(noSentences.anchors).toEqual([]);

    const fallback = normalizeMetadata('not json', 'entry text', sentences);
    expect(fallback.anchors).toEqual([]);
    expect(fallback.source).toBe('fallback');
  });

  it('extracts fenced JSON objects and truncates long input', () => {
    expect(parseJsonObject('noise {"a":1} noise')).toEqual({ a: 1 });
    expect(parseJsonObject('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    const long = 'word '.repeat(3000);
    const truncated = truncateForModel(long);
    expect(truncated.length).toBeLessThanOrEqual(6100);
    expect(truncated).toContain('[entry continues]');
  });

  it('builds a deterministic local fallback summary', () => {
    expect(fallbackSummary('')).toBe('A private journal entry.');
    expect(fallbackSummary('The rain stopped. Then the sun came out.')).toBe('The rain stopped.');
  });
});

describe('palette normalization', () => {
  it('accepts three valid hex colors and lowercases them', () => {
    const palette = normalizePaletteResult(
      { hex_colors: ['#4F6B52', '#9DB28F', '#E7E2D3'], vibe_name: 'Quiet Moss' },
      { text: 'moss', mood: 7 }
    );
    expect(palette.fallback).toBe(false);
    expect(palette.hex_colors).toEqual(['#4f6b52', '#9db28f', '#e7e2d3']);
    expect(palette.vibe_name).toBe('quiet moss');
  });


  it('extracts three colors and a vibe from malformed palette JSON', () => {
    const palette = normalizePaletteResult(
      '{"hex_colors":["#8B4513","#A0522D","#66B18B","vibe_name: calm contemplation"}',
      { text: 'river', mood: 5 }
    );
    expect(palette.fallback).toBe(false);
    expect(palette.hex_colors).toEqual(['#8b4513', '#a0522d', '#66b18b']);
    expect(palette.vibe_name).toContain('calm');
  });

  it('returns a deterministic curated palette when colors are invalid', () => {
    const first = normalizePaletteResult(
      { hex_colors: ['red', '#000', '#ffffff'], vibe_name: 'bad' },
      { text: 'moss', mood: 7 }
    );
    const second = normalizePaletteResult(
      { hex_colors: [], vibe_name: 'bad' },
      { text: 'moss', mood: 7 }
    );
    expect(first.fallback).toBe(true);
    expect(first.hex_colors).toEqual(second.hex_colors);
    expect(first.hex_colors).toHaveLength(3);
    expect(first.hex_colors.every((color) => /^#[0-9a-f]{6}$/.test(color))).toBe(true);
  });

  it('rejects a structured-looking vibe name instead of showing raw output', () => {
    const palette = normalizePaletteResult(
      {
        hex_colors: ['#4f6b52', '#9db28f', '#e7e2d3'],
        vibe_name: '{"name":"earthy","description":"a blend"}'
      },
      { text: 'moss', mood: 7 }
    );
    expect(palette.fallback).toBe(false);
    expect(palette.hex_colors).toEqual(['#4f6b52', '#9db28f', '#e7e2d3']);
    expect(palette.vibe_name).toMatch(/^[a-z ]+$/);
    expect(palette.vibe_name).not.toContain('{');
  });
});
