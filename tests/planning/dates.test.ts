import { describe, it, expect } from 'vitest';
import { addDaysISO, daysBetweenInclusive, isoWeek, buildWeekDays, buildMonthWeeks, parseISO } from '@/app/crm/planering/planningDates';

describe('addDaysISO / daysBetweenInclusive', () => {
  it('adds days across a month boundary', () => {
    expect(addDaysISO('2026-06-30', 1)).toBe('2026-07-01');
    expect(addDaysISO('2026-06-15', 6)).toBe('2026-06-21');
  });
  it('counts an inclusive span (same day = 1)', () => {
    expect(daysBetweenInclusive('2026-06-15', '2026-06-15')).toBe(1);
    expect(daysBetweenInclusive('2026-06-15', '2026-06-17')).toBe(3);
  });
});

describe('isoWeek', () => {
  it('numbers June 2026 weeks (Mon 15 Jun 2026 = ISO week 25)', () => {
    expect(isoWeek(parseISO('2026-06-15'))).toBe(25);
    expect(isoWeek(parseISO('2026-06-01'))).toBe(23);
  });
});

describe('buildWeekDays', () => {
  it('builds Mon..Sun from a Monday with weekend flags', () => {
    const days = buildWeekDays(parseISO('2026-06-15'));
    expect(days.map((d) => d.iso)).toEqual([
      '2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21',
    ]);
    expect(days[0].weekday).toBe('mån');
    expect(days[5].isWeekend).toBe(true);
    expect(days[6].isWeekend).toBe(true);
    expect(days[0].isWeekend).toBe(false);
  });
});

describe('buildMonthWeeks', () => {
  it('covers June 2026 with Mon-start weeks and in/out-of-month flags', () => {
    const weeks = buildMonthWeeks(parseISO('2026-06-17'));
    // June 1 2026 is a Monday → first week starts on the 1st
    expect(weeks[0].days[0].iso).toBe('2026-06-01');
    expect(weeks[0].weekNo).toBe(23);
    // last week must include June 30 and spill into July (out of month)
    const last = weeks[weeks.length - 1];
    const july1 = last.days.find((d) => d.iso === '2026-07-01');
    expect(july1?.inMonth).toBe(false);
    const jun30 = weeks.flatMap((w) => w.days).find((d) => d.iso === '2026-06-30');
    expect(jun30?.inMonth).toBe(true);
  });
});
