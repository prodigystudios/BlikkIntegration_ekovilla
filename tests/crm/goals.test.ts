import { describe, it, expect } from 'vitest';
import { weeklyFromMonthly, GOAL_WEEKS_PER_MONTH, formatLocalDateOnly } from '@/lib/domains/crm/goals';

describe('weeklyFromMonthly', () => {
  it('divides a monthly budget by the fixed weeks-per-month (4)', () => {
    expect(GOAL_WEEKS_PER_MONTH).toBe(4);
    expect(weeklyFromMonthly(40)).toBe(10);
    expect(weeklyFromMonthly(100000)).toBe(25000);
  });

  it('accepts numeric strings (Supabase numeric columns)', () => {
    expect(weeklyFromMonthly('200')).toBe(50);
  });

  it('returns 0 for empty/invalid input', () => {
    expect(weeklyFromMonthly(0)).toBe(0);
    expect(weeklyFromMonthly('')).toBe(0);
    expect(weeklyFromMonthly('abc')).toBe(0);
  });

  it('keeps fractional results (rounding is a display concern)', () => {
    expect(weeklyFromMonthly(50)).toBe(12.5);
  });
});

describe('formatLocalDateOnly', () => {
  it('formats a date as YYYY-MM-DD in local time', () => {
    expect(formatLocalDateOnly(new Date(2026, 5, 1))).toBe('2026-06-01'); // month is 0-indexed → June
    expect(formatLocalDateOnly(new Date(2026, 11, 9))).toBe('2026-12-09');
  });
});
