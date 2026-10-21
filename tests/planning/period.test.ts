import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { DEFAULT_PLANNING_PERIOD, restorePlanningPeriod, serializePlanningPeriod } from '@/app/crm/planering/planningPeriod';
import { parseISO } from '@/app/crm/planering/planningDates';

// Planeringens vy och period över ett sidbyte (William 2026-10-20): in på en order och tillbaka ska
// tavlan stå kvar på samma vecka — samma dag. Sparas som absoluta datum, med dagen den sparades.
//
// ⚠️ TIDSZONEN SÄTTS HÄR. CI kör TZ=UTC, där varje vecka är exakt 168 timmar och ett sommartidsskydd
// prövar ingenting (CLAUDE.md). Node läser om process.env.TZ vid nästa Date-anrop, så datumen nedan
// byggs i Stockholms zon oavsett var testet körs — alltså byggs de INNE i testerna, inte på modulnivå.
const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = 'Europe/Stockholm'; });
afterAll(() => {
  // `process.env.TZ = undefined` hade satt strängen 'undefined', inte tagit bort variabeln.
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const tuesday = () => parseISO('2026-10-20'); // vecka 43, måndag 2026-10-19

describe('serializePlanningPeriod', () => {
  it('förvalet (denna vecka) sparas inte — nyckeln ska tas bort', () => {
    expect(serializePlanningPeriod(DEFAULT_PLANNING_PERIOD, tuesday())).toBeNull();
  });

  it('veckan sparas som sin måndag, månaden som år-månad, med dagen den sparades', () => {
    expect(JSON.parse(serializePlanningPeriod({ view: 'week', weekOffset: 2, monthOffset: 0 }, tuesday())!))
      .toEqual({ week: '2026-11-02', savedOn: '2026-10-20' });
    expect(JSON.parse(serializePlanningPeriod({ view: 'month', weekOffset: 0, monthOffset: 3 }, tuesday())!))
      .toEqual({ view: 'month', month: '2027-01', savedOn: '2026-10-20' });
  });

  // Tavlan hämtar sin period även bakom Insikter — en återkomst dit hade kostat hämtningar i onödan.
  it('Insikter sparas inte som vy', () => {
    expect(serializePlanningPeriod({ view: 'insights', weekOffset: 0, monthOffset: 0 }, tuesday())).toBeNull();
    expect(JSON.parse(serializePlanningPeriod({ view: 'insights', weekOffset: 1, monthOffset: 0 }, tuesday())!)).not.toHaveProperty('view');
  });
});

describe('restorePlanningPeriod', () => {
  it('en rundresa samma dag ger samma period', () => {
    for (const period of [
      { view: 'week' as const, weekOffset: 3, monthOffset: 0 },
      { view: 'week' as const, weekOffset: -1, monthOffset: 0 },
      { view: 'month' as const, weekOffset: 0, monthOffset: -2 },
    ]) {
      expect(restorePlanningPeriod(serializePlanningPeriod(period, tuesday()), tuesday())).toEqual(period);
    }
  });

  // Williams val: en flik som stått öppen över helgen ska öppna på denna vecka, inte på fredagens.
  it('sparad en annan dag gäller inte — förvalet', () => {
    const stored = serializePlanningPeriod({ view: 'month', weekOffset: 2, monthOffset: 3 }, tuesday());
    expect(restorePlanningPeriod(stored, parseISO('2026-10-21'))).toEqual(DEFAULT_PLANNING_PERIOD);
    expect(restorePlanningPeriod(JSON.stringify({ week: '2026-11-02' }), tuesday())).toEqual(DEFAULT_PLANNING_PERIOD);
  });

  // Över sommartidsväxlingen 2026-10-25 (höst) och 2026-03-29 (vår), i Stockholms zon (se överst). En
  // ren millisekunddivision hade gett 2,006 respektive 0,994 veckor.
  it('över en sommartidsväxling blir det hela veckor', () => {
    expect(restorePlanningPeriod(JSON.stringify({ week: '2026-11-02', savedOn: '2026-10-20' }), tuesday()).weekOffset).toBe(2);
    expect(restorePlanningPeriod(JSON.stringify({ week: '2026-03-30', savedOn: '2026-03-24' }), parseISO('2026-03-24')).weekOffset).toBe(1);
  });

  it('en sparad dag som inte är en måndag läses som sin veckas måndag', () => {
    expect(restorePlanningPeriod(JSON.stringify({ week: '2026-11-05', savedOn: '2026-10-20' }), tuesday()).weekOffset).toBe(2);
  });

  it('inget sparat, trasig JSON eller fel form ger förvalet', () => {
    for (const raw of [null, '', '{', '"text"', '42', 'null']) {
      expect(restorePlanningPeriod(raw, tuesday())).toEqual(DEFAULT_PLANNING_PERIOD);
    }
  });

  it('ett ogiltigt fält ger förvalet för just det fältet', () => {
    const at = (value: Record<string, unknown>) => restorePlanningPeriod(JSON.stringify({ ...value, savedOn: '2026-10-20' }), tuesday());
    expect(at({ view: 'kalender', week: '2026-11-02' })).toEqual({ view: 'week', weekOffset: 2, monthOffset: 0 });
    expect(at({ view: 'insights' }).view).toBe('week');
    // parseISO hade rullat 31 februari till mars.
    expect(at({ week: '2026-02-31' }).weekOffset).toBe(0);
    expect(at({ week: 20261102 }).weekOffset).toBe(0);
    expect(at({ view: 'month', month: '2026-13' })).toEqual({ view: 'month', weekOffset: 0, monthOffset: 0 });
    // Date läser år 0–99 som 1900-tal: rubriken och intervallet hade pekat på olika år.
    expect(at({ view: 'month', month: '0050-01' }).monthOffset).toBe(0);
  });
});
