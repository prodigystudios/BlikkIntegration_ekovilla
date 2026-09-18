import {
  DEFAULT_PLANNED_DAY_MODE,
  spreadScopeAcrossSpans,
  type PlannedDayMode,
  type SpreadSpan,
} from './revenueSpread';
import { mondayOfISO } from './timezone';

// Veckovärde per bil — den ENDA vägen från "vad är planerat" till "vad omsätter veckan".
//
// 🧨 SAMMA MODUL FÖR BÅDA VYERNA, OCH DET ÄR HELA POÄNGEN. Tavlan (WeekBoard, klientkomponent) och
// Insikter (getPlanningInsights, server) räknade tidigare var sin summa på var sitt sätt och gav
// olika svar på samma fråga. Modulen importerar bara typer och ren matte — ingen Supabase, ingen
// next/headers — så den går att anropa från båda hållen.
//
// ⚠️ ATT DELA MODUL RÄCKER INTE. De måste också få SAMMA INDATA: scopets alla placeringar, inte
// bara de som ligger i det fönster som ritas. Se fönsterfällan i revenueSpread.ts.

export type ScopeValue = {
  /** `${work_order_id}:${stage_id ?? 'rest'}` — det som ska utföras. */
  key: string;
  revenue: number;
  sacks: number;
};

export type ScopeSpan = SpreadSpan & { key: string };

export type WeekSlice = {
  key: string;
  segment_id: string;
  truck_id: string;
  /** Måndagen i veckan skivan hör till. */
  weekStart: string;
  revenue: number;
  sacks: number;
};

/**
 * Fördela varje scopes värde över dess placeringar och summera till (scope, placering, vecka).
 *
 * Scopes utan placeringar bidrar ingenting — de är oplanerade och hör hemma i backloggens värde,
 * inte i en vecka. Placeringar utan ett känt scope-värde hoppas över på samma grund.
 */
export function segmentWeekValues(
  values: ScopeValue[],
  spans: ScopeSpan[],
  mode: PlannedDayMode = DEFAULT_PLANNED_DAY_MODE,
): WeekSlice[] {
  const spansByKey = new Map<string, ScopeSpan[]>();
  for (const span of spans) {
    const list = spansByKey.get(span.key);
    if (list) list.push(span);
    else spansByKey.set(span.key, [span]);
  }

  const out: WeekSlice[] = [];
  for (const value of values) {
    const scopeSpans = spansByKey.get(value.key);
    if (!scopeSpans || scopeSpans.length === 0) continue;

    // Slå ihop dagsandelarna till veckor innan de lämnar modulen. Ett femveckorsjobb blir fem
    // rader i stället för tjugofem, och anroparen slipper känna till dagsnivån.
    const byWeek = new Map<string, WeekSlice>();
    for (const share of spreadScopeAcrossSpans(value, scopeSpans, mode)) {
      const weekStart = mondayOfISO(share.day);
      if (weekStart === null) continue;
      const bucketKey = `${share.segment_id}:${weekStart}`;
      const bucket = byWeek.get(bucketKey);
      if (bucket) {
        bucket.revenue += share.revenue;
        bucket.sacks += share.sacks;
      } else {
        byWeek.set(bucketKey, {
          key: value.key,
          segment_id: share.segment_id,
          truck_id: share.truck_id,
          weekStart,
          revenue: share.revenue,
          sacks: share.sacks,
        });
      }
    }
    for (const slice of byWeek.values()) out.push(slice);
  }
  return out;
}

export type WeekTotal = { revenue: number; sacks: number; jobs: number };

/**
 * Veckans summa, valfritt begränsad till vissa bilar.
 *
 * ⛔ INGEN DEDUP PÅ ARBETSORDER. Den gamla koden var tvungen att deduppa, eftersom varje placering
 * bar hela orderns värde; följden var att samma order räknades fullt i varje vecka den var öppen
 * och fullt på varje bana den låg på. Fördelningen har redan delat värdet, så en dedup här skulle
 * KASTA bort andelar i stället för att skydda mot dubbelräkning.
 *
 * `jobs` räknar distinkta scopes med en andel i veckan — alltså "hur många jobb rör bilen den här
 * veckan", inte hur många placeringar som finns.
 */
export function weekTotals(slices: WeekSlice[], weekStart: string, truckIds?: Set<string>): WeekTotal {
  let revenue = 0;
  let sacks = 0;
  const keys = new Set<string>();
  for (const slice of slices) {
    if (slice.weekStart !== weekStart) continue;
    if (truckIds && !truckIds.has(slice.truck_id)) continue;
    revenue += slice.revenue;
    sacks += slice.sacks;
    keys.add(slice.key);
  }
  // Öresfel kan ha ackumulerats över skivorna; summan är en visning, inte en bok.
  return { revenue: Math.round(revenue * 100) / 100, sacks, jobs: keys.size };
}
