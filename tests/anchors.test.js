import { describe, expect, it } from 'vitest';
import { MAX_ANCHOR_SENTENCES, metadataPrompt, numberSentences } from '../src/main/ai-prompts.js';

describe('sentence anchors', () => {
  it('numbers each sentence and returns the same sentences trimmed', () => {
    const { text, sentences } = numberSentences(
      'The moss by the river was bright. I felt quiet.\n\nThe walk home was slow.'
    );
    expect(sentences).toEqual([
      'The moss by the river was bright.',
      'I felt quiet.',
      'The walk home was slow.'
    ]);
    expect(text).toContain('[1] The moss by the river was bright.');
    expect(text).toContain('[2] I felt quiet.');
    expect(text).toContain('[3] The walk home was slow.');
    expect(text.startsWith('[1] ')).toBe(true);
  });

  it('leaves the truncation marker unnumbered', () => {
    const { text, sentences } = numberSentences('A long page of writing. [entry continues]');
    expect(sentences).toEqual(['A long page of writing.']);
    expect(text).toContain('[entry continues]');
    expect(text).not.toContain('[2]');
  });

  it('caps the numbered list so a long entry stays readable', () => {
    const body = Array.from({ length: 40 }, (_, index) => `Sentence number ${index + 1}.`).join(' ');
    const { text, sentences } = numberSentences(body);
    expect(sentences).toHaveLength(MAX_ANCHOR_SENTENCES);
    expect(text).toContain(`[${MAX_ANCHOR_SENTENCES}]`);
    expect(text).not.toContain(`[${MAX_ANCHOR_SENTENCES + 1}]`);
  });

  it('returns nothing for empty writing', () => {
    expect(numberSentences('   ')).toEqual({ text: '   ', sentences: [] });
    expect(numberSentences(undefined).sentences).toEqual([]);
  });

  it('only asks for anchors when sentences were numbered', () => {
    const plain = metadataPrompt('One line.');
    expect(plain).not.toContain('anchors');

    const marked = metadataPrompt('[1] One line. [2] Another line.', { anchors: 2 });
    expect(marked).toContain('anchors');
    expect(marked).toContain('2 or 3');
    expect(marked).toContain('[1] One line.');
    expect(marked).toContain('[2] Another line.');
  });
});
