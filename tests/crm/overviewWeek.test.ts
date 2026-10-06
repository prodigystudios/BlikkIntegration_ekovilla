import { describe, it, expect } from 'vitest';
import { parseWeekParam, scoreboardWindowFor, shiftWeek } from '@/app/crm/components/overview/overviewWeek';

// Översiktens veckobyte: ?vecka=… tillbaka, veckostegen och vilken dag som väljer månadsbudget för
// en tidigare vecka. Allt räknas på ÅÅÅÅ-MM-DD-strängar, så testerna gäller i varje tidszon.

describe('parseWeekParam', () => {
  it('tar emot en måndag', () => {
    expect(parseWeekParam('2026-09-28')).toBe('2026-09-28');
  });

  it('en annan veckodag är ingen vecka', () => {
    expect(parseWeekParam('2026-09-30')).toBeNull();
  });

  // Rundgången: 2026-02-30 hade blivit 2 mars.
  it('fäller datum som har rätt form men inte finns', () => {
    expect(parseWeekParam('2026-02-30')).toBeNull();
    expect(parseWeekParam('2026-13-02')).toBeNull();
  });

  it('skräp och ingenting ger denna vecka', () => {
    expect(parseWeekParam('förra')).toBeNull();
    expect(parseWeekParam('')).toBeNull();
    expect(parseWeekParam(null)).toBeNull();
  });
});

describe('shiftWeek', () => {
  // Sommartiden slutar 25 okt och börjar 29 mars 2026: veckan över växlingen är 169 respektive 167
  // timmar. Strängaritmetiken ska ändå landa på nästa måndag.
  it('landar på måndagen över en sommartidsväxling, åt båda hållen', () => {
    expect(shiftWeek('2026-10-19', 1)).toBe('2026-10-26');
    expect(shiftWeek('2026-10-26', -1)).toBe('2026-10-19');
    expect(shiftWeek('2026-03-23', 1)).toBe('2026-03-30');
  });

  it('över ett årsskifte', () => {
    expect(shiftWeek('2026-12-28', 1)).toBe('2027-01-04');
    expect(shiftWeek('2027-01-04', -1)).toBe('2026-12-28');
  });
});

describe('scoreboardWindowFor', () => {
  const CURRENT = { today: '2026-10-06', weekStart: '2026-10-05', weekEnd: '2026-10-12' };

  it('denna vecka behåller läsarens egen dag', () => {
    expect(scoreboardWindowFor('2026-10-05', CURRENT)).toEqual(CURRENT);
  });

  // Dagen väljer månadsbudget. Veckan 28 sep–4 okt har fyra dagar i oktober: torsdagen 1 okt.
  it('en tidigare vecka mäts mot torsdagens månad', () => {
    expect(scoreboardWindowFor('2026-09-28', CURRENT)).toEqual({ weekStart: '2026-09-28', weekEnd: '2026-10-05', today: '2026-10-01' });
  });

  it('fönstret är exakt en vecka — rutten avvisar allt annat', () => {
    const { weekStart, weekEnd } = scoreboardWindowFor('2026-10-19', CURRENT);
    expect([weekStart, weekEnd]).toEqual(['2026-10-19', '2026-10-26']);
  });
});
