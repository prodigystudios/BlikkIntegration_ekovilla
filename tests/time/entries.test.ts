import { describe, it, expect } from 'vitest';
import { buildTimeEntryRow, type TimeEntryInput } from '@/lib/domains/time/entries';

// Regeln som gör underlaget trovärdigt: servern räknar minuterna, klienten får inte bestämma dem.
// I dagens Blikk-flöde räknar webbläsaren timmarna och servern skickar dem vidare som sanning.

const ANNA = 'anna-uuid';

const work = (over: Partial<TimeEntryInput> = {}): TimeEntryInput => ({
  kind: 'work_order',
  work_date: '2026-08-11',
  work_order_id: 'wo-1',
  start_time: '08:00',
  end_time: '18:00',
  break_minutes: 60,
  ...over,
});

describe('buildTimeEntryRow — arbetstid', () => {
  it('räknar minuterna ur klockslagen, inte ur något klienten skickar', () => {
    const built = buildTimeEntryRow(work(), ANNA);
    expect(built.error).toBeNull();
    expect(built.row!.minutes_worked).toBe(540); // 10 h minus en timmes rast
  });

  // `hours` skrivs av en databastrigger ur minuterna. Skickas den med härifrån skrivs den ändå
  // över — raden får aldrig bära en timsumma som inte hör ihop med klockslagen.
  it('skickar aldrig med hours', () => {
    expect(buildTimeEntryRow(work(), ANNA).row).not.toHaveProperty('hours');
  });

  it('kräver båda klockslagen', () => {
    expect(buildTimeEntryRow(work({ start_time: null }), ANNA).error).toBe('Start- och sluttid krävs');
    expect(buildTimeEntryRow(work({ end_time: null }), ANNA).error).toBe('Start- och sluttid krävs');
  });

  // Noll minuter är inte en giltig tidrad — den skulle passera som "rapporterad" utan att bära
  // någon tid, och tabellens CHECK (minutes_worked > 0) hade avvisat den med ett rått fel.
  it('avvisar en rast som är längre än eller lika lång som passet', () => {
    expect(buildTimeEntryRow(work({ start_time: '08:00', end_time: '09:00', break_minutes: 120 }), ANNA).error)
      .toBe('Rasten kan inte vara längre än arbetstiden');
    expect(buildTimeEntryRow(work({ start_time: '08:00', end_time: '09:00', break_minutes: 60 }), ANNA).error)
      .toBe('Rasten kan inte vara längre än arbetstiden');
  });

  it('räknar ett pass över midnatt', () => {
    expect(buildTimeEntryRow(work({ start_time: '22:00', end_time: '06:00', break_minutes: 0 }), ANNA).row!.minutes_worked)
      .toBe(480);
  });

  it('kräver ett mål', () => {
    expect(buildTimeEntryRow(work({ work_order_id: null }), ANNA).error).toBe('Välj arbetsorder');
    expect(buildTimeEntryRow({ ...work(), kind: 'internal', internal_project_id: null }, ANNA).error)
      .toBe('Välj internprojekt');
  });

  // Speglar CHECK:en i databasen: `kind` binder vilket mål som får vara ifyllt. Skickar formuläret
  // med ett gammalt värde från en annan flik ska det nollas, inte sparas.
  it('nollar mål som inte hör till den valda sorten', () => {
    const built = buildTimeEntryRow(
      { ...work(), internal_project_id: 'ip-1', absence_type_id: 'at-1' },
      ANNA,
    );
    expect(built.row!.internal_project_id).toBeNull();
    expect(built.row!.absence_type_id).toBeNull();
    expect(built.row!.work_order_id).toBe('wo-1');
  });
});

describe('buildTimeEntryRow — frånvaro', () => {
  const absence = (over: Partial<TimeEntryInput> = {}): TimeEntryInput => ({
    kind: 'absence',
    work_date: '2026-08-11',
    absence_type_id: 'vab',
    hours: 4,
    ...over,
  });

  // Byrån vill ha frånvaro i TIMMAR, inte som ett pass. En halv dag VAB är fyra timmar,
  // inte 08:00–12:00.
  it('anges i timmar och får inga klockslag', () => {
    const built = buildTimeEntryRow(absence(), ANNA);
    expect(built.row!.minutes_worked).toBe(240);
    expect(built.row!.start_time).toBeNull();
    expect(built.row!.end_time).toBeNull();
    expect(built.row!.break_minutes).toBe(0);
  });

  it('klarar halvtimmar', () => {
    expect(buildTimeEntryRow(absence({ hours: 7.5 }), ANNA).row!.minutes_worked).toBe(450);
  });

  it('kräver ett positivt antal timmar', () => {
    for (const hours of [0, -1, null, undefined, NaN]) {
      expect(buildTimeEntryRow(absence({ hours: hours as any }), ANNA).error).toBe('Ange antal frånvarotimmar');
    }
  });

  it('kräver en orsak', () => {
    expect(buildTimeEntryRow(absence({ absence_type_id: null }), ANNA).error).toBe('Välj frånvaroorsak');
  });
});

describe('buildTimeEntryRow — gemensamt', () => {
  it('avvisar mer än ett dygn', () => {
    expect(buildTimeEntryRow({ kind: 'absence', work_date: '2026-08-11', absence_type_id: 'x', hours: 25 }, ANNA).error)
      .toBe('En rad kan inte vara längre än ett dygn');
  });

  it('trimmar anteckningen och gör tom text till null', () => {
    expect(buildTimeEntryRow(work({ note: '  Bytte slang  ' }), ANNA).row!.note).toBe('Bytte slang');
    expect(buildTimeEntryRow(work({ note: '   ' }), ANNA).row!.note).toBeNull();
  });

  it('sätter user_id från sessionen, inte från indatan', () => {
    expect(buildTimeEntryRow({ ...work(), ...({ user_id: 'någon-annan' } as any) }, ANNA).row!.user_id).toBe(ANNA);
  });
});

// Regression från kodgranskningen: ett positivt timtal kan avrunda till noll minuter. Databasens
// CHECK (minutes_worked > 0) hade avvisat det som ett rått 500 i stället för ett läsbart fel.
describe('buildTimeEntryRow — avrundning', () => {
  it('avvisar frånvaro som avrundar till noll minuter', () => {
    const built = buildTimeEntryRow(
      { kind: 'absence', work_date: '2026-08-11', absence_type_id: 'vab', hours: 0.004 },
      'anna-uuid',
    );
    expect(built.error).toBe('Frånvaron måste vara minst en minut');
    expect(built.row).toBeNull();
  });

  it('släpper igenom en minut', () => {
    const built = buildTimeEntryRow(
      { kind: 'absence', work_date: '2026-08-11', absence_type_id: 'vab', hours: 1 / 60 },
      'anna-uuid',
    );
    expect(built.error).toBeNull();
    expect(built.row!.minutes_worked).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// toSummarizableEntry — fogen mellan databasraden och löneunderlaget
// ---------------------------------------------------------------------------
// Enda stället där kolumnnamn möter summeringen. Går den sönder tyst blir underlaget fel utan att
// någon uträkning gjort något galet — därför egna fall och inte bara route-testet.

import { toSummarizableEntry, type TimeEntryRow } from '@/lib/domains/time/entries';

const row = (over: Partial<TimeEntryRow> = {}): TimeEntryRow => ({
  id: 'e1',
  user_id: ANNA,
  kind: 'work_order',
  work_order_id: 'wo1',
  internal_project_id: null,
  absence_type_id: null,
  work_date: '2026-08-14',
  start_time: '08:00:00',
  end_time: '18:00:00',
  break_minutes: 60,
  minutes_worked: 540,
  hours: 9,
  time_code_id: 'tc1',
  note: null,
  source: 'crm',
  ...over,
});

describe('toSummarizableEntry', () => {
  it('bär klockslagen vidare orörda — de är underlaget byrån räknar övertid ur', () => {
    const mapped = toSummarizableEntry(row());
    expect(mapped.startTime).toBe('08:00:00');
    expect(mapped.endTime).toBe('18:00:00');
    expect(mapped.breakMinutes).toBe(60);
  });

  // Frånvaro och gamla kontorsrader har inga klockslag. workedMinutes faller tillbaka på
  // minutesWorked — glöms den i mapparen blir de raderna noll timmar, tyst.
  it('skickar med minutesWorked för rader utan klockslag', () => {
    const mapped = toSummarizableEntry(row({ kind: 'absence', start_time: null, end_time: null, minutes_worked: 240 }));
    expect(mapped.minutesWorked).toBe(240);
  });

  // Regression från kodgranskningen. minutes_worked lades till NULLBAR utan backfill, och kontorets
  // Tid-flik skriver fortfarande bara datum + timmar — triggern härleder hours UR minuterna, aldrig
  // tvärtom. Utan fallbacken visar dagvyn noll timmar på just de raderna, och summan längst ner
  // motsäger aggregatet i raden ovanför. Samma coalesce som i RPC:n time_approval_overview.
  it('faller tillbaka på hours när minutes_worked är null — de gamla kontorsraderna', () => {
    const mapped = toSummarizableEntry(row({
      source: 'legacy_office', start_time: null, end_time: null, minutes_worked: null, hours: 7.5,
    }));
    expect(mapped.minutesWorked).toBe(450);
  });

  it('avrundar den fallbacken till hela minuter', () => {
    expect(toSummarizableEntry(row({ start_time: null, end_time: null, minutes_worked: null, hours: 0.51 })).minutesWorked).toBe(31);
  });

  it('låter minutes_worked vinna när båda finns — minuterna är sanningen', () => {
    const mapped = toSummarizableEntry(row({ start_time: null, end_time: null, minutes_worked: 455, hours: 7.5 }));
    expect(mapped.minutesWorked).toBe(455);
  });

  // Fortnox-numret leder, precis som documentRef gör på varje annan CRM-yta: det interna
  // AO-numret är ingen utanför systemet känner igen, allra minst den som granskar lönen.
  it('namnger arbetsordern med FORTNOX-numret och projektet', () => {
    const mapped = toSummarizableEntry(row({
      work_order: { id: 'wo1', order_number: 'AO-1', fortnox_order_number: '12', project_name: 'Villa Ek', client_name: 'Ekbergs' },
    }));
    expect(mapped.label).toBe('#12 · Villa Ek');
  });

  it('faller tillbaka på det interna numret först när Fortnox-numret saknas — och utan brädgård', () => {
    const mapped = toSummarizableEntry(row({
      work_order: { id: 'wo1', order_number: 'AO-1', fortnox_order_number: null, project_name: null, client_name: 'Ekbergs' },
    }));
    expect(mapped.label).toBe('AO-1 · Ekbergs');
  });

  it('använder internprojektets namn på interntid', () => {
    const mapped = toSummarizableEntry(row({
      kind: 'internal', work_order_id: null, work_order: null,
      internal_project_id: 'ip1', internal_project: { id: 'ip1', name: 'Verkstad' },
    }));
    expect(mapped.label).toBe('Verkstad');
  });

  it('tar frånvaroorsakens namn och lönesort', () => {
    const absence = toSummarizableEntry(row({
      kind: 'absence', start_time: null, end_time: null, minutes_worked: 240,
      absence_type: { id: 'a1', name: 'VAB', payroll_code: 'LÖN300' },
    }));
    expect(absence.absenceReason).toBe('VAB');
    expect(absence.payrollCode).toBe('LÖN300');
  });
});
