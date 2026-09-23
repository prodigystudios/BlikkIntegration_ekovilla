import { describe, it, expect } from 'vitest';
import { getPlanningInsights, loadScheduledScopes } from '@/lib/domains/planning/insights';

// Läsvägen i insights, till skillnad från den rena aggregateInsights bredvid.
//
// 🧨 ATTRIBUERINGEN VAR HELT OTESTAD. getPlanningInsights deduppade varje jobb till sitt TIDIGASTE
// segment och lade hela ordervärdet på den veckan, medan WeekBoard lade hela värdet på var och en
// av de veckor jobbet var öppet. Två vyer, två svar, inget test som såg det.

type Result = { data: unknown[] | null; error: { message: string } | null };

/**
 * Minimal Supabase-klient. `ops_segments` frågas på TRE olika sätt i det här flödet, så svaret
 * väljs på kolumnlistan:
 *   • med inbäddad work_order  → fönsterläsningen
 *   • id, work_order_id, ...   → listScopeSpans (nämnaren, hela spannen)
 *   • bara work_order_id       → computeBacklogValue
 */
function makeClient(respond: (table: string, columns: string, rangeFrom: number | null) => Result) {
  return {
    from(table: string) {
      let columns = '*';
      let rangeFrom: number | null = null;
      const chain: Record<string, unknown> = {};
      for (const m of ['in', 'eq', 'gte', 'lte', 'order']) chain[m] = () => chain;
      chain.select = (cols: string) => { columns = cols; return chain; };
      chain.range = (f: number) => { rangeFrom = f; return chain; };
      chain.then = (ok: (v: Result) => unknown, fail: (e: unknown) => unknown) =>
        Promise.resolve(respond(table, columns, rangeFrom)).then(ok, fail);
      return chain;
    },
  } as never;
}

const workOrder = (revenue: number) => ({
  order_number: 'AO-1',
  fortnox_order_number: null,
  project_name: 'Villa Andersson',
  client_name: 'Andersson',
  status: 'scheduled',
  customer_snapshot: {},
  work_address: {},
  // En 'item'-rad: lineItemQuantity = quantity, radsumma = quantity × unit_price.
  line_items: [{ id: 'r1', pricing_mode: 'item', quantity: '1', unit_price: String(revenue) }],
});

const segment = (id: string, start_day: string, end_day: string, truck_id = 't1') =>
  ({ id, work_order_id: 'wo-1', truck_id, start_day, end_day });

function client(windowSegments: unknown[], allSegments: unknown[]) {
  return makeClient((table, columns, rangeFrom) => {
    if (table === 'crm_work_orders') return { data: [], error: null }; // backloggens värde: tomt
    if (table !== 'ops_segments') return { data: [], error: null };
    if (rangeFrom !== null && rangeFrom > 0) return { data: [], error: null }; // sida 2 av listScopeSpans
    if (columns.includes('work_order:crm_work_orders')) return { data: windowSegments, error: null };
    if (columns.includes('start_day')) return { data: allSegments, error: null };
    return { data: [], error: null };
  });
}

describe('getPlanningInsights', () => {
  it('delar ett tvåveckorsjobb mellan veckorna i stället för att lägga allt på startveckan', async () => {
    // mån v.40 → fre v.41, tio arbetsdagar, 500 000 kr.
    const segs = [{ ...segment('s1', '2026-09-28', '2026-10-09'), truck: { name: 'Bil 1' }, work_order: workOrder(500_000) }];
    const { data, error } = await getPlanningInsights(
      client(segs, [segment('s1', '2026-09-28', '2026-10-09')]),
      { fromISO: '2026-09-28', weeks: 2 },
    );

    expect(error).toBeNull();
    expect(data.weeks.map((w) => [w.label, w.revenue])).toEqual([['v.40', 250_000], ['v.41', 250_000]]);
    // Gamla regeln: [['v.40', 500_000], ['v.41', 0]].
  });

  // M5 — FÖNSTERFÄLLAN.
  // MUTANT: låt nämnaren komma från fönsterläsningen i stället för listScopeSpans (skicka
  // `windowSegments` som andra argument till client() nedan). Segment s1 får då 100 % av värdet,
  // alltså 500 000 i v.40, eftersom s2 ligger utanför fönstret och aldrig lästes.
  //
  // Felet syns BARA vid fönsterkanten och är därför osynligt i manuell test — man ser ett rimligt
  // tal på en rimlig vecka.
  it('M5: räknar andelen mot jobbets HELA spann, även när en placering ligger utanför fönstret', async () => {
    const inWindow = [{ ...segment('s1', '2026-09-28', '2026-10-02'), truck: { name: 'Bil 1' }, work_order: workOrder(500_000) }];
    const all = [
      segment('s1', '2026-09-28', '2026-10-02'), // v.40, i fönstret — 5 arbetsdagar
      segment('s2', '2026-11-02', '2026-11-06'), // v.45, långt utanför — 5 arbetsdagar
    ];

    const { data } = await getPlanningInsights(client(inWindow, all), { fromISO: '2026-09-28', weeks: 2 });
    expect(data.weeks.map((w) => [w.label, w.revenue])).toEqual([['v.40', 250_000], ['v.41', 0]]);
  });

  it('klipper skivorna till fönstret så bilsumman inte drar in veckor som inte visas', async () => {
    const inWindow = [{ ...segment('s1', '2026-09-28', '2026-10-02'), truck: { name: 'Bil 1' }, work_order: workOrder(500_000) }];
    const all = [segment('s1', '2026-09-28', '2026-10-02'), segment('s2', '2026-11-02', '2026-11-06')];

    const { data } = await getPlanningInsights(client(inWindow, all), { fromISO: '2026-09-28', weeks: 2 });
    const weekSum = data.weeks.reduce((s, w) => s + w.revenue, 0);
    const truckSum = data.byTruck.reduce((s, t) => s + t.revenue, 0);
    expect(truckSum).toBe(weekSum);
    expect(truckSum).toBe(250_000); // inte 500 000 — v.45 hör inte till det här fönstret
  });

  it('failar stängt när nämnarläsningen går sönder', async () => {
    const inWindow = [{ ...segment('s1', '2026-09-28', '2026-10-02'), truck: { name: 'Bil 1' }, work_order: workOrder(500_000) }];
    const broken = makeClient((table, columns, rangeFrom) => {
      if (table === 'ops_segments' && columns.includes('work_order:crm_work_orders')) return { data: inWindow, error: null };
      if (table === 'ops_segments' && rangeFrom !== null) return { data: null, error: { message: 'nekad' } };
      return { data: [], error: null };
    });

    const { data, error } = await getPlanningInsights(broken, { fromISO: '2026-09-28', weeks: 2 });
    expect(error?.message).toBe('nekad');
    expect(data.weeks).toEqual([]); // inget tal alls, hellre än ett för högt
  });

  it('räknar inte en avbruten order som omsättning', async () => {
    const cancelled = [{
      ...segment('s1', '2026-09-28', '2026-10-02'),
      truck: { name: 'Bil 1' },
      work_order: { ...workOrder(500_000), status: 'cancelled' },
    }];
    const { data } = await getPlanningInsights(client(cancelled, [segment('s1', '2026-09-28', '2026-10-02')]), {
      fromISO: '2026-09-28',
      weeks: 2,
    });
    expect(data.weeks.every((w) => w.revenue === 0)).toBe(true);
  });
});

// ── Statusfiltret ────────────────────────────────────────────────────────────
//
// 🧨 HITTAT I WEBBLÄSAREN 2026-09-23, inte av ett test. Rapporteringens "planerat mot utfall"
// återanvände insikternas läsning rakt av, och den släpper bara igenom draft/scheduled/in_progress.
// För en period som redan passerat är de flesta ordrar FAKTURERADE, så det planerade blev nästan
// noll medan utfallet stod kvar: Sandviken 1 visade 150 planerade säckar mot 3 826 blåsta — ett
// omöjligt tal som ändå såg ut som en siffra.

describe('loadScheduledScopes — statusfiltret', () => {
  const invoicedJob = {
    ...segment('s1', '2026-09-07', '2026-09-11'),
    truck: { name: 'Bil 1' },
    work_order: { ...workOrder(500_000), status: 'invoiced' },
  };
  const cancelledJob = {
    ...segment('s1', '2026-09-07', '2026-09-11'),
    truck: { name: 'Bil 1' },
    work_order: { ...workOrder(500_000), status: 'cancelled' },
  };

  it('"open" släpper INTE igenom en fakturerad order — framåtblickens regel', async () => {
    const { data } = await loadScheduledScopes(
      client([invoicedJob], [segment('s1', '2026-09-07', '2026-09-11')]),
      '2026-09-01', '2026-09-30', 'open',
    );
    expect(data?.values).toEqual([]);
  });

  it('"not-cancelled" TAR MED den fakturerade ordern — historikens regel', async () => {
    const { data } = await loadScheduledScopes(
      client([invoicedJob], [segment('s1', '2026-09-07', '2026-09-11')]),
      '2026-09-01', '2026-09-30', 'not-cancelled',
    );
    expect(data?.values).toHaveLength(1);
    expect(data?.values[0].revenue).toBe(500_000);
  });

  it('"not-cancelled" släpper ALDRIG igenom en avbruten order', async () => {
    // En order som aldrig blev av var heller aldrig planerad produktion.
    const { data } = await loadScheduledScopes(
      client([cancelledJob], [segment('s1', '2026-09-07', '2026-09-11')]),
      '2026-09-01', '2026-09-30', 'not-cancelled',
    );
    expect(data?.values).toEqual([]);
  });

  it('standardläget är "open", så insikterna är oförändrade', async () => {
    const { data } = await loadScheduledScopes(
      client([invoicedJob], [segment('s1', '2026-09-07', '2026-09-11')]),
      '2026-09-01', '2026-09-30',
    );
    expect(data?.values).toEqual([]);
  });
});
