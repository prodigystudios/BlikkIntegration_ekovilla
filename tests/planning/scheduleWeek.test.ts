import { describe, it, expect } from 'vitest';
import { defaultScheduleDayIndex, scheduleWeekRange } from '@/lib/domains/planning/scheduleWeek';

// Startsidans arbetsschema läste tidigare `new Date()` med lokala getters. Sidan är force-dynamic,
// alltså server-renderad före hydrering, och servern går på UTC — så mellan 00:00 och 02:00 svensk
// tid satt de två klockorna på olika kalenderdagar. Är den dagen dessutom en MÅNDAG blir det inte en
// dags fel utan en hel veckas: startISO/endISO matar get_my_jobs / get_my_crm_jobs, så installatören
// fick förra veckans jobb serverade och rätt vecka först vid hydreringen.
//
// Assertionerna nedan är oberoende av vilken zon testet självt körs i: allt jämförs som ISO-strängar
// som toISODateLocal läser tillbaka ur precis de lokala fält stockholmToday satte.

describe('scheduleWeekRange', () => {
  it('bygger måndag–söndag för en vanlig vardag', () => {
    // Onsdag 2026-08-12, mitt på dagen — ingen zon i närheten av ett dygnsbyte.
    const range = scheduleWeekRange(0, new Date('2026-08-12T10:00:00Z'));
    expect(range.startISO).toBe('2026-08-10');
    expect(range.endISO).toBe('2026-08-16');
    expect(range.weekNumber).toBe(33);
    expect(range.days).toEqual([
      '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16',
    ]);
  });

  it('⚠️ måndag 01:30 svensk tid ger måndagens vecka, inte föregående (sommartid, UTC+2)', () => {
    // 2026-08-16T23:30Z = måndag 2026-08-17 kl 01:30 i Stockholm.
    // Den gamla koden läste UTC på servern, såg söndag den 16:e och backade en hel vecka.
    const range = scheduleWeekRange(0, new Date('2026-08-16T23:30:00Z'));
    expect(range.startISO).toBe('2026-08-17');
    expect(range.endISO).toBe('2026-08-23');
    expect(range.weekNumber).toBe(34);
  });

  it('⚠️ måndag 00:30 svensk tid ger måndagens vecka även på vintertid (UTC+1)', () => {
    // 2026-01-04T23:30Z = måndag 2026-01-05 kl 00:30 i Stockholm.
    const range = scheduleWeekRange(0, new Date('2026-01-04T23:30:00Z'));
    expect(range.startISO).toBe('2026-01-05');
    expect(range.endISO).toBe('2026-01-11');
  });

  it('bläddrar bakåt och framåt utan att tappa veckolängden', () => {
    const now = new Date('2026-08-12T10:00:00Z');
    expect(scheduleWeekRange(-1, now).startISO).toBe('2026-08-03');
    expect(scheduleWeekRange(-1, now).endISO).toBe('2026-08-09');
    expect(scheduleWeekRange(1, now).startISO).toBe('2026-08-17');
    expect(scheduleWeekRange(1, now).endISO).toBe('2026-08-23');
  });

  it('korsar ett årsskifte med rätt ISO-veckonummer', () => {
    // Torsdag 2026-12-31 ligger i ISO-vecka 53, som börjar måndag den 28:e.
    const range = scheduleWeekRange(0, new Date('2026-12-31T10:00:00Z'));
    expect(range.startISO).toBe('2026-12-28');
    expect(range.endISO).toBe('2027-01-03');
    expect(range.weekNumber).toBe(53);
  });
});

describe('defaultScheduleDayIndex', () => {
  it('väljer dagens vardag, 0=mån..4=fre', () => {
    expect(defaultScheduleDayIndex(new Date('2026-08-10T10:00:00Z'))).toBe(0); // måndag
    expect(defaultScheduleDayIndex(new Date('2026-08-14T10:00:00Z'))).toBe(4); // fredag
  });

  it('väljer "Alla" (null) på helgen', () => {
    expect(defaultScheduleDayIndex(new Date('2026-08-15T10:00:00Z'))).toBeNull(); // lördag
    expect(defaultScheduleDayIndex(new Date('2026-08-16T10:00:00Z'))).toBeNull(); // söndag
  });

  it('⚠️ måndag 01:30 svensk tid väljer måndag, inte helgens "Alla"', () => {
    // Samma instant som veckotestet ovan: UTC säger söndag, Sverige säger måndag.
    expect(defaultScheduleDayIndex(new Date('2026-08-16T23:30:00Z'))).toBe(0);
  });
});
