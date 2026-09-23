import { describe, it, expect } from 'vitest';
import { buildTimeReport, unavailableTimeReport, type TimeReportEntryRow } from '@/lib/domains/time/report';
import { rowMinutes } from '@/lib/domains/time/hours';

// Rapporteringens tidsdel. Fyra regler bär siffran, och alla fyra går fel TYST:
//
//   1. minutes_worked är sanningen, hours är FALLBACKEN — en mappning som läser minuter rakt av
//      gör kontorets gamla rader till noll timmar, och felet ser ut som ett tomt underlag
//   2. en rad som varken har minuter eller timmar är ett KÄNT HÅL, aldrig noll
//   3. frånvaro är INTE arbetad tid och får aldrig ingå i workedMinutes
//   4. saknat internprojekt / saknad frånvaroorsak är en egen hink som ska SYNAS

const entry = (over: Partial<TimeReportEntryRow> & { work_date: string }): TimeReportEntryRow => ({
  user_id: 'u1',
  kind: 'work_order',
  minutes_worked: 480,
  ...over,
});

const people = [{ id: 'u1', full_name: 'Anna Andersson' }, { id: 'u2', full_name: 'Bo Bengtsson' }];
const september = { from: '2026-09-01', to: '2026-09-30' };
const build = (entries: TimeReportEntryRow[], months = ['2026-09']) =>
  buildTimeReport({ entries, people, range: september, months });

describe('rowMinutes — den delade regeln', () => {
  it('minutes_worked vinner när den finns', () => {
    expect(rowMinutes({ minutes_worked: 480, hours: 99 })).toBe(480);
  });

  it('hours är fallbacken när minuter saknas', () => {
    // 🧨 TIME_AND_PAYROLL.md → Fällor: kolumnen lades till utan backfill, och kontorets gamla
    // Tid-flik skrev bara `hours`. En mappning utan fallbacken gör de raderna till noll timmar.
    expect(rowMinutes({ minutes_worked: null, hours: 7.5 })).toBe(450);
  });

  it('numeric som STRÄNG ur PostgREST räknas rätt', () => {
    expect(rowMinutes({ minutes_worked: null, hours: '7.5' })).toBe(450);
  });

  it('varken minuter eller timmar ger null — "vi vet inte", inte noll', () => {
    expect(rowMinutes({ minutes_worked: null, hours: null })).toBeNull();
    expect(rowMinutes({})).toBeNull();
  });

  it('0 minuter är ett SVAR, inte ett saknat värde', () => {
    expect(rowMinutes({ minutes_worked: 0 })).toBe(0);
  });
});

describe('buildTimeReport — summorna', () => {
  it('delar timmarna på arbetsorder, internt och frånvaro', () => {
    const result = build([
      entry({ work_date: '2026-09-07', kind: 'work_order', minutes_worked: 480 }),
      entry({ work_date: '2026-09-08', kind: 'internal', minutes_worked: 120, internal_project_name: 'Administration' }),
      entry({ work_date: '2026-09-09', kind: 'absence', minutes_worked: 480, absence_reason: 'Semester' }),
    ]);
    expect(result.workOrderMinutes).toBe(480);
    expect(result.internalMinutes).toBe(120);
    expect(result.absenceMinutes).toBe(480);
  });

  it('FRÅNVARO ÄR INTE ARBETAD TID', () => {
    // Räknas semestern som arbetad tid ser en semestervecka ut som en produktiv vecka.
    const result = build([
      entry({ work_date: '2026-09-07', kind: 'work_order', minutes_worked: 480 }),
      entry({ work_date: '2026-09-09', kind: 'absence', minutes_worked: 480, absence_reason: 'Semester' }),
    ]);
    expect(result.workedMinutes).toBe(480);
    expect(result.workedMinutes).not.toBe(960);
  });

  it('faller tillbaka på hours och räknar raden — inte noll', () => {
    const result = build([entry({ work_date: '2026-09-07', minutes_worked: null, hours: 7.5 })]);
    expect(result.workOrderMinutes).toBe(450);
    expect(result.entries).toBe(1);
    expect(result.unreadableEntries).toBe(0);
  });

  it('en oläsbar rad redovisas som ett HÅL, inte som noll timmar', () => {
    const result = build([
      entry({ work_date: '2026-09-07', minutes_worked: 480 }),
      entry({ work_date: '2026-09-08', minutes_worked: null, hours: null }),
    ]);
    expect(result.workOrderMinutes).toBe(480);
    expect(result.entries).toBe(1);
    expect(result.unreadableEntries).toBe(1);
  });

  it('rader utanför perioden räknas inte', () => {
    const result = build([
      entry({ work_date: '2026-08-31', minutes_worked: 480 }),
      entry({ work_date: '2026-09-07', minutes_worked: 480 }),
      entry({ work_date: '2026-10-01', minutes_worked: 480 }),
    ]);
    expect(result.workOrderMinutes).toBe(480);
    expect(result.entries).toBe(1);
  });

  it('okänd kind räknas som internt — timmarna får inte försvinna ur totalen', () => {
    const result = build([entry({ work_date: '2026-09-07', kind: 'nagot_nytt', minutes_worked: 300 })]);
    expect(result.internalMinutes).toBe(300);
    expect(result.workedMinutes).toBe(300);
  });
});

describe('buildTimeReport — fördelningen', () => {
  it('bucketar per månad och behåller tomma månader i axeln', () => {
    const result = buildTimeReport({
      entries: [
        entry({ work_date: '2026-08-10', kind: 'work_order', minutes_worked: 60 }),
        entry({ work_date: '2026-10-05', kind: 'internal', minutes_worked: 120 }),
      ],
      people,
      range: { from: '2026-08-01', to: '2026-10-31' },
      months: ['2026-08', '2026-09', '2026-10'],
    });
    expect(result.byMonth).toEqual([
      { period: '2026-08', workOrderMinutes: 60, internalMinutes: 0, absenceMinutes: 0 },
      { period: '2026-09', workOrderMinutes: 0, internalMinutes: 0, absenceMinutes: 0 },
      { period: '2026-10', workOrderMinutes: 0, internalMinutes: 120, absenceMinutes: 0 },
    ]);
  });

  it('summerar per person, sorterat på arbetad tid', () => {
    const result = build([
      entry({ work_date: '2026-09-07', user_id: 'u1', minutes_worked: 120 }),
      entry({ work_date: '2026-09-07', user_id: 'u2', minutes_worked: 480 }),
      entry({ work_date: '2026-09-08', user_id: 'u2', kind: 'absence', minutes_worked: 480, absence_reason: 'VAB' }),
    ]);
    expect(result.byPerson.map((p) => [p.userName, p.workedMinutes])).toEqual([
      ['Bo Bengtsson', 480],
      ['Anna Andersson', 120],
    ]);
    // Frånvaron ligger på personen men INTE i hens arbetade tid.
    expect(result.byPerson[0].absenceMinutes).toBe(480);
    expect(result.people).toBe(2);
  });

  it('en person utan namn får en etikett, inte en tom rad', () => {
    const result = build([entry({ work_date: '2026-09-07', user_id: 'okand-id', minutes_worked: 60 })]);
    expect(result.byPerson[0].userName).toBe('Okänd användare');
  });

  it('interntid utan projekt blir en EGEN hink som ligger sist', () => {
    const result = build([
      entry({ work_date: '2026-09-07', kind: 'internal', minutes_worked: 60, internal_project_name: 'Administration' }),
      entry({ work_date: '2026-09-08', kind: 'internal', minutes_worked: 600, internal_project_name: null }),
      entry({ work_date: '2026-09-09', kind: 'internal', minutes_worked: 30, internal_project_name: '  ' }),
    ]);
    // Namnlös hink sist trots att den är störst — en lucka konkurrerar inte om toppen.
    expect(result.byInternalProject).toEqual([
      { label: 'Administration', minutes: 60 },
      { label: null, minutes: 630 },
    ]);
  });

  it('frånvaro utan orsak SYNS — det är ett ifyllnadsfel någon ska rätta', () => {
    const result = build([
      entry({ work_date: '2026-09-07', kind: 'absence', minutes_worked: 480, absence_reason: null }),
    ]);
    expect(result.byAbsenceReason).toEqual([{ label: null, minutes: 480 }]);
  });

  it('bara interntid hamnar i projektlistan, bara frånvaro i orsakslistan', () => {
    const result = build([
      entry({ work_date: '2026-09-07', kind: 'work_order', minutes_worked: 480, internal_project_name: 'Administration' }),
      entry({ work_date: '2026-09-08', kind: 'absence', minutes_worked: 480, absence_reason: 'Semester' }),
    ]);
    expect(result.byInternalProject).toEqual([]);
    expect(result.byAbsenceReason).toEqual([{ label: 'Semester', minutes: 480 }]);
  });
});

describe('unavailableTimeReport', () => {
  it('är skilt från "inget rapporterat" — flaggan måste följa med', () => {
    const result = unavailableTimeReport(['2026-09']);
    expect(result.unavailable).toBe(true);
    expect(result.workedMinutes).toBe(0);
    expect(result.byMonth).toHaveLength(1);
  });
});
