import { describe, expect, it } from 'vitest';
import { mergePageText, sanitizeCompanionText } from '../src/renderer/src/lib/text.js';

describe('companion text sanitizing', () => {
  it('strips query tags and chat tokens before display', () => {
    expect(
      sanitizeCompanionText('<query>What did the rain make room for?</query>')
    ).toBe('What did the rain make room for?');
    expect(sanitizeCompanionText('<|im_end|>What felt tender?')).toBe('What felt tender?');
    expect(sanitizeCompanionText('What did <entry>that</entry> open?')).toBe(
      'What did that open?'
    );
    expect(sanitizeCompanionText('[query]What did that open?[/query]')).toBe(
      'What did that open?'
    );
  });

  it('hides a partially streamed tag at the end of the text', () => {
    expect(sanitizeCompanionText('What did <que')).toBe('What did');
    expect(sanitizeCompanionText('What did <|im_st')).toBe('What did');
    expect(sanitizeCompanionText('<query>What did that open?</query')).toBe('What did that open?');
  });

  it('leaves ordinary angle brackets and empty values alone', () => {
    expect(sanitizeCompanionText('I <3 this page.')).toBe('I <3 this page.');
    expect(sanitizeCompanionText('')).toBe('');
    expect(sanitizeCompanionText(null)).toBe('');
  });
});

describe('photo page merging', () => {
  it('adds text below existing words and creates an empty page', () => {
    expect(mergePageText('', 'A new page.')).toBe('A new page.');
    expect(mergePageText('Existing words.\n', 'Photo words.')).toBe(
      'Existing words.\n\nPhoto words.'
    );
    expect(mergePageText('Existing words.', '   ')).toBe('Existing words.');
  });
});
