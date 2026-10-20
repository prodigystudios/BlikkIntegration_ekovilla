import { describe, it, expect } from 'vitest';
import { DEFAULT_PLANNING_PERIOD, restorePlanningPeriod, serializePlanningPeriod } from '@/app/crm/planering/planningPeriod';
import { parseISO } from '@/app/crm/planering/planningDates';

// Planeringens vy och period över ett sidbyte (William 2026-10-20): in på en order och tillbaka ska
// tavlan stå kvar på samma vecka. Sparas som ABSOLUTA datum, aldrig som förskjutningen.

const tuesday = parseISO('2026-10-20'); // vecka 43, måndag 2026-10-19

describe('serializePlanningPeriod', () => {
  it('förvalet (denna vecka) sparas inte — nyckeln ska tas bort', () => {
    expect(serializePlanningPeriod(DEFAULT_PLANNING_PERIOD, tuesday)).toBeNull();
  });

  it('veckan sparas som sin måndag, månaden som år-månad', () => {
    expect(JSON.parse(serializePlanningPeriod({ view: 'week', weekOffset: 2, monthOffset: 0 }, tuesday)!)).toEqual({ week: '2026-11-02' });
    expect(JSON.parse(serializePlanningPeriod({ view: 'month', weekOffset: 0, monthOffset: 3 }, tuesday)!)).toEqual({ view: 'month', month: '2027-01' });
    expect(JSON.parse(serializePlanningPeriod({ view: 'week', weekOffset: -1, monthOffset: 0 }, tuesday)!)).toEqual({ week: '2026-10-12' });
  });
});

describe('restorePlanningPeriod', () => {
  it('en rundresa samma dag ger samma period', () => {
    for (const period of [
      { view: 'week' as const, weekOffset: 3, monthOffset: 0 },
      { view: 'month' as const, weekOffset: 0, monthOffset: -2 },
      { view: 'insights' as const, weekOffset: 0, monthOffset: 0 },
    ]) {
      expect(restorePlanningPeriod(serializePlanningPeriod(period, tuesday), tuesday)).toEqual(period);
    }
  });

  // 🧨 Kärnan: en sparad förskjutning hade pekat på en annan vecka nästa vecka.
  it('läst en annan dag pekar den på SAMMA vecka och månad', () => {
    const stored = serializePlanningPeriod({ view: 'week', weekOffset: 2, monthOffset: 3 }, tuesday);
    const nextWeek = parseISO('2026-10-27');
    expect(restorePlanningPeriod(stored, nextWeek)).toMatchObject({ weekOffset: 1 });
    const nextMonth = parseISO('2026-11-03');
    expect(restorePlanningPeriod(stored, nextMonth)).toMatchObject({ weekOffset: 0, monthOffset: 2 });
  });

  // Över sommartidsväxlingen 2026-10-25 (zonberoende: biter bara i en zon med sommartid, t.ex.
  // Europe/Stockholm — weeksBetweenMondays själv är prövad med explicita timspann i dates.test.ts).
  it('över en sommartidsväxling blir det hela veckor', () => {
    expect(restorePlanningPeriod(JSON.stringify({ week: '2026-11-02' }), tuesday).weekOffset).toBe(2);
    expect(restorePlanningPeriod(JSON.stringify({ week: '2026-03-30' }), parseISO('2026-03-24')).weekOffset).toBe(1);
  });

  it('en sparad dag som inte är en måndag läses som sin veckas måndag', () => {
    expect(restorePlanningPeriod(JSON.stringify({ week: '2026-11-05' }), tuesday).weekOffset).toBe(2);
  });

  it('inget sparat, trasig JSON eller fel form ger förvalet', () => {
    for (const raw of [null, '', '{', '"text"', '42', 'null']) {
      expect(restorePlanningPeriod(raw, tuesday)).toEqual(DEFAULT_PLANNING_PERIOD);
    }
  });

  it('ett ogiltigt fält ger förvalet för just det fältet', () => {
    expect(restorePlanningPeriod(JSON.stringify({ view: 'kalender', week: '2026-11-02' }), tuesday)).toEqual({ view: 'week', weekOffset: 2, monthOffset: 0 });
    // parseISO hade rullat 31 februari till mars.
    expect(restorePlanningPeriod(JSON.stringify({ week: '2026-02-31' }), tuesday).weekOffset).toBe(0);
    expect(restorePlanningPeriod(JSON.stringify({ week: 20261102 }), tuesday).weekOffset).toBe(0);
    expect(restorePlanningPeriod(JSON.stringify({ view: 'month', month: '2026-13' }), tuesday)).toEqual({ view: 'month', weekOffset: 0, monthOffset: 0 });
  });
});
