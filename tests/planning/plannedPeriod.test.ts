import { describe, it, expect } from 'vitest';
import { aggregatePlannedForRange, unavailablePlanned } from '@/lib/domains/planning/plannedPeriod';
import type { ScopeSpan, ScopeValue } from '@/lib/domains/planning/weekValue';

// Det planerade arbetet i en period. Två regler bär hela siffran:
//
//   1. nämnaren är jobbets HELA spann, men bara dagarna i perioden räknas — annars får ett långt
//      jobb för hög andel i den period man råkar titta på (fönsterfällan)
//   2. scopes utan material räknas MED, till skillnad från planeringens insikter — talet ställs
//      mot utfallet, och ett planerat värde som tyst tappar rader gör utfallet till en överträffad
//      plan som aldrig fanns

const labels = (entries: Array<[string, string | null]>) =>
  new Map(entries.map(([key, material]) => [key, { material }]));

const truckNames = new Map([['t1', 'Sandviken 1'], ['t2', 'Borlänge 1']]);

const value = (key: string, revenue: number, sacks: number): ScopeValue => ({ key, revenue, sacks });
const span = (key: string, over: Partial<ScopeSpan> = {}): ScopeSpan => ({
  key,
  segment_id: `${key}-s1`,
  truck_id: 't1',
  start_day: '2026-09-07',
  end_day: '2026-09-11',
  ...over,
});

describe('aggregatePlannedForRange', () => {
  it('summerar hela jobbet när perioden rymmer det', () => {
    const result = aggregatePlannedForRange({
      values: [value('wo1', 100_000, 500)],
      spans: [span('wo1')],
      labels: labels([['wo1', 'EKOVILLA']]),
      truckNames,
      range: { from: '2026-09-01', to: '2026-09-30' },
      months: ['2026-09', '2026-10'],
    });
    expect(result.revenue).toBe(100_000);
    expect(result.sacks).toBe(500);
    expect(result.byTruck).toEqual([
      { truck_id: 't1', truck_name: 'Sandviken 1', revenue: 100_000, sacks: 500 },
    ]);
  });

  it('FÖNSTERFÄLLAN: nämnaren är hela spannet, bara dagarna i perioden räknas', () => {
    // Ett jobb mån–fre (5 arbetsdagar) à 100 000 kr. Perioden täcker bara mån–tis.
    // Rätt svar är 2/5 = 40 000 kr. Räknades nämnaren på den synliga delen hade det blivit
    // hela 100 000 — jobbet hade sett ut att utföras helt inom två dagar.
    const result = aggregatePlannedForRange({
      values: [value('wo1', 100_000, 500)],
      spans: [span('wo1')],
      labels: labels([['wo1', 'EKOVILLA']]),
      truckNames,
      range: { from: '2026-09-07', to: '2026-09-08' },
      months: ['2026-09', '2026-10'],
    });
    expect(result.revenue).toBeCloseTo(40_000, 0);
    expect(result.sacks).toBe(200);
  });

  it('en period helt utanför jobbet ger noll', () => {
    const result = aggregatePlannedForRange({
      values: [value('wo1', 100_000, 500)],
      spans: [span('wo1')],
      labels: labels([['wo1', 'EKOVILLA']]),
      truckNames,
      range: { from: '2026-10-01', to: '2026-10-31' },
      months: ['2026-09', '2026-10'],
    });
    expect(result.revenue).toBe(0);
    expect(result.byTruck).toEqual([]);
  });

  it('ett jobb delat på två bilar fördelas mellan dem', () => {
    const result = aggregatePlannedForRange({
      values: [value('wo1', 100_000, 500)],
      spans: [
        span('wo1', { segment_id: 'a', truck_id: 't1', start_day: '2026-09-07', end_day: '2026-09-08' }),
        span('wo1', { segment_id: 'b', truck_id: 't2', start_day: '2026-09-09', end_day: '2026-09-11' }),
      ],
      labels: labels([['wo1', 'EKOVILLA']]),
      truckNames,
      range: { from: '2026-09-01', to: '2026-09-30' },
      months: ['2026-09', '2026-10'],
    });
    expect(result.revenue).toBeCloseTo(100_000, 0);
    const total = result.byTruck.reduce((sum, t) => sum + t.revenue, 0);
    expect(total).toBeCloseTo(100_000, 0);
    // Bilarna ska vara två, inte en.
    expect(result.byTruck).toHaveLength(2);
  });

  it('scope UTAN material räknas med, i en egen hink', () => {
    // Skiljer sig från insights.aggregateInsights, som släpper dem. Se modulens kommentar.
    const result = aggregatePlannedForRange({
      values: [value('wo1', 10_000, 100), value('wo2', 10_000, 60)],
      spans: [span('wo1'), span('wo2', { segment_id: 'wo2-s1' })],
      labels: labels([['wo1', 'EKOVILLA'], ['wo2', null]]),
      truckNames,
      range: { from: '2026-09-01', to: '2026-09-30' },
      months: ['2026-09', '2026-10'],
    });
    expect(result.sacks).toBe(160);
    expect(result.byMaterial).toEqual([
      { material: 'EKOVILLA', sacks: 100 },
      { material: null, sacks: 60 },
    ]);
  });

  it('materialnyckeln normaliseras som i utfallet — "Ekovilla" och "EKOVILLA" är samma material', () => {
    // 🧨 Belagt i webbläsaren 2026-09-23: diagrammet visade BÅDE "EKOVILLA" (utfallet, versalt ur
    // rapportraden) och "Ekovilla" (planerat, titelfallat ur artikelnamnet) som två staplar som
    // aldrig möttes. Plan och utfall måste dela nyckel för att gå att ställa mot varandra.
    const result = aggregatePlannedForRange({
      values: [value('wo1', 1_000, 40), value('wo2', 1_000, 60)],
      spans: [span('wo1'), span('wo2', { segment_id: 'wo2-s1' })],
      labels: labels([['wo1', 'Ekovilla'], ['wo2', 'EKOVILLA']]),
      truckNames,
      range: { from: '2026-09-01', to: '2026-09-30' },
      months: ['2026-09', '2026-10'],
    });
    expect(result.byMaterial).toEqual([{ material: 'EKOVILLA', sacks: 100 }]);
  });

  it('tom materialsträng räknas som SAKNAT, inte som ett namn', () => {
    const result = aggregatePlannedForRange({
      values: [value('wo1', 1_000, 40)],
      spans: [span('wo1')],
      labels: labels([['wo1', '  ']]),
      truckNames,
      range: { from: '2026-09-01', to: '2026-09-30' },
      months: ['2026-09', '2026-10'],
    });
    expect(result.byMaterial).toEqual([{ material: null, sacks: 40 }]);
  });

  it('okänt material ligger SIST även när det är störst', () => {
    const result = aggregatePlannedForRange({
      values: [value('wo1', 1_000, 10), value('wo2', 1_000, 900)],
      spans: [span('wo1'), span('wo2', { segment_id: 'wo2-s1' })],
      labels: labels([['wo1', 'EKOVILLA'], ['wo2', null]]),
      truckNames,
      range: { from: '2026-09-01', to: '2026-09-30' },
      months: ['2026-09', '2026-10'],
    });
    expect(result.byMaterial.map((m) => m.material)).toEqual(['EKOVILLA', null]);
  });

  it('ett scope utan placeringar bidrar ingenting — det är oplanerat, inte nollplanerat', () => {
    const result = aggregatePlannedForRange({
      values: [value('wo1', 100_000, 500)],
      spans: [],
      labels: labels([['wo1', 'EKOVILLA']]),
      truckNames,
      range: { from: '2026-09-01', to: '2026-09-30' },
      months: ['2026-09', '2026-10'],
    });
    expect(result.revenue).toBe(0);
    expect(result.byMaterial).toEqual([]);
  });

  it('ett jobb över ett månadsskifte lägger värde i BÅDA månaderna', () => {
    // Tors 1 okt – mån 5 okt är fyra arbetsdagar (1, 2, 5 okt … plus 30 sep). Jobbet 28 sep–2 okt
    // har fem arbetsdagar: 28, 29, 30 sep + 1, 2 okt. Tre i september, två i oktober.
    //
    // ⚠️ Det här är hela skälet till att fördelningen sker per DAG. Bucketades jobbet på sin
    // startmånad hade hela miljonen legat i september — samma fel som femveckorsjobbet på
    // planeringstavlan en gång hade.
    const result = aggregatePlannedForRange({
      values: [value('wo1', 100_000, 500)],
      spans: [span('wo1', { start_day: '2026-09-28', end_day: '2026-10-02' })],
      labels: labels([['wo1', 'EKOVILLA']]),
      truckNames,
      range: { from: '2026-09-01', to: '2026-10-31' },
      months: ['2026-09', '2026-10'],
    });
    const sep = result.byMonth.find((m) => m.period === '2026-09')!;
    const okt = result.byMonth.find((m) => m.period === '2026-10')!;
    expect(sep.revenue).toBeCloseTo(60_000, 0);
    expect(okt.revenue).toBeCloseTo(40_000, 0);
    expect(sep.revenue + okt.revenue).toBeCloseTo(100_000, 0);
  });

  it('månadsaxeln behåller tomma månader så ramen går att rita', () => {
    const result = aggregatePlannedForRange({
      values: [value('wo1', 10_000, 50)],
      spans: [span('wo1')],
      labels: labels([['wo1', 'EKOVILLA']]),
      truckNames,
      range: { from: '2026-09-01', to: '2026-10-31' },
      months: ['2026-09', '2026-10'],
    });
    expect(result.byMonth.map((m) => m.period)).toEqual(['2026-09', '2026-10']);
    expect(result.byMonth.find((m) => m.period === '2026-10')!.revenue).toBe(0);
  });

  it('okänd bil får en etikett, inte ett tomt namn', () => {
    const result = aggregatePlannedForRange({
      values: [value('wo1', 1_000, 10)],
      spans: [span('wo1', { truck_id: 'okand' })],
      labels: labels([['wo1', 'EKOVILLA']]),
      truckNames,
      range: { from: '2026-09-01', to: '2026-09-30' },
      months: ['2026-09', '2026-10'],
    });
    expect(result.byTruck[0].truck_name).toBe('—');
  });
});

describe('unavailablePlanned', () => {
  it('är skilt från "inget planerat" — flaggan och en null-backlogg', () => {
    const result = unavailablePlanned();
    expect(result.unavailable).toBe(true);
    expect(result.backlog).toBeNull();
    expect(result.revenue).toBe(0);
  });
});
