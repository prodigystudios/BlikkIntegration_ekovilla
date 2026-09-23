import { describe, it, expect } from 'vitest';
import {
  buildProduction,
  unavailableProduction,
  workingDaysInRange,
  type ProductionReportRow,
  type ProductionSegmentRow,
} from '@/lib/domains/planning/production';

// Produktionsutfallet per period. Tre regler bär hela siffran, och alla tre går fel TYST:
//
//   1. supersede FÖRE periodfiltret — annars räknas en delrapport som en egenkontroll utanför
//      perioden redan har ersatt, och samma säckar hamnar i två perioder
//   2. saknat material är en EGEN hink, aldrig invikt i ett materialnamn
//   3. beläggningen räknas ur SEGMENTEN, inte ur rapporterna — en bokad bil utan rapport ska synas

const report = (over: Partial<ProductionReportRow> & { work_order_id: string; report_day: string }): ProductionReportRow => ({
  segment_id: 's1',
  kind: 'partial',
  sacks_blown: 10,
  material: 'EKOVILLA',
  ...over,
});

const segment = (over: Partial<ProductionSegmentRow> & { id: string }): ProductionSegmentRow => ({
  truck_id: 't1',
  start_day: '2026-09-07',
  end_day: '2026-09-07',
  ...over,
});

const trucks = [{ id: 't1', name: 'Sandviken 1' }, { id: 't2', name: 'Borlänge 1' }];
const september = { from: '2026-09-01', to: '2026-09-30' };

describe('workingDaysInRange', () => {
  it('räknar bara måndag–fredag', () => {
    // 7–13 sep 2026 är en måndag–söndag.
    expect(workingDaysInRange({ from: '2026-09-07', to: '2026-09-13' })).toHaveLength(5);
  });

  it('drar bort svenska röda dagar OCH de-facto-aftnarna', () => {
    // Mån 28 dec 2026 – fre 1 jan 2027 är fem vardagar, men `swedishHoliday` räknar även
    // aftnarna: nyårsafton (tors) och nyårsdagen (fre) faller bort → tre arbetsdagar.
    //
    // ⚠️ Aftnarna är lätta att glömma. Ett schema som räknar dem som arbetsdagar ger en
    // beläggningsgrad som är för LÅG i jul och nyår — bilarna ser lediga ut när ingen ändå jobbar.
    const days = workingDaysInRange({ from: '2026-12-28', to: '2027-01-01' });
    expect(days).toEqual(['2026-12-28', '2026-12-29', '2026-12-30']);
  });

  it('midsommarafton är ingen arbetsdag', () => {
    // Fre 19 juni 2026. Veckan 15–19 juni har fyra arbetsdagar.
    expect(workingDaysInRange({ from: '2026-06-15', to: '2026-06-19' })).toHaveLength(4);
  });

  it('håller över en sommartidsväxling — dygnen räknas, inte timmarna', () => {
    // 25 okt 2026 går klockan tillbaka i Sverige (söndag). Veckan 19–25 okt har fem arbetsdagar.
    // En timbaserad iteration hade tappat eller dubblerat ett dygn här.
    expect(workingDaysInRange({ from: '2026-10-19', to: '2026-10-25' })).toHaveLength(5);
    // Och vårens växling, 29 mars 2026 (söndag).
    expect(workingDaysInRange({ from: '2026-03-23', to: '2026-03-29' })).toHaveLength(5);
  });

  it('bakvänt intervall ger tomt, inte ett negativt antal', () => {
    expect(workingDaysInRange({ from: '2026-09-30', to: '2026-09-01' })).toEqual([]);
  });
});

describe('buildProduction — säckboken', () => {
  it('en final är jobbets sanning; delrapporterna räknas inte med', () => {
    // 30 + 25 delrapporterat, egenkontrollen säger 91. Naiv summering ger 146.
    const result = buildProduction({
      reports: [
        report({ work_order_id: 'wo1', report_day: '2026-09-07', sacks_blown: 30 }),
        report({ work_order_id: 'wo1', report_day: '2026-09-08', sacks_blown: 25 }),
        report({ work_order_id: 'wo1', report_day: '2026-09-09', sacks_blown: 91, kind: 'final' }),
      ],
      segments: [segment({ id: 's1', start_day: '2026-09-07', end_day: '2026-09-09' })],
      trucks,
      range: september,
      months: ['2026-09'],
    });
    expect(result.totalSacks).toBe(91);
    expect(result.totalSacks).not.toBe(146);
    expect(result.reportCount).toBe(1);
  });

  it('SUPERSEDE FÖRE PERIODFILTRET — en final utanför perioden släcker delrapporten inuti', () => {
    // Det subtila fallet, och det dyra. Delrapporten ligger i september, egenkontrollen i oktober.
    // Filtreras perioden FÖRE supersede ser delrapporten olevande ut och räknas i september —
    // samtidigt som egenkontrollens 91 räknas i oktober. Samma säckar i två perioder.
    const reports = [
      report({ work_order_id: 'wo1', report_day: '2026-09-28', sacks_blown: 30 }),
      report({ work_order_id: 'wo1', report_day: '2026-10-02', sacks_blown: 91, kind: 'final' }),
    ];
    const segments = [segment({ id: 's1', start_day: '2026-09-28', end_day: '2026-10-02' })];

    const sep = buildProduction({ reports, segments, trucks, range: september, months: ['2026-09'] });
    expect(sep.totalSacks).toBe(0);
    expect(sep.reportCount).toBe(0);

    const oct = buildProduction({
      reports, segments, trucks,
      range: { from: '2026-10-01', to: '2026-10-31' }, months: ['2026-10'],
    });
    expect(oct.totalSacks).toBe(91);
  });

  it('utan final räknas delrapporterna, summerade', () => {
    const result = buildProduction({
      reports: [
        report({ work_order_id: 'wo1', report_day: '2026-09-07', sacks_blown: 30 }),
        report({ work_order_id: 'wo1', report_day: '2026-09-08', sacks_blown: 25 }),
      ],
      segments: [segment({ id: 's1', start_day: '2026-09-07', end_day: '2026-09-08' })],
      trucks, range: september, months: ['2026-09'],
    });
    expect(result.totalSacks).toBe(55);
  });

  it('en finals rader släcker ALLA jobbets partials, även på annan placering', () => {
    const result = buildProduction({
      reports: [
        report({ work_order_id: 'wo1', report_day: '2026-09-07', sacks_blown: 30 }),
        report({ work_order_id: 'wo1', report_day: '2026-09-08', sacks_blown: 40 }),
        report({ work_order_id: 'wo1', report_day: '2026-09-09', sacks_blown: 60, kind: 'final' }),
        report({ work_order_id: 'wo1', report_day: '2026-09-09', sacks_blown: 20, kind: 'final' }),
      ],
      segments: [segment({ id: 's1', start_day: '2026-09-07', end_day: '2026-09-09' })],
      trucks, range: september, months: ['2026-09'],
    });
    expect(result.totalSacks).toBe(80); // 60 + 20, inte 150
  });
});

describe('buildProduction — fördelningen', () => {
  it('bucketar per månad och behåller tomma månader i axeln', () => {
    const result = buildProduction({
      reports: [
        report({ work_order_id: 'wo1', report_day: '2026-08-10', sacks_blown: 40, kind: 'final' }),
        report({ work_order_id: 'wo2', report_day: '2026-10-05', sacks_blown: 60, kind: 'final' }),
      ],
      segments: [segment({ id: 's1', start_day: '2026-08-10', end_day: '2026-10-05' })],
      trucks,
      range: { from: '2026-08-01', to: '2026-10-31' },
      months: ['2026-08', '2026-09', '2026-10'],
    });
    expect(result.byMonth).toEqual([
      { period: '2026-08', sacks: 40 },
      { period: '2026-09', sacks: 0 },
      { period: '2026-10', sacks: 60 },
    ]);
  });

  it('saknat material blir en EGEN hink och viks aldrig in i ett materialnamn', () => {
    const result = buildProduction({
      reports: [
        report({ work_order_id: 'wo1', report_day: '2026-09-07', sacks_blown: 100, kind: 'final' }),
        report({ work_order_id: 'wo2', report_day: '2026-09-08', sacks_blown: 50, kind: 'final', material: null }),
        report({ work_order_id: 'wo3', report_day: '2026-09-09', sacks_blown: 25, kind: 'final', material: '  ' }),
      ],
      segments: [segment({ id: 's1', start_day: '2026-09-07', end_day: '2026-09-09' })],
      trucks, range: september, months: ['2026-09'],
    });
    expect(result.byMaterial).toEqual([
      { material: 'EKOVILLA', sacks: 100 },
      { material: null, sacks: 75 },
    ]);
  });

  it('okänt material ligger SIST även när det är störst', () => {
    // Det är en lucka i underlaget, inte ett material som konkurrerar om toppen.
    const result = buildProduction({
      reports: [
        report({ work_order_id: 'wo1', report_day: '2026-09-07', sacks_blown: 10, kind: 'final' }),
        report({ work_order_id: 'wo2', report_day: '2026-09-08', sacks_blown: 900, kind: 'final', material: null }),
      ],
      segments: [segment({ id: 's1', start_day: '2026-09-07', end_day: '2026-09-08' })],
      trucks, range: september, months: ['2026-09'],
    });
    expect(result.byMaterial.map((m) => m.material)).toEqual(['EKOVILLA', null]);
  });

  it('säckar vars segment inte går att slå upp redovisas separat, inte tyst borta', () => {
    const result = buildProduction({
      reports: [
        report({ work_order_id: 'wo1', report_day: '2026-09-07', sacks_blown: 60, kind: 'final' }),
        report({ work_order_id: 'wo2', report_day: '2026-09-08', sacks_blown: 40, kind: 'final', segment_id: 'borta' }),
      ],
      segments: [segment({ id: 's1', start_day: '2026-09-07', end_day: '2026-09-08' })],
      trucks, range: september, months: ['2026-09'],
    });
    expect(result.totalSacks).toBe(100);
    expect(result.sacksWithoutTruck).toBe(40);
    // Bilstapeln bär bara det som gick att attribuera — och differensen är utskriven.
    expect(result.byTruck.reduce((s, t) => s + t.sacks, 0)).toBe(60);
  });

  it('räknar jobb, inte rapportrader', () => {
    const result = buildProduction({
      reports: [
        report({ work_order_id: 'wo1', report_day: '2026-09-07', sacks_blown: 10 }),
        report({ work_order_id: 'wo1', report_day: '2026-09-08', sacks_blown: 10 }),
        report({ work_order_id: 'wo2', report_day: '2026-09-09', sacks_blown: 10 }),
      ],
      segments: [segment({ id: 's1', start_day: '2026-09-07', end_day: '2026-09-09' })],
      trucks, range: september, months: ['2026-09'],
    });
    expect(result.jobs).toBe(2);
    expect(result.reportCount).toBe(3);
  });
});

describe('buildProduction — beläggningsgrad', () => {
  it('räknar bokade arbetsdagar mot periodens arbetsdagar', () => {
    // Veckan 7–11 sep 2026 (mån–fre) = 5 arbetsdagar. Bilen är bokad mån–tis.
    const result = buildProduction({
      reports: [],
      segments: [segment({ id: 's1', truck_id: 't1', start_day: '2026-09-07', end_day: '2026-09-08' })],
      trucks,
      range: { from: '2026-09-07', to: '2026-09-11' },
      months: ['2026-09'],
    });
    const t1 = result.byTruck.find((t) => t.truck_id === 't1')!;
    expect(result.workingDays).toBe(5);
    expect(t1.bookedDays).toBe(2);
    expect(t1.utilization).toBe(40);
  });

  it('helgdagar i segmentet räknas inte som bokade dagar', () => {
    // Segmentet spänner mån–sön, men bara de fem vardagarna är arbetsdagar.
    const result = buildProduction({
      reports: [],
      segments: [segment({ id: 's1', truck_id: 't1', start_day: '2026-09-07', end_day: '2026-09-13' })],
      trucks,
      range: { from: '2026-09-07', to: '2026-09-13' },
      months: ['2026-09'],
    });
    expect(result.byTruck.find((t) => t.truck_id === 't1')!.bookedDays).toBe(5);
  });

  it('samma dag bokad av två segment räknas EN gång', () => {
    // Två jobb samma dag på samma bil är fullt normalt (30 % av dagarna i drift). Räknas dagen två
    // gånger kan beläggningen passera 100 % utan att bilen arbetat en extra dag.
    const result = buildProduction({
      reports: [],
      segments: [
        segment({ id: 's1', truck_id: 't1', start_day: '2026-09-07', end_day: '2026-09-07' }),
        segment({ id: 's2', truck_id: 't1', start_day: '2026-09-07', end_day: '2026-09-07' }),
      ],
      trucks,
      range: { from: '2026-09-07', to: '2026-09-11' },
      months: ['2026-09'],
    });
    const t1 = result.byTruck.find((t) => t.truck_id === 't1')!;
    expect(t1.bookedDays).toBe(1);
    expect(t1.utilization).toBe(20);
  });

  it('en bokad bil UTAN rapport syns ändå — beläggning och utfall är olika frågor', () => {
    const result = buildProduction({
      reports: [],
      segments: [segment({ id: 's1', truck_id: 't2', start_day: '2026-09-07', end_day: '2026-09-08' })],
      trucks,
      range: { from: '2026-09-07', to: '2026-09-11' },
      months: ['2026-09'],
    });
    const t2 = result.byTruck.find((t) => t.truck_id === 't2')!;
    expect(t2).toBeDefined();
    expect(t2.sacks).toBe(0);
    expect(t2.bookedDays).toBe(2);
  });

  it('en period utan arbetsdagar ger null, inte 0 %', () => {
    // En enda lördag.
    const result = buildProduction({
      reports: [],
      segments: [segment({ id: 's1', truck_id: 't1', start_day: '2026-09-12', end_day: '2026-09-12' })],
      trucks,
      range: { from: '2026-09-12', to: '2026-09-12' },
      months: ['2026-09'],
    });
    expect(result.workingDays).toBe(0);
    for (const truck of result.byTruck) expect(truck.utilization).toBeNull();
  });
});

describe('unavailableProduction', () => {
  it('är skilt från "inget rapporterat" — flaggan måste följa med', () => {
    const result = unavailableProduction(['2026-09'], september);
    expect(result.unavailable).toBe(true);
    expect(result.totalSacks).toBe(0);
    // Månadsaxeln finns kvar så gränssnittet kan rita ramen utan data.
    expect(result.byMonth).toEqual([{ period: '2026-09', sacks: 0 }]);
  });
});
