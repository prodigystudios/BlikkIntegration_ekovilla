import { describe, it, expect } from 'vitest';
import {
  stockholmDay,
  dayString,
  startOfWeek,
  today,
  reportRange,
  daysInRange,
  previousRange,
  reportPeriodEnd,
  REPORT_RANGE_LABELS,
} from '@/app/crm/rapportering/reportRanges';

// Fixtures are explicit UTC instants, never local-time constructors: the module pins the
// zone to Europe/Stockholm, so these assertions hold on a developer's machine, on the
// UTC server that renders the page, and in CI alike.
const utc = (iso: string) => new Date(iso);

// Midday UTC is the same calendar day in Sweden year-round — the boring case.
const midday = (date: string) => utc(`${date}T12:00:00Z`);

describe('stockholmDay', () => {
  it('resolves a midday instant to that calendar day', () => {
    expect(dayString(stockholmDay(midday('2026-08-14')))).toBe('2026-08-14');
  });

  it('counts 00:30 Swedish summer time as the new day, though UTC is still on the old one', () => {
    // CEST is UTC+2, so 2026-08-13T22:30Z is 2026-08-14 00:30 in Sweden.
    expect(dayString(stockholmDay(utc('2026-08-13T22:30:00Z')))).toBe('2026-08-14');
  });

  it('counts 00:30 Swedish winter time as the new day', () => {
    // CET is UTC+1, so 2026-01-05T23:30Z is 2026-01-06 00:30 in Sweden.
    expect(dayString(stockholmDay(utc('2026-01-05T23:30:00Z')))).toBe('2026-01-06');
  });

  it('still counts 23:30 Swedish time as the old day', () => {
    expect(dayString(stockholmDay(utc('2026-08-14T21:30:00Z')))).toBe('2026-08-14');
  });

  it('rolls the month over at Swedish midnight, not UTC midnight', () => {
    // 2026-07-31T22:30Z is 2026-08-01 00:30 in Sweden.
    expect(dayString(stockholmDay(utc('2026-07-31T22:30:00Z')))).toBe('2026-08-01');
  });

  it('zero-pads month and day', () => {
    expect(dayString(stockholmDay(midday('2026-01-05')))).toBe('2026-01-05');
  });
});

describe('today', () => {
  it('is the Swedish date, not the UTC one, just after local midnight', () => {
    expect(today(utc('2026-08-13T22:30:00Z'))).toBe('2026-08-14');
  });
});

describe('startOfWeek', () => {
  const weekOf = (date: string) => dayString(startOfWeek(stockholmDay(midday(date))));

  it('returns Monday for a midweek day', () => {
    expect(weekOf('2026-08-14')).toBe('2026-08-10'); // Friday → Monday
  });

  it('returns the same day when it is already Monday', () => {
    expect(weekOf('2026-08-10')).toBe('2026-08-10');
  });

  it('looks back six days on Sunday rather than forward one', () => {
    expect(weekOf('2026-08-16')).toBe('2026-08-10'); // Sunday belongs to the week that began the 10th
  });

  it('crosses a month boundary', () => {
    expect(weekOf('2026-09-02')).toBe('2026-08-31'); // Wednesday whose Monday is in August
  });

  it('crosses a year boundary', () => {
    expect(weekOf('2027-01-01')).toBe('2026-12-28'); // Friday whose Monday is in December
  });
});

describe('reportRange', () => {
  const now = midday('2026-08-14'); // Friday

  it('runs this week from Monday to today', () => {
    expect(reportRange('week', now)).toEqual({ from: '2026-08-10', to: '2026-08-14' });
  });

  it('runs this month from the 1st to today', () => {
    expect(reportRange('month', now)).toEqual({ from: '2026-08-01', to: '2026-08-14' });
  });

  it('runs the previous month end to end, not up to today', () => {
    expect(reportRange('prevMonth', now)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('handles February in a leap year as the previous month', () => {
    expect(reportRange('prevMonth', midday('2028-03-10'))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('rolls the previous month back into the prior year in January', () => {
    expect(reportRange('prevMonth', midday('2026-01-09'))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('runs this year from January 1st to today', () => {
    expect(reportRange('year', now)).toEqual({ from: '2026-01-01', to: '2026-08-14' });
  });

  it('runs the last 12 months from the 1st eleven months back, so the chart fills twelve buckets', () => {
    expect(reportRange('last12', now)).toEqual({ from: '2025-09-01', to: '2026-08-14' });
  });

  it('never ends in the future for any open-ended preset', () => {
    for (const key of ['week', 'month', 'year', 'last12'] as const) {
      expect(reportRange(key, now).to).toBe('2026-08-14');
    }
  });

  it('never starts after it ends', () => {
    for (const [key] of REPORT_RANGE_LABELS) {
      const range = reportRange(key, now);
      expect(range.from <= range.to).toBe(true);
    }
  });

  it('produces a valid single-day week on a Monday, where a Sunday-start week would invert', () => {
    expect(reportRange('week', midday('2026-08-10'))).toEqual({ from: '2026-08-10', to: '2026-08-10' });
  });

  it('uses the Swedish day just after local midnight, so the range does not lag by one', () => {
    // 2026-08-09T22:30Z is Monday 2026-08-10 00:30 in Sweden — the first minutes of a new week.
    expect(reportRange('week', utc('2026-08-09T22:30:00Z'))).toEqual({ from: '2026-08-10', to: '2026-08-10' });
  });

  it('covers every preset key exactly once in the label list', () => {
    const keys = REPORT_RANGE_LABELS.map(([key]) => key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['week', 'month', 'prevMonth', 'year', 'last12']);
  });
});

// ── Jämförelseperioden ───────────────────────────────────────────────────────
//
// Två invarianter bär hela jämförelsetalet, och båda går fel tyst:
//
//   1. jämförelseperioden är LIKA LÅNG som perioden — annars jämförs en hel månad med en halv
//      och skillnaden presenteras som en utveckling
//   2. den slutar dagen INNAN perioden börjar — en dags överlapp dubbelräknar en dags försäljning
//      i båda leden
//
// ⚠️ Testerna nedan är skrivna ur EXPLICITA DYGNSSPANN, inte ur klockslag. `vitest.config.ts`
// pinnar ingen TZ, så under TZ=UTC (CI och Vercel) är varje dygn exakt 24 timmar och en
// sommartidsbugg aldrig utsatt. Spannen nedan korsar båda svenska växlingarna 2026 —
// 29 mars (klockan fram) och 25 oktober (klockan tillbaka) — så de biter i alla zoner.

describe('daysInRange', () => {
  it('räknar båda ändarna', () => {
    expect(daysInRange({ from: '2026-09-01', to: '2026-09-22' })).toBe(22);
  });

  it('en dag är en dag', () => {
    expect(daysInRange({ from: '2026-09-01', to: '2026-09-01' })).toBe(1);
  });

  it('håller över VÅRENS växling — dygnet som bara har 23 timmar', () => {
    // 29 mars 2026 går klockan fram i Sverige. En naiv millisekundsdivision i lokal zon ger
    // 6,958 dagar här, vilket avrundat nedåt blir 6 och en dag försvinner ur nämnaren.
    expect(daysInRange({ from: '2026-03-23', to: '2026-03-29' })).toBe(7);
  });

  it('håller över HÖSTENS växling — dygnet som har 25 timmar', () => {
    // 25 oktober 2026 går klockan tillbaka. Samma division ger 7,042 dagar.
    expect(daysInRange({ from: '2026-10-19', to: '2026-10-25' })).toBe(7);
  });

  it('ett bakvänt intervall ger 0, inte ett negativt antal dagar', () => {
    expect(daysInRange({ from: '2026-09-22', to: '2026-09-01' })).toBe(0);
  });
});

describe('previousRange', () => {
  it('är lika lång och slutar dagen innan perioden börjar', () => {
    expect(previousRange({ from: '2026-09-01', to: '2026-09-22' }))
      .toEqual({ from: '2026-08-10', to: '2026-08-31' });
  });

  it('en hel månad jämförs med de lika många dagarna dessförinnan', () => {
    // Augusti har 31 dagar; de 31 föregående sträcker sig in i juli. Att i stället ta "hela juli"
    // hade jämfört 31 dagar med 31 — av en slump — men 28 med 31 i februari.
    expect(previousRange({ from: '2026-08-01', to: '2026-08-31' }))
      .toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('februari jämförs med 28 dagar, inte med januaris 31', () => {
    expect(previousRange({ from: '2026-02-01', to: '2026-02-28' }))
      .toEqual({ from: '2026-01-04', to: '2026-01-31' });
  });

  it('rullar bakåt över ett årsskifte', () => {
    expect(previousRange({ from: '2026-01-01', to: '2026-01-31' }))
      .toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  for (const range of [
    { from: '2026-03-23', to: '2026-03-29' }, // korsar vårens växling
    { from: '2026-10-19', to: '2026-10-25' }, // korsar höstens växling
    { from: '2026-01-01', to: '2026-12-31' }, // ett helt år
    { from: '2026-09-22', to: '2026-09-22' }, // en enda dag
  ]) {
    it(`håller invarianterna för ${range.from}–${range.to}`, () => {
      const previous = previousRange(range)!;
      expect(previous).not.toBeNull();
      // Lika lång.
      expect(daysInRange(previous)).toBe(daysInRange(range));
      // Slutar dagen innan, alltså inget överlapp och inget glapp.
      expect(previous.to < range.from).toBe(true);
      expect(daysInRange({ from: previous.to, to: range.from })).toBe(2);
    });
  }

  it('ett intervall som inte går att räkna på ger null, inte ett påhittat datum', () => {
    expect(previousRange({ from: '2026-09-22', to: '2026-09-01' })).toBeNull();
    expect(previousRange({ from: 'inte-ett-datum', to: '2026-09-01' })).toBeNull();
  });
});

// ── Periodens kalenderslut ───────────────────────────────────────────────────
//
// Finns bara för att gränssnittet ska kunna SÄGA att resten av perioden inte räknas — planerat
// arbete ligger i framtiden, men perioden slutar idag. Se kommentaren vid reportPeriodEnd.

describe('reportPeriodEnd', () => {
  const wednesday = midday('2026-09-23'); // onsdag

  it('veckan slutar på söndagen, inte idag', () => {
    expect(reportPeriodEnd('week', wednesday)).toBe('2026-09-27');
    // Rapportens egen period slutar samma dag man tittar.
    expect(reportRange('week', wednesday).to).toBe('2026-09-23');
  });

  it('månaden slutar på sista dagen', () => {
    expect(reportPeriodEnd('month', wednesday)).toBe('2026-09-30');
  });

  it('februari i skottår slutar den 29:e', () => {
    expect(reportPeriodEnd('month', midday('2028-02-10'))).toBe('2028-02-29');
  });

  it('december rullar inte över till nästa år', () => {
    expect(reportPeriodEnd('month', midday('2026-12-10'))).toBe('2026-12-31');
  });

  it('året slutar den 31 december', () => {
    expect(reportPeriodEnd('year', wednesday)).toBe('2026-12-31');
  });

  it('en söndag har inget kalenderslut KVAR — periodslutet är samma dag', () => {
    // Noten ska inte visas då; anroparen jämför mot range.to.
    const sunday = midday('2026-09-27');
    expect(reportPeriodEnd('week', sunday)).toBe(reportRange('week', sunday).to);
  });

  it('rullande och avslutade perioder har inget senare slut', () => {
    // "Senaste 12 mån" slutar per definition nu; "Förra månaden" är redan färdig.
    expect(reportPeriodEnd('last12', wednesday)).toBeNull();
    expect(reportPeriodEnd('prevMonth', wednesday)).toBeNull();
  });

  it('kalenderslutet ligger ALDRIG före periodens slut', () => {
    for (const [key] of REPORT_RANGE_LABELS) {
      const end = reportPeriodEnd(key, wednesday);
      if (end == null) continue;
      expect(end >= reportRange(key, wednesday).to).toBe(true);
    }
  });
});
