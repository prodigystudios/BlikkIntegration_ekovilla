import { describe, it, expect } from 'vitest';
import { swedishHoliday } from '@/lib/domains/planning/holidays';

describe('swedishHoliday', () => {
  it('resolves fixed-date red days', () => {
    expect(swedishHoliday('2026-01-01')).toBe('Nyårsdagen');
    expect(swedishHoliday('2026-01-06')).toBe('Trettondedag jul');
    expect(swedishHoliday('2026-05-01')).toBe('Första maj');
    expect(swedishHoliday('2026-06-06')).toBe('Sveriges nationaldag');
    expect(swedishHoliday('2026-12-25')).toBe('Juldagen');
    expect(swedishHoliday('2026-12-26')).toBe('Annandag jul');
  });

  it('resolves Easter-derived holidays (Easter 2026 = 5 Apr)', () => {
    expect(swedishHoliday('2026-04-03')).toBe('Långfredagen');
    expect(swedishHoliday('2026-04-05')).toBe('Påskdagen');
    expect(swedishHoliday('2026-04-06')).toBe('Annandag påsk');
    expect(swedishHoliday('2026-05-14')).toBe('Kristi himmelsfärds dag');
    expect(swedishHoliday('2026-05-24')).toBe('Pingstdagen');
  });

  it('resolves midsummer (Sat 20 Jun 2026) + its eve', () => {
    expect(swedishHoliday('2026-06-20')).toBe('Midsommardagen');
    expect(swedishHoliday('2026-06-19')).toBe('Midsommarafton');
  });

  it('returns null on an ordinary day', () => {
    expect(swedishHoliday('2026-06-10')).toBeNull();
    expect(swedishHoliday('2026-03-17')).toBeNull();
  });

  it('works across years (Easter 2025 = 20 Apr)', () => {
    expect(swedishHoliday('2025-04-20')).toBe('Påskdagen');
    expect(swedishHoliday('2025-04-18')).toBe('Långfredagen');
  });
});
