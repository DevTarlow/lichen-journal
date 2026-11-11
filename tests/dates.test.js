import { describe, it, expect } from 'vitest';
import { addDays, shiftMonths, shiftYears } from '../src/renderer/src/lib/dates.js';

describe('date shifting', () => {
  it('moves by whole days and keeps the calendar format', () => {
    expect(addDays('2025-03-03', 1)).toBe('2025-03-04');
    expect(addDays('2025-03-03', -3)).toBe('2025-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2025-01-01', -1)).toBe('2024-12-31');
  });

  it('leaves unparsable input alone', () => {
    expect(addDays('', 5)).toBe('');
    expect(addDays('not-a-date', 5)).toBe('');
    expect(addDays('2025-02-30', 1)).toBe('');
  });

  it('clamps the day of month when shifting months', () => {
    expect(shiftMonths('2025-03-31', -1)).toBe('2025-02-28');
    expect(shiftMonths('2024-03-31', -1)).toBe('2024-02-29');
    expect(shiftMonths('2025-01-15', -1)).toBe('2024-12-15');
    expect(shiftMonths('2025-05-31', 1)).toBe('2025-06-30');
    expect(shiftMonths('2025-05-15', 0)).toBe('2025-05-15');
  });

  it('shifts whole years through the month helper', () => {
    expect(shiftYears('2025-06-12', -1)).toBe('2024-06-12');
    expect(shiftYears('2025-06-12', 1)).toBe('2026-06-12');
    expect(shiftYears('2024-02-29', -1)).toBe('2023-02-28');
  });
});
