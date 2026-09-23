import { describe, it, expect } from 'vitest';
import {
  buildPeriodSummary,
  goalDayCoverage,
  goalPercent,
  previousPercentChange,
  sumGoalTargets,
  type PeriodTotals,
  type ReportGoalRow,
} from '@/lib/domains/crm/reportGoals';

// Målen och jämförelsen på rapportsidan. Tre regler bär hela sammanställningen, och alla tre går
// fel TYST om de bryts:
//
//   1. ett mål som inte är satt är null, aldrig 0 — 0 ritas som "0 % av målet", alltså ett
//      misslyckande, när sanningen är att ingen budget finns
//   2. målet prorateras ALDRIG ner till periodens längd; täckningen redovisas vid sidan om
//   3. en jämförelse mot noll ger null, aldrig Infinity och aldrig +100 %

const goal = (periodStart: string, over: Partial<ReportGoalRow> = {}): ReportGoalRow => ({
  period_start: periodStart,
  calls_target: 100,
  quotes_target: 60,
  quote_value_target: '2000000',
  order_count_target: 20,
  order_value_target: '1000000',
  ...over,
});

const totals = (over: Partial<PeriodTotals> = {}): PeriodTotals => ({
  calls: 0,
  quotes: 0,
  quoteValue: 0,
  orders: 0,
  orderValue: 0,
  invoicedValue: 0,
  ...over,
});

describe('sumGoalTargets', () => {
  it('summerar alla säljares mål för månaden', () => {
    const result = sumGoalTargets([goal('2026-09-01'), goal('2026-09-01')], ['2026-09']);
    expect(result.calls).toBe(200);
    expect(result.orderValue).toBe(2_000_000);
  });

  it('läser numeric som kommer tillbaka som STRÄNG ur PostgREST', () => {
    // Skickas strängen vidare orörd blir summeringen en konkatenering: '1000000' + '1000000'
    // = '10000001000000', alltså ett mål på tio biljoner.
    const result = sumGoalTargets([goal('2026-09-01'), goal('2026-09-01')], ['2026-09']);
    expect(typeof result.orderValue).toBe('number');
    expect(result.orderValue).not.toBe(NaN);
  });

  it('nollmål räknas INTE in — en säljare utan budget ska inte sänka lagets mål', () => {
    // Det finns sådana rader i drift: en användare med nollor rakt igenom.
    const result = sumGoalTargets(
      [goal('2026-09-01'), goal('2026-09-01', { calls_target: 0, order_value_target: 0 })],
      ['2026-09'],
    );
    expect(result.calls).toBe(100);
    expect(result.orderValue).toBe(1_000_000);
  });

  it('månader utanför perioden ignoreras', () => {
    const result = sumGoalTargets([goal('2026-08-01'), goal('2026-09-01')], ['2026-09']);
    expect(result.calls).toBe(100);
  });

  it('helt utan mål ger tomt — inte nollor', () => {
    const result = sumGoalTargets([], ['2026-09']);
    expect(result.calls).toBeUndefined();
    expect(result.orderValue).toBeUndefined();
  });

  it('BARA nollmål ger frånvarande nyckel, inte 0', () => {
    // Det här är skillnaden mellan "ingen budget är satt" och "vi siktar på ingenting". Nyckeln
    // måste saknas hela vägen ut, för ett target på 0 ritar en målstapel på 0 % — alltså ett
    // misslyckande — på ett lag som aldrig fått någon budget.
    //
    // ⚠️ Summan är IDENTISK i båda fallen, så ett test som bara kontrollerar totalen är blint här.
    // Verifierat genom mutation: `value > 0` → `value >= 0` passerade ett sådant test.
    const result = sumGoalTargets(
      [goal('2026-09-01', {
        calls_target: 0, quotes_target: 0, quote_value_target: 0,
        order_count_target: 0, order_value_target: 0,
      })],
      ['2026-09'],
    );
    expect(result.calls).toBeUndefined();
    expect(result.orderValue).toBeUndefined();
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('en säljare med nollor drar inte ner en kollegas mål till 0', () => {
    // Raden finns i drift: en användare med nollor rakt igenom bredvid fyra med riktiga budgetar.
    const result = sumGoalTargets(
      [goal('2026-09-01'), goal('2026-09-01', { calls_target: 0 })],
      ['2026-09'],
    );
    expect(result.calls).toBe(100);
  });

  it('fakturerat får ALDRIG ett mål — crm_goals har inget faktureringsmål', () => {
    const result = sumGoalTargets([goal('2026-09-01')], ['2026-09']);
    expect(result.invoicedValue).toBeUndefined();
  });
});

describe('goalDayCoverage', () => {
  it('en påbörjad månad täcks delvis', () => {
    // 1–22 september av september månads 30 dagar.
    const result = goalDayCoverage(['2026-09'], { from: '2026-09-01', to: '2026-09-22' });
    expect(result).toEqual({ covered: 22, total: 30 });
  });

  it('en hel månad täcks helt', () => {
    const result = goalDayCoverage(['2026-08'], { from: '2026-08-01', to: '2026-08-31' });
    expect(result).toEqual({ covered: 31, total: 31 });
  });

  it('skottår räknas rätt', () => {
    const result = goalDayCoverage(['2028-02'], { from: '2028-02-01', to: '2028-02-29' });
    expect(result).toEqual({ covered: 29, total: 29 });
  });

  it('december rullar över årsskiftet utan att spilla', () => {
    const result = goalDayCoverage(['2026-12'], { from: '2026-12-01', to: '2026-12-31' });
    expect(result).toEqual({ covered: 31, total: 31 });
  });

  it('täcker perioden flera månader summeras båda', () => {
    const result = goalDayCoverage(['2026-08', '2026-09'], { from: '2026-08-15', to: '2026-09-10' });
    // 17 dagar i augusti (15–31) + 10 i september, av 31 + 30.
    expect(result).toEqual({ covered: 27, total: 61 });
  });

  it('en period som slutar före månaden ger noll täckning men behåller nämnaren', () => {
    const result = goalDayCoverage(['2026-09'], { from: '2026-07-01', to: '2026-07-31' });
    expect(result).toEqual({ covered: 0, total: 30 });
  });
});

describe('buildPeriodSummary', () => {
  const range = { from: '2026-09-01', to: '2026-09-22' };

  it('sätter utfall, mål och jämförelse på varje tal', () => {
    const summary = buildPeriodSummary({
      totals: totals({ orderValue: 600_000, calls: 3 }),
      range,
      months: ['2026-09'],
      goals: [goal('2026-09-01')],
      previous: { range: { from: '2026-08-10', to: '2026-08-31' }, totals: totals({ orderValue: 400_000 }) },
    });
    const orderValue = summary.metrics.find((m) => m.key === 'orderValue')!;
    expect(orderValue.actual).toBe(600_000);
    expect(orderValue.target).toBe(1_000_000);
    expect(orderValue.previous).toBe(400_000);
  });

  it('utan jämförelseperiod blir previous null — INTE noll', () => {
    // Nollan hade lästs som "förra perioden sålde vi ingenting", alltså ett påstående om
    // verkligheten, i stället för "vi vet inte".
    const summary = buildPeriodSummary({ totals: totals({ orderValue: 600_000 }), range, months: ['2026-09'] });
    for (const metric of summary.metrics) expect(metric.previous).toBeNull();
  });

  it('utan mål blir target null — INTE noll', () => {
    const summary = buildPeriodSummary({ totals: totals(), range, months: ['2026-09'], goals: [] });
    for (const metric of summary.metrics) expect(metric.target).toBeNull();
    expect(summary.goalMonths).toEqual([]);
  });

  it('SAKNAR någon månad budget visas inget mål alls — målet måste mäta samma span som utfallet', () => {
    // Det verkliga fallet, avläst i webbläsaren 2026-09-22: budget finns för juni, augusti och
    // september, men perioden är tolv månader. Utan den här spärren ställdes tolv månaders
    // försäljning mot tre månaders mål och kortet skrev "41 % av målet 36 000 000 kr".
    const summary = buildPeriodSummary({
      totals: totals({ orderValue: 14_656_001 }),
      range: { from: '2025-10-01', to: '2026-09-22' },
      months: ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03',
        '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
      goals: [goal('2026-06-01'), goal('2026-08-01'), goal('2026-09-01')],
    });
    for (const metric of summary.metrics) expect(metric.target).toBeNull();
    expect(summary.monthsWithoutGoal).toHaveLength(9);
    // Målmånaderna finns kvar i svaret så gränssnittet kan förklara varför stapeln uteblir.
    expect(summary.goalMonths).toEqual(['2026-06', '2026-08', '2026-09']);
  });

  it('täcker budgeten HELA perioden visas målet', () => {
    const summary = buildPeriodSummary({
      totals: totals({ orderValue: 600_000 }),
      range: { from: '2026-08-01', to: '2026-09-22' },
      months: ['2026-08', '2026-09'],
      goals: [goal('2026-08-01'), goal('2026-09-01')],
    });
    expect(summary.metrics.find((m) => m.key === 'orderValue')!.target).toBe(2_000_000);
    expect(summary.monthsWithoutGoal).toEqual([]);
  });

  it('en lucka MITT i perioden spärrar också — inte bara en saknad kantmånad', () => {
    const summary = buildPeriodSummary({
      totals: totals({ orderValue: 600_000 }),
      range: { from: '2026-06-01', to: '2026-08-31' },
      months: ['2026-06', '2026-07', '2026-08'],
      goals: [goal('2026-06-01'), goal('2026-08-01')], // juli saknas
    });
    expect(summary.metrics.find((m) => m.key === 'orderValue')!.target).toBeNull();
    expect(summary.monthsWithoutGoal).toEqual(['2026-07']);
  });

  it('bara månader som BÄR ett mål räknas som målmånader', () => {
    // Annars hade täckningsraden sagt "mål för aug–sep" på en period där budgeten bara är satt
    // för september, och nämnaren blivit 61 dagar i stället för 30.
    const summary = buildPeriodSummary({
      totals: totals(),
      range: { from: '2026-08-01', to: '2026-09-22' },
      months: ['2026-08', '2026-09'],
      goals: [goal('2026-09-01')],
    });
    expect(summary.goalMonths).toEqual(['2026-09']);
    expect(summary.goalDaysTotal).toBe(30);
    expect(summary.goalDaysCovered).toBe(22);
  });

  it('en månad med enbart nollmål räknas inte som målmånad', () => {
    const summary = buildPeriodSummary({
      totals: totals(),
      range,
      months: ['2026-09'],
      goals: [goal('2026-09-01', {
        calls_target: 0, quotes_target: 0, quote_value_target: 0,
        order_count_target: 0, order_value_target: 0,
      })],
    });
    expect(summary.goalMonths).toEqual([]);
  });

  it('fakturerat har jämförelse men aldrig mål', () => {
    const summary = buildPeriodSummary({
      totals: totals({ invoicedValue: 900_000 }),
      range,
      months: ['2026-09'],
      goals: [goal('2026-09-01')],
      previous: { range: { from: '2026-08-10', to: '2026-08-31' }, totals: totals({ invoicedValue: 700_000 }) },
    });
    const invoiced = summary.metrics.find((m) => m.key === 'invoicedValue')!;
    expect(invoiced.target).toBeNull();
    expect(invoiced.previous).toBe(700_000);
  });
});

describe('goalPercent', () => {
  it('räknar andelen av målet', () => {
    expect(goalPercent({ key: 'orderValue', actual: 600_000, previous: null, target: 1_000_000 })).toBe(60);
  });

  it('inget mål ger null, aldrig 0 %', () => {
    expect(goalPercent({ key: 'orderValue', actual: 600_000, previous: null, target: null })).toBeNull();
  });

  it('mål på noll ger null i stället för Infinity', () => {
    expect(goalPercent({ key: 'calls', actual: 5, previous: null, target: 0 })).toBeNull();
  });

  it('över målet klipps INTE — 140 % ska synas som 140 %', () => {
    expect(goalPercent({ key: 'orderValue', actual: 1_400_000, previous: null, target: 1_000_000 })).toBe(140);
  });
});

describe('previousPercentChange', () => {
  it('räknar förändringen mot föregående period', () => {
    expect(previousPercentChange({ key: 'orderValue', actual: 600_000, previous: 400_000, target: null })).toBe(50);
  });

  it('nedgång blir negativ', () => {
    expect(previousPercentChange({ key: 'orderValue', actual: 300_000, previous: 400_000, target: null })).toBe(-25);
  });

  it('föregående noll ger null — inte Infinity och inte +100 %', () => {
    // Att gå från 0 till 5 offerter är en nyhet, inte en procentuell ökning.
    expect(previousPercentChange({ key: 'quotes', actual: 5, previous: 0, target: null })).toBeNull();
  });

  it('ingen jämförelse alls ger null', () => {
    expect(previousPercentChange({ key: 'quotes', actual: 5, previous: null, target: null })).toBeNull();
  });
});
