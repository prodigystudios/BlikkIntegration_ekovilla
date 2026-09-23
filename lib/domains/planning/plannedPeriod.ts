import { spreadScopeAcrossSpans } from './revenueSpread';
import type { ScopeSpan, ScopeValue } from './weekValue';

// Det PLANERADE arbetet i en godtycklig period — motsvarigheten till production.ts, som svarar för
// utfallet. Tillsammans blir de "höll vi planen?", per bil och material.
//
// Planeringens insikter (insights.ts) svarar på samma fråga men bara för ett framåtblickande
// veckofönster. Läsningen delas med den via loadScheduledScopes, så de två vyerna inte kan ha olika
// uppfattning om vad som ligger schemalagt.

export type PlannedTruckRow = { truck_id: string; truck_name: string; revenue: number; sacks: number };

/**
 * `material: null` = scopet saknar material.
 *
 * ⚠️ SKILJER SIG FRÅN insights.aggregateInsights, som SLÄPPER rader utan material. Här måste de med:
 * talet ställs bredvid utfallet, och ett planerat värde som tyst tappar sina omärkta jobb hade
 * gjort utfallet att se ut att överskrida planen.
 */
export type PlannedMaterialRow = { material: string | null; sacks: number };

export type PlannedMonthPoint = { period: string; revenue: number; sacks: number };

export type PlannedPeriod = {
  revenue: number;
  sacks: number;
  byMonth: PlannedMonthPoint[];
  byTruck: PlannedTruckRow[];
  byMaterial: PlannedMaterialRow[];
  /**
   * Oplanerat arbete — en ögonblicksbild av NU, inte av perioden.
   *
   * ⚠️ Backloggen har ingen period. Den svarar på "vad väntar just nu" och ändras inte när man
   * byter periodfilter. Gränssnittet MÅSTE märka den så, annars läses den som periodens siffra.
   */
  backlog: { revenue: number; sacks: number; count: number } | null;
  /** Kunde inte räknas alls — skilt från "inget planerat". */
  unavailable: boolean;
};

/**
 * Fördelar varje scopes värde över de dagar det utförs och summerar det som ligger i perioden.
 *
 * ⚠️ SPANNEN ÄR HELA, SKIVORNA KLIPPS. Nämnaren i fördelningen är jobbets fulla spann; bara de
 * dagsandelar som faktiskt hamnar inom [from, to] räknas. Samma fönsterfälla som insights.ts
 * dokumenterar: räknas nämnaren på bara den synliga delen får ett femveckorsjobb för hög andel i
 * den period man råkar titta på.
 */
export function aggregatePlannedForRange(input: {
  values: ScopeValue[];
  spans: ScopeSpan[];
  labels: Map<string, { material: string | null }>;
  truckNames: Map<string, string>;
  range: { from: string; to: string };
  /** Månadsaxeln, 'YYYY-MM'. Fixerad av anroparen så tomma månader ändå ritas. */
  months: string[];
}): Omit<PlannedPeriod, 'backlog' | 'unavailable'> {
  const spansByKey = new Map<string, ScopeSpan[]>();
  for (const span of input.spans) {
    const list = spansByKey.get(span.key);
    if (list) list.push(span);
    else spansByKey.set(span.key, [span]);
  }

  const monthMap = new Map<string, PlannedMonthPoint>(
    input.months.map((period) => [period, { period, revenue: 0, sacks: 0 }]),
  );
  const truckMap = new Map<string, PlannedTruckRow>();
  const materialMap = new Map<string | null, number>();
  let revenue = 0;
  let sacks = 0;

  for (const value of input.values) {
    const scopeSpans = spansByKey.get(value.key);
    if (!scopeSpans || scopeSpans.length === 0) continue;

    // ⚠️ SAMMA NYCKEL SOM UTFALLET. production.ts versaliserar materialet ur rapportraden
    // ('EKOVILLA'), medan scopets etikett kommer titelfallad ur artikelnamnet ('Ekovilla'). Utan
    // normaliseringen blir samma material två staplar som aldrig möts — belagt i webbläsaren
    // 2026-09-23, där diagrammet visade både 'EKOVILLA' och 'Ekovilla'.
    const rawMaterial = (input.labels.get(value.key)?.material ?? '').trim();
    const material = rawMaterial ? rawMaterial.toUpperCase() : null;
    for (const share of spreadScopeAcrossSpans(value, scopeSpans)) {
      if (share.day < input.range.from || share.day > input.range.to) continue;
      revenue += share.revenue;
      sacks += share.sacks;

      let truck = truckMap.get(share.truck_id);
      if (!truck) {
        truck = {
          truck_id: share.truck_id,
          truck_name: input.truckNames.get(share.truck_id) ?? '—',
          revenue: 0,
          sacks: 0,
        };
        truckMap.set(share.truck_id, truck);
      }
      truck.revenue += share.revenue;
      truck.sacks += share.sacks;

      materialMap.set(material, (materialMap.get(material) ?? 0) + share.sacks);

      // Dagsandelen bucketas på SIN EGEN dag, inte på jobbets startmånad. Ett jobb över ett
      // månadsskifte ska lägga sitt värde i båda månaderna — det är hela skälet till att
      // fördelningen sker per dag.
      const month = monthMap.get(share.day.slice(0, 7));
      if (month) {
        month.revenue += share.revenue;
        month.sacks += share.sacks;
      }
    }
  }

  return {
    revenue,
    sacks,
    byMonth: input.months.map((period) => monthMap.get(period) as PlannedMonthPoint),
    byTruck: [...truckMap.values()].sort(
      (a, b) => b.revenue - a.revenue || a.truck_name.localeCompare(b.truck_name, 'sv'),
    ),
    // Samma ordning som produktionens materiallista: okänt sist, oavsett storlek.
    byMaterial: [...materialMap.entries()]
      .map(([material, materialSacks]) => ({ material, sacks: materialSacks }))
      .sort((a, b) => {
        if ((a.material === null) !== (b.material === null)) return a.material === null ? 1 : -1;
        return b.sacks - a.sacks;
      }),
  };
}

/** Tom planeringsdel — när den inte gick att räkna. Skilt från "inget planerat". */
export function unavailablePlanned(): PlannedPeriod {
  return { revenue: 0, sacks: 0, byMonth: [], byTruck: [], byMaterial: [], backlog: null, unavailable: true };
}
