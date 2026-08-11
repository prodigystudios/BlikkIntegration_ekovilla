import { describe, it, expect } from 'vitest';
import { grossMinutes, minutesToHours, parseClock, workedMinutes } from '@/lib/domains/time/hours';

// Arbetad tid ur klockslag. Byrån härleder övertid och OB själv ur klockslagen, så det enda vi
// måste få rätt är summan efter rastavdrag — och den är hennes uttryckliga krav.

describe('parseClock', () => {
  it('läser både HH:MM och Postgres HH:MM:SS', () => {
    expect(parseClock('07:30')).toBe(450);
    expect(parseClock('07:30:00')).toBe(450);
    expect(parseClock('00:00')).toBe(0);
    expect(parseClock('23:59')).toBe(1439);
  });

  it('svarar null på skräp i stället för att gissa', () => {
    for (const value of [null, undefined, '', 'sju', '25:00', '07:99']) {
      expect(parseClock(value as any)).toBeNull();
    }
  });
});

describe('grossMinutes', () => {
  it('räknar ett vanligt pass', () => {
    expect(grossMinutes('08:00', '18:00')).toBe(600);
  });

  // end <= start betyder midnattspassage. Inget extra fält behövs, och passet ligger ändå helt på
  // sitt workDate — annars kan halva passet vara attesterat och halva inte.
  it('räknar ett pass som passerar midnatt', () => {
    expect(grossMinutes('22:00', '06:00')).toBe(480);
    expect(grossMinutes('23:30', '00:30')).toBe(60);
  });

  it('svarar null när ett klockslag saknas', () => {
    expect(grossMinutes(null, '16:00')).toBeNull();
    expect(grossMinutes('08:00', null)).toBeNull();
  });
});

describe('workedMinutes', () => {
  const shift = (over: Partial<Parameters<typeof workedMinutes>[0]> = {}) => ({
    workDate: '2026-08-11', startTime: '08:00', endTime: '18:00', breakMinutes: 0, ...over,
  });

  // ⚠️ LÖNEBYRÅNS EGET EXEMPEL, ordagrant: "om någon har börjat kl. 8 och slutar kl 18 så får det
  // inte stå 10 arbetade timmar om de tagit en timmes rast under dagen, utan det måste stå 9".
  it('drar av rasten — 08:00–18:00 med en timmes rast är 9 timmar, inte 10', () => {
    expect(minutesToHours(workedMinutes(shift({ breakMinutes: 60 })))).toBe(9);
    expect(minutesToHours(workedMinutes(shift({ breakMinutes: 0 })))).toBe(10);
  });

  it('drar av rasten även över midnatt', () => {
    expect(workedMinutes(shift({ startTime: '22:00', endTime: '06:00', breakMinutes: 30 }))).toBe(450);
  });

  it('blir aldrig negativ när rasten är längre än passet', () => {
    expect(workedMinutes(shift({ startTime: '08:00', endTime: '09:00', breakMinutes: 120 }))).toBe(0);
  });

  // Frånvarorader anges i timmar utan klockslag ("Frånvarotimmar" i byråns layout), och gamla
  // kontorsrader har inga klockslag alls.
  it('faller tillbaka på minuter när klockslag saknas', () => {
    expect(workedMinutes(shift({ startTime: null, endTime: null, minutesWorked: 300 }))).toBe(300);
  });

  it('ger noll, inte NaN, när varken klockslag eller minuter finns', () => {
    expect(workedMinutes(shift({ startTime: null, endTime: null }))).toBe(0);
  });
});

describe('minutesToHours', () => {
  it('avrundar till två decimaler', () => {
    expect(minutesToHours(510)).toBe(8.5);
    expect(minutesToHours(485)).toBe(8.08);
    expect(minutesToHours(0)).toBe(0);
  });
});
