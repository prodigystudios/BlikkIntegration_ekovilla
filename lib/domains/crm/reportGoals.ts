import { parseDecimal } from '@/lib/shared/number';
import type { ReportRange } from './reports';

// Rapportsidans referenspunkter: periodens utfall satt mot MÅLET och mot FÖREGÅENDE lika långa
// period. Modulen är ren — inga anrop, ingen klocka — och all I/O sker i rutten.
//
// Sidan har hittills bara visat absoluta tal. "3,2 Mkr" säger ingenting utan något att hålla det
// emot, och båda referenserna finns redan i databasen: crm_goals har riktiga månadsbudgetar, och
// föregående period är samma fråga med ett annat intervall.

// ── Målen ────────────────────────────────────────────────────────────────────

/** En rad ur crm_goals. numeric kommer tillbaka som STRÄNG ur PostgREST. */
export type ReportGoalRow = {
  period_start: string;
  calls_target: number | string | null;
  quotes_target: number | string | null;
  quote_value_target: number | string | null;
  order_count_target: number | string | null;
  order_value_target: number | string | null;
  /** Månadsbudget för fakturerat (sedan 2026-10-05). Äldre rader har 0, alltså inget mål. */
  invoiced_value_target?: number | string | null;
};

export type PeriodMetricKey =
  | 'calls'
  | 'quotes'
  | 'quoteValue'
  | 'orders'
  | 'orderValue'
  | 'invoicedValue';

/** Periodens sex huvudtal. Samma form används för perioden och för jämförelseperioden. */
export type PeriodTotals = Record<PeriodMetricKey, number>;

export const PERIOD_METRIC_KEYS: PeriodMetricKey[] = [
  'calls',
  'quotes',
  'quoteValue',
  'orders',
  'orderValue',
  'invoicedValue',
];

/**
 * Vilket målfält som hör till vilket tal.
 *
 * Fakturerat fick sitt eget mål 2026-10-05 (`invoiced_value_target`, redigeras under Inställningar →
 * Mål och används redan av översiktens veckotavla). Före det saknades det här med flit — att låta
 * fakturerat ärva ordervärdesmålet hade varit en uppfunnen affärsregel.
 */
const GOAL_FIELD: Record<PeriodMetricKey, keyof Omit<ReportGoalRow, 'period_start'>> = {
  calls: 'calls_target',
  quotes: 'quotes_target',
  quoteValue: 'quote_value_target',
  orders: 'order_count_target',
  orderValue: 'order_value_target',
  invoicedValue: 'invoiced_value_target',
};

/** Ett måltal ur raden, eller 0 när fältet saknas. numeric kommer tillbaka som STRÄNG ur PostgREST. */
function goalValue(row: ReportGoalRow, key: PeriodMetricKey): number {
  return parseDecimal(row[GOAL_FIELD[key]] as string | number | null | undefined, 0);
}

/** Har månaden ett satt mål för talet — summerat över säljarna, större än noll? */
function monthHasGoal(rows: ReportGoalRow[] | null | undefined, month: string, key: PeriodMetricKey): boolean {
  return (rows ?? []).some((row) => String(row.period_start ?? '').slice(0, 7) === month && goalValue(row, key) > 0);
}

/**
 * Summerade mål för de angivna månaderna, över ALLA säljare.
 *
 * ⚠️ NOLLA BLIR null, INTE 0. En säljare utan satt budget har nollor i raden (det finns sådana i
 * drift), och ett mål på 0 kr är inte "vi siktar på ingenting" utan "inget mål är satt". Skillnaden
 * avgör om kortet ritar en måluppfyllnad på 0 % eller låter bli att rita den alls — och 0 % läses
 * som ett misslyckande.
 */
export function sumGoalTargets(
  rows: ReportGoalRow[] | null | undefined,
  months: string[],
): Partial<Record<PeriodMetricKey, number>> {
  const wanted = new Set(months);
  const totals: Partial<Record<PeriodMetricKey, number>> = {};

  for (const row of rows ?? []) {
    // period_start är 'YYYY-MM-01'; månadsnyckeln är de sju första tecknen.
    if (!wanted.has(String(row.period_start ?? '').slice(0, 7))) continue;
    for (const key of PERIOD_METRIC_KEYS) {
      const value = goalValue(row, key);
      if (value > 0) totals[key] = (totals[key] ?? 0) + value;
    }
  }
  return totals;
}

/**
 * Hur stor del av målmånaderna perioden faktiskt täcker, i dagar.
 *
 * ⚠️ MÅLET PRORATERAS ALDRIG. Budgeten är satt per hel månad, och att skala ner den till "22/30 av
 * en miljon" hade varit en uppfunnen regel — månadsbudgetar är sällan jämnt fördelade över dagarna.
 * I stället redovisas täckningen som ett eget faktum bredvid procenttalet, precis som
 * lönsamhetskortet alltid skriver ut "14 av 19 fakturerade jobb". Läsaren gör bedömningen.
 *
 * Räknas UTC-förankrat: datumsträngarna är kalenderdagar, aldrig tidpunkter.
 */
export function goalDayCoverage(
  months: string[],
  range: ReportRange,
): { covered: number; total: number } {
  let covered = 0;
  let total = 0;

  for (const month of months) {
    const [year, monthNumber] = month.split('-').map(Number);
    if (!year || !monthNumber) continue;
    const first = Date.UTC(year, monthNumber - 1, 1);
    // Dag 0 i nästa månad är den sista i den här — hanterar både skottår och december.
    const last = Date.UTC(year, monthNumber, 0);
    total += Math.round((last - first) / 86_400_000) + 1;

    const from = Math.max(first, Date.parse(`${range.from}T00:00:00Z`));
    const to = Math.min(last, Date.parse(`${range.to}T00:00:00Z`));
    if (Number.isFinite(from) && Number.isFinite(to) && to >= from) {
      covered += Math.round((to - from) / 86_400_000) + 1;
    }
  }
  return { covered, total };
}

// ── Sammanställningen ────────────────────────────────────────────────────────

export type PeriodMetric = {
  key: PeriodMetricKey;
  /** Periodens utfall. */
  actual: number;
  /** Samma tal för föregående lika långa period. null när jämförelsen inte kunde hämtas. */
  previous: number | null;
  /** Summerat månadsmål. null när inget mål är satt — se sumGoalTargets. */
  target: number | null;
};

export type PeriodSummary = {
  metrics: PeriodMetric[];
  /** Månaderna vars mål summerats, 'YYYY-MM'. Tom när inga mål hittades. */
  goalMonths: string[];
  /** Dagar av målmånaderna som ligger i perioden, och månadernas hela längd. */
  goalDaysCovered: number;
  goalDaysTotal: number;
  /**
   * Månader i perioden som SAKNAR budget.
   *
   * ⚠️ Är den icke-tom sätts varje `target` till null, alltså inga målstaplar alls. Skälet är att
   * målet annars mäter ett annat tidsspann än utfallet: med budget bara för juni, augusti och
   * september ställdes TOLV månaders försäljning (14,7 Mkr) mot TRE månaders mål (36 Mkr) och
   * kortet skrev ut "41 % av målet". Talet såg rimligt ut och betydde ingenting.
   *
   * Listan finns kvar i svaret så gränssnittet kan säga VARFÖR stapeln uteblir — "budget saknas
   * för 9 av 12 månader" är ett handlingsbart besked, "inget mål satt" är det inte.
   */
  monthsWithoutGoal: string[];
  /** Jämförelseperioden, för etiketten. null när den inte gick att räkna eller hämta. */
  previousRange: ReportRange | null;
};

export function buildPeriodSummary(input: {
  totals: PeriodTotals;
  range: ReportRange;
  months: string[];
  goals?: ReportGoalRow[] | null;
  previous?: { range: ReportRange; totals: PeriodTotals } | null;
}): PeriodSummary {
  const targets = sumGoalTargets(input.goals, input.months);
  // Bara månader som faktiskt BÄR ett mål räknas som målmånader. Annars hade täckningsraden sagt
  // "mål för jan–dec" på en period där budgeten bara är satt för september.
  const goalMonths = input.months.filter((month) =>
    PERIOD_METRIC_KEYS.some((key) => monthHasGoal(input.goals, month, key)),
  );
  const coverage = goalDayCoverage(goalMonths, input.range);

  // ⚠️ MÅLET MÅSTE MÄTA SAMMA TIDSSPANN SOM UTFALLET. Saknar någon av periodens månader budget
  // går andelen inte att räkna — se monthsWithoutGoal. Hellre ingen stapel än en som jämför
  // olika långa perioder.
  const monthsWithoutGoal = input.months.filter((month) => !goalMonths.includes(month));

  // ⚠️ OCH REGELN GÄLLER PER TAL, inte bara per månad. Att en månad har NÅGOT mål räcker inte: fakturerat
  // fick sin budget 2026-10-05 medan ordervärdet haft sin sedan juni, så en period över september och
  // oktober hade ställt två månaders fakturering mot oktobers budget ensam — samma felläsning som
  // monthsWithoutGoal stoppar, bara för ett tal i taget. Ett tal får sin stapel bara när VARJE månad i
  // perioden har ett mål för just det talet.
  const targetApplies = (key: PeriodMetricKey) =>
    input.months.length > 0 && input.months.every((month) => monthHasGoal(input.goals, month, key));

  return {
    metrics: PERIOD_METRIC_KEYS.map((key) => ({
      key,
      actual: input.totals[key] ?? 0,
      previous: input.previous ? input.previous.totals[key] ?? 0 : null,
      target: targetApplies(key) ? targets[key] ?? null : null,
    })),
    goalMonths,
    goalDaysCovered: coverage.covered,
    goalDaysTotal: coverage.total,
    monthsWithoutGoal,
    previousRange: input.previous?.range ?? null,
  };
}

// ── Härledda tal (rena, delas med gränssnittet) ──────────────────────────────

/**
 * Måluppfyllnad i procent, eller null när den inte går att räkna.
 *
 * Inget tak: 140 % av målet ska synas som 140 %, inte klippas till 100. Stapeln klipps i
 * gränssnittet, talet gör det inte.
 */
export function goalPercent(metric: PeriodMetric): number | null {
  if (metric.target == null || metric.target <= 0) return null;
  return (metric.actual / metric.target) * 100;
}

/**
 * Förändring mot föregående period i procent.
 *
 * ⚠️ null NÄR FÖREGÅENDE ÄR NOLL. Division med noll ger Infinity, och "+∞ %" är inte ett besked —
 * men det är inte heller "+100 %", vilket är vad en slarvig fallback hade skrivit. Att gå från 0
 * till 5 offerter är en nyhet, inte en procentuell ökning, och gränssnittet säger det med ord.
 */
export function previousPercentChange(metric: PeriodMetric): number | null {
  if (metric.previous == null || metric.previous <= 0) return null;
  return ((metric.actual - metric.previous) / metric.previous) * 100;
}
