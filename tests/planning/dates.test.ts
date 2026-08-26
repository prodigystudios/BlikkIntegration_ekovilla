import { describe, it, expect } from 'vitest';
import {
  addDays, addDaysISO, buildMonthWeeks, buildWeekDays, daysBetweenInclusive, fmtISO, isoWeek,
  monthStackStart, parseISO, sectionStart, startOfWeek, stockholmToday, stockholmTodayISO,
  weeksBetweenMondays,
} from '@/app/crm/planering/planningDates';

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

// The board is server-rendered before it hydrates and the server runs on UTC, so "today" must be
// the Swedish calendar day or the two sides disagree between 00:00 and 02:00. These assertions are
// runtime-zone independent: fmtISO reads back the very local fields stockholmToday sets.
describe('stockholmToday / stockholmTodayISO', () => {
  it('uses the Swedish day, not the UTC day, late on a summer evening (CEST, UTC+2)', () => {
    const instant = new Date('2026-08-14T23:30:00Z'); // 01:30 on the 15th in Stockholm
    expect(stockholmTodayISO(instant)).toBe('2026-08-15');
    // What the old `new Date()`-on-the-server path would have produced:
    expect(instant.toISOString().slice(0, 10)).toBe('2026-08-14');
  });

  it('uses the Swedish day in winter too (CET, UTC+1)', () => {
    expect(stockholmTodayISO(new Date('2026-01-14T23:30:00Z'))).toBe('2026-01-15');
    expect(stockholmTodayISO(new Date('2026-01-14T22:30:00Z'))).toBe('2026-01-14');
  });

  it('agrees with UTC during the rest of the day', () => {
    expect(stockholmTodayISO(new Date('2026-08-14T09:00:00Z'))).toBe('2026-08-14');
  });

  it('returns a local-midnight Date the other helpers can walk', () => {
    const day = stockholmToday(new Date('2026-08-14T23:30:00Z'));
    expect([day.getHours(), day.getMinutes(), day.getSeconds()]).toEqual([0, 0, 0]);
    // 15 Aug 2026 is a Saturday → its week starts Monday the 10th. Getting the day wrong here is
    // what pushed the board onto the wrong week on a Monday night.
    expect(startOfWeek(day).getDate()).toBe(10);
  });
});

describe('monthStackStart / weeksBetweenMondays', () => {
  // Mirrors PlanningClient's weekMondays: from a start Monday through the end of that Monday's month.
  function stackWeeks(monday: Date): Date[] {
    const end = new Date(monday);
    end.setMonth(end.getMonth() + 1, 0);
    const out: Date[] = [];
    for (let m = monday; m.getTime() <= end.getTime(); m = addDays(m, 7)) out.push(m);
    return out;
  }

  it('picks the first Monday inside the month, not startOfWeek of the 1st', () => {
    // 1 Sep 2026 is a Tuesday, so startOfWeek lands on 31 Aug — still August. The stack must start
    // on the following Monday, because the straddling week already belongs to August's stack.
    expect(fmtISO(startOfWeek(new Date(2026, 8, 1)))).toBe('2026-08-31');
    expect(fmtISO(monthStackStart(new Date(2026, 8, 15), 0))).toBe('2026-09-07');
    // 1 Jun 2026 is itself a Monday — taken as-is.
    expect(fmtISO(monthStackStart(new Date(2026, 5, 10), 0))).toBe('2026-06-01');
  });

  it('steps whole months and rolls over the year', () => {
    expect(fmtISO(monthStackStart(new Date(2026, 7, 3), 1))).toBe('2026-09-07');
    expect(fmtISO(monthStackStart(new Date(2026, 11, 7), 1))).toBe('2027-01-04');
    expect(fmtISO(monthStackStart(new Date(2027, 0, 4), -1))).toBe('2026-12-07');
  });

  it('tiles consecutive months with no gap and no overlap', () => {
    let monday = monthStackStart(new Date(2026, 7, 1), 0);
    let previousEnd: Date | null = null;
    for (let i = 0; i < 6; i++) {
      const weeks = stackWeeks(monday);
      if (previousEnd) expect(fmtISO(monday)).toBe(fmtISO(addDays(previousEnd, 1)));
      previousEnd = addDays(weeks[weeks.length - 1], 6);
      monday = monthStackStart(monday, 1);
    }
  });

  it('is an exact inverse forward and back, even when month widths differ', () => {
    // August 2026 stacks 5 weeks, September 4 — the case where stepping by the stack's own width
    // skipped a week and left it unreachable from the pager.
    const august = monthStackStart(new Date(2026, 7, 1), 0);
    expect(stackWeeks(august)).toHaveLength(5);
    const september = monthStackStart(august, 1);
    expect(stackWeeks(september)).toHaveLength(4);
    expect(fmtISO(monthStackStart(september, -1))).toBe(fmtISO(august));
  });

  it('counts a DST week as one week, in any runner timezone', () => {
    // ⚠️ Built from an explicit hour span, NOT from two calendar dates. A DST week only spans 167
    // or 169 hours when the RUNNER's own zone observes DST — under TZ=UTC (which CI and Vercel
    // default to) every week is exactly 168 hours and the rounding is never exercised. Two real
    // dates would make this guard silently inert there; see tests/planning/scheduleWeek.test.ts
    // for the same trap left documented rather than closed.
    //
    // Both spans fail the naive (to - from) / (7 * 86_400_000): they give 1.006 and 0.994.
    const monday = startOfWeek(new Date(2026, 9, 19));
    const autumn = new Date(monday.getTime() + 169 * 3_600_000); // clock back one hour
    const spring = new Date(monday.getTime() + 167 * 3_600_000); // clock forward one hour
    expect(weeksBetweenMondays(monday, autumn)).toBe(1);
    expect(weeksBetweenMondays(monday, spring)).toBe(1);
    expect(weeksBetweenMondays(autumn, monday)).toBe(-1);
  });

  it('steps whole weeks across Sweden\'s real October transition', () => {
    // ⚠️ Only bites in a runner whose own zone has DST; verified under Europe/Stockholm and
    // America/New_York. The guard above is the one that holds everywhere.
    const before = startOfWeek(new Date(2026, 9, 19));
    expect(weeksBetweenMondays(before, startOfWeek(new Date(2026, 9, 26)))).toBe(1);
    expect(weeksBetweenMondays(before, monthStackStart(before, 1))).toBe(2);
  });
});

describe('sectionStart', () => {
  it('steps forward to the next month\'s stack start', () => {
    expect(fmtISO(sectionStart(new Date(2026, 7, 3), 1))).toBe('2026-09-07');
  });

  it('returns to the current stack start when standing mid-stack', () => {
    // 24 Aug 2026 is a Monday inside August but not August's stack start (3 Aug), which is the
    // normal landing state — today's Monday is rarely the month's first. Stepping a whole month
    // from here would skip 3–23 Aug and leave those weeks unreachable from the pager.
    expect(fmtISO(sectionStart(new Date(2026, 7, 24), -1))).toBe('2026-08-03');
  });

  it('moves to the previous month only from the stack start', () => {
    expect(fmtISO(sectionStart(new Date(2026, 7, 3), -1))).toBe('2026-07-06');
  });

  it('is an exact inverse between stack starts', () => {
    const august = monthStackStart(new Date(2026, 7, 1), 0);
    const september = sectionStart(august, 1);
    expect(fmtISO(sectionStart(september, -1))).toBe(fmtISO(august));
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
