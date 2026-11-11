import { describe, it, expect } from 'vitest';
import {
  RITUAL_STEPS,
  ritualDone,
  ritualProgress
} from '../src/renderer/src/lib/ritual.js';

const BASE = { date: '2026-11-03' };
const METADATA = {
  ...BASE,
  primaryEmotion: 'tender',
  summary: 'A rain-softened walk that leaves room for gentleness.',
  tags: ['gentleness', 'rain']
};
const STORED_PALETTE = {
  hex_colors: ['#4f6b52', '#9db28f', '#e7e2d3'],
  vibe_name: 'quiet moss'
};

describe('page ritual progress', () => {
  it('starts at mood for an empty entry', () => {
    const progress = ritualProgress(null);
    expect(RITUAL_STEPS.map((step) => step.key)).toEqual(['mood', 'themes', 'palette']);
    expect(progress).toEqual({
      done: { mood: false, themes: false, palette: false },
      completed: 0,
      firstIncomplete: 0,
      allDone: false
    });
  });

  it('recognises extracted themes but keeps a missing mood open', () => {
    const progress = ritualProgress(METADATA);
    expect(progress.done).toEqual({ mood: false, themes: true, palette: false });
    expect(progress.completed).toBe(1);
    expect(progress.firstIncomplete).toBe(0);
    expect(progress.allDone).toBe(false);
  });

  it('moves on to the palette once mood and themes are present', () => {
    const progress = ritualProgress({ ...METADATA, mood: 7 });
    expect(progress.done).toEqual({ mood: true, themes: true, palette: false });
    expect(progress.firstIncomplete).toBe(2);
    expect(progress.allDone).toBe(false);
  });

  it('requires a stored palette, not just a fallback tint', () => {
    const fallbackOnly = ritualDone({ ...METADATA, mood: 7 });
    expect(fallbackOnly.palette).toBe(false);

    const stored = ritualDone({ ...METADATA, mood: 7, palette: STORED_PALETTE });
    expect(stored).toEqual({ mood: true, themes: true, palette: true });
  });

  it('reports a fully settled page', () => {
    const progress = ritualProgress({ ...METADATA, mood: 7, palette: STORED_PALETTE });
    expect(progress.completed).toBe(3);
    expect(progress.firstIncomplete).toBeNull();
    expect(progress.allDone).toBe(true);
  });
});
