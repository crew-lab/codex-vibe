import { describe, expect, it } from 'vitest';
import { isCalendarDay } from '../../src/cli/runs/calendar-day.js';

describe('calendar day option values', () => {
  it.each(['2026-11-13', '2024-02-29', '2000-02-29', '1999-12-31'])('accepts %s', (value) => {
    expect(isCalendarDay(value)).toBe(true);
  });

  it.each(['2026-13-01', '2026-00-10', '2026-11-31', '2026-02-30', '2025-02-29', '1900-02-29', '2026-11-00', '2026-1-1', '20261113', 'not-a-date', ''])('rejects %s without throwing', (value) => {
    expect(() => isCalendarDay(value)).not.toThrow();
    expect(isCalendarDay(value)).toBe(false);
  });
});
