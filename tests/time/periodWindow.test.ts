import { describe, expect, it } from 'vitest';
import { periodWindow, selectDayInWeek } from '@/app/tid/periodWindow';

// Veckan där felet syntes: måndag 28 september–söndag 4 oktober 2026. September var inlämnad, och
// /tid stod kvar på september även den 2 oktober eftersom månaden togs ur veckans måndag.
const STRADDLING_WEEK = [
  '2026-09-28', '2026-09-29', '2026-09-30',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
];

describe('periodWindow', () => {
  // ⚠️ KÄRNAN. En dag i oktober hör till oktobers period, vilken veckodag månaden än började på.
  it('ger den valda dagens månad, inte måndagens', () => {
    expect(periodWindow(STRADDLING_WEEK, '2026-10-02')).toMatchObject({
      period: '2026-10',
      monthStart: '2026-10-01',
      monthEnd: '2026-10-31',
    });
  });

  it('ger september för en septemberdag i samma vecka', () => {
    expect(periodWindow(STRADDLING_WEEK, '2026-09-29')).toMatchObject({
      period: '2026-09',
      monthStart: '2026-09-01',
      monthEnd: '2026-09-30',
    });
  });

  // Hämtningen måste täcka hela veckan OCH hela månaden, annars tappar remsan eller månadssumman
  // rader på den sida av skiftet som inte är vald.
  it('hämtar veckan och månaden ihop, åt båda hållen', () => {
    expect(periodWindow(STRADDLING_WEEK, '2026-10-02')).toMatchObject({ from: '2026-09-28', to: '2026-10-31' });
    expect(periodWindow(STRADDLING_WEEK, '2026-09-29')).toMatchObject({ from: '2026-09-01', to: '2026-10-04' });
  });

  it('räknar månadens sista dag rätt, skottår inräknat', () => {
    const week = ['2028-02-28', '2028-02-29', '2028-03-01', '2028-03-02', '2028-03-03', '2028-03-04', '2028-03-05'];
    expect(periodWindow(week, '2028-02-29')).toMatchObject({ monthEnd: '2028-02-29', to: '2028-03-05' });
    expect(periodWindow(week, '2028-03-01')).toMatchObject({ monthStart: '2028-03-01', from: '2028-02-28' });
  });

  it('en vecka inne i en månad hämtar bara månaden', () => {
    const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
    expect(periodWindow(week, '2026-10-07')).toEqual({
      from: '2026-10-01', to: '2026-10-31', monthStart: '2026-10-01', monthEnd: '2026-10-31', period: '2026-10',
    });
  });

  it('klarar årsskiftet', () => {
    const week = ['2029-12-31', '2030-01-01', '2030-01-02', '2030-01-03', '2030-01-04', '2030-01-05', '2030-01-06'];
    expect(periodWindow(week, '2030-01-02').period).toBe('2030-01');
    expect(periodWindow(week, '2029-12-31').period).toBe('2029-12');
  });
});

describe('selectDayInWeek', () => {
  // Fredag 2 oktober, sidan öppnad utan genväg: dagen är idag — och därmed oktober.
  it('väljer idag när idag står i veckan och inget annat är valt', () => {
    expect(selectDayInWeek(STRADDLING_WEEK, '2026-10-02', '2026-10-02')).toBe('2026-10-02');
  });

  it('behåller dagen man klickat på', () => {
    expect(selectDayInWeek(STRADDLING_WEEK, '2026-09-29', '2026-10-02')).toBe('2026-09-29');
  });

  it('faller på idag när den valda dagen inte står i veckan', () => {
    expect(selectDayInWeek(STRADDLING_WEEK, '2026-09-21', '2026-10-02')).toBe('2026-10-02');
  });

  it('faller på måndagen i en vecka utan idag', () => {
    expect(selectDayInWeek(STRADDLING_WEEK, '2026-10-09', '2026-10-09')).toBe('2026-09-28');
  });
});
