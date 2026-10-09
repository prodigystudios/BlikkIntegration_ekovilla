import { describe, it, expect } from 'vitest';
import { weeklyFromMonthly, GOAL_WEEKS_PER_MONTH, formatLocalDateOnly } from '@/lib/domains/crm/goals';

describe('weeklyFromMonthly', () => {
  it('divides a monthly budget by the fixed weeks-per-month (4)', () => {
    expect(GOAL_WEEKS_PER_MONTH).toBe(4);
    expect(weeklyFromMonthly(40)).toBe(10);
    expect(weeklyFromMonthly(100000)).toBe(25000);
  });

  it('accepts numeric strings (Supabase numeric columns)', () => {
    expect(weeklyFromMonthly('200')).toBe(50);
  });

  it('returns 0 for empty/invalid input', () => {
    expect(weeklyFromMonthly(0)).toBe(0);
    expect(weeklyFromMonthly('')).toBe(0);
    expect(weeklyFromMonthly('abc')).toBe(0);
  });

  it('keeps fractional results (rounding is a display concern)', () => {
    expect(weeklyFromMonthly(50)).toBe(12.5);
  });
});

describe('formatLocalDateOnly', () => {
  it('formats a date as YYYY-MM-DD in local time', () => {
    expect(formatLocalDateOnly(new Date(2026, 5, 1))).toBe('2026-06-01'); // month is 0-indexed → June
    expect(formatLocalDateOnly(new Date(2026, 11, 9))).toBe('2026-12-09');
  });
});

// ---------------------------------------------------------------------------
// getCrmOverviewWindow — fönstret CRM-översikten ber servern räkna inuti
//
// SVENSKA dagar oavsett runtime-zon (William 2026-10-09). Ögonblicken nedan skrivs i UTC med exakt
// klockslag, så skydden biter i varje zon — ett `new Date(2026, 7, 17, …)` hade betytt olika ögonblick
// under TZ=UTC och TZ=Europe/Stockholm, och testet hade prövat olika saker i olika zoner.
// ---------------------------------------------------------------------------

import { getCrmOverviewWindow } from '@/lib/domains/crm/goals';

describe('getCrmOverviewWindow', () => {
  it('en måndag är veckans start samma dag, och slutet nästa måndag', () => {
    // 2026-08-17 är en måndag; 07:30 UTC = 09:30 svensk tid.
    const w = getCrmOverviewWindow(new Date('2026-08-17T07:30:00Z'));
    expect(w).toEqual({ today: '2026-08-17', since: '2026-08-10', weekStart: '2026-08-17', weekEnd: '2026-08-24' });
  });

  it('en söndag kl. 23.59 svensk tid hör till veckan som började föregående måndag', () => {
    const w = getCrmOverviewWindow(new Date('2026-08-23T21:59:00Z'));
    expect(w).toEqual({ today: '2026-08-23', since: '2026-08-16', weekStart: '2026-08-17', weekEnd: '2026-08-24' });
  });

  it('måndag kl. 00.15 svensk tid är den nya veckan, fast UTC fortfarande säger söndag', () => {
    const w = getCrmOverviewWindow(new Date('2026-08-16T22:15:00Z'));
    expect(w).toEqual({ today: '2026-08-17', since: '2026-08-10', weekStart: '2026-08-17', weekEnd: '2026-08-24' });
  });

  it('en läsare i en annan zon får den svenska dagen, inte sin egen', () => {
    // 23.30 söndag i New York (EDT, −4) är måndag 05.30 i Sverige.
    const w = getCrmOverviewWindow(new Date('2026-08-16T23:30:00-04:00'));
    expect(w.today).toBe('2026-08-17');
    expect(w.weekStart).toBe('2026-08-17');
  });

  it('fönstret är sju dagar bakåt och håller över ett månadsskifte', () => {
    const w = getCrmOverviewWindow(new Date('2026-09-03T10:00:00Z'));
    expect(w.today).toBe('2026-09-03');
    expect(w.since).toBe('2026-08-27');
  });

  it('vintertid: sommartidens slut flyttar inte gränserna', () => {
    // Sverige ställer om natten till söndag 2026-10-25. Onsdagen efter ska landa på veckan som
    // började måndagen den 26:e, och `since` sju dagar bak trots att dygnet däremellan var 25 timmar.
    const w = getCrmOverviewWindow(new Date('2026-10-28T07:00:00Z'));
    expect(w).toEqual({ today: '2026-10-28', since: '2026-10-21', weekStart: '2026-10-26', weekEnd: '2026-11-02' });
  });

  it('sommartid: omställningen in i sommartid flyttar inte heller gränserna', () => {
    // 2026-03-29 ställer klockan fram. Måndagen den 30:e ska ge weekEnd 2026-04-06 (23-timmarsdygn
    // i intervallet).
    const w = getCrmOverviewWindow(new Date('2026-03-30T05:00:00Z'));
    expect(w).toEqual({ today: '2026-03-30', since: '2026-03-23', weekStart: '2026-03-30', weekEnd: '2026-04-06' });
  });
});
