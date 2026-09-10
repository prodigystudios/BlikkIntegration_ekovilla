import { describe, it, expect } from 'vitest';
import { getDepotStock } from '@/lib/domains/planning/depotStock';

// Läsvägarna i depotStock, till skillnad från de rena funktionerna bredvid.
//
// 🧨 Det som vaktas här är att beräkningen failar STÄNGT. Fem läsningar svalde tidigare sina fel och
// getDepotStock returnerade hårdkodat `error: null`, så rutten kunde bara vidarebefordra ett fel den
// aldrig fick. Utfallet blev ett TAL i stället för ett fel — och åt olika håll beroende på vilken
// läsning som gick sönder. "Behöver 0 säck" är en lögn som snart ska få fylla i en beställning.

type PageResult = { data: unknown[] | null; error: { message: string } | null };

/** Minimal Supabase-klient där varje tabell svarar per sida (range-offset → svar). */
function makeClient(tables: Record<string, (from: number | null) => PageResult>) {
  return {
    from(table: string) {
      let rangeFrom: number | null = null;
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'in', 'eq', 'is', 'gte', 'lte', 'order', 'limit']) {
        chain[m] = () => chain;
      }
      chain.range = (f: number) => {
        rangeFrom = f;
        return chain;
      };
      chain.then = (ok: (v: PageResult) => unknown, fail: (e: unknown) => unknown) => {
        const responder = tables[table] ?? (() => ({ data: [], error: null }));
        return Promise.resolve(responder(rangeFrom)).then(ok, fail);
      };
      return chain;
    },
  } as never;
}

const ok = (data: unknown[]): PageResult => ({ data, error: null });
const fail = (message: string): PageResult => ({ data: null, error: { message } });

const depot = { id: 'd1', name: 'Syd' };
const delivery = { depot_id: 'd1', material: 'EKOVILLA', sacks: 1 };

/** Grundläge: allt svarar tomt och felfritt. */
const base = (): Record<string, (from: number | null) => PageResult> => ({
  ops_depots: () => ok([depot]),
  ops_trucks: () => ok([]),
  ops_depot_deliveries: () => ok([]),
  ops_segment_reports: () => ok([]),
  crm_work_orders: () => ok([]),
  ops_segments: () => ok([]),
});

describe('getDepotStock failar stängt', () => {
  it('räknar normalt när alla läsningar svarar', async () => {
    const res = await getDepotStock(makeClient({ ...base(), ops_depot_deliveries: () => ok([delivery]) }));
    expect(res.error).toBeNull();
    expect(res.data[0].rows[0]).toMatchObject({ material: 'EKOVILLA', delivered: 1 });
  });

  it('ett fel på SIDA 2 av rapporterna ger ett fel, inte ett tal', async () => {
    // 🧨 Den farligaste varianten: supersede-regeln prövas bara på rader som kom fram, så en final
    // på den kapade sidan gör att jobbets delrapporter räknas — dubbeldebitering av depån. Loopen
    // `break`:ade tidigare vid fel och returnerade de sidor som hunnit komma.
    const page1 = Array.from({ length: 1000 }, () => ({ work_order_id: 'wo1', sacks_blown: 1, kind: 'partial', material: 'EKOVILLA' }));
    const res = await getDepotStock(makeClient({
      ...base(),
      ops_segment_reports: (from) => (from === 0 ? ok(page1) : fail('nätverksfel på sida 2')),
    }));
    expect(res.error?.message).toBe('nätverksfel på sida 2');
    expect(res.data).toEqual([]);
  });

  it('ett fel på leveransläsningen ger fel — inte delivered = 0 och uppblåst brist', async () => {
    const res = await getDepotStock(makeClient({ ...base(), ops_depot_deliveries: () => fail('leveranser nere') }));
    expect(res.error?.message).toBe('leveranser nere');
    expect(res.data).toEqual([]);
  });

  it('ett fel på bilarna ger fel — inte en tom depåkarta och noll förbrukning', async () => {
    const res = await getDepotStock(makeClient({ ...base(), ops_trucks: () => fail('bilar nere') }));
    expect(res.error?.message).toBe('bilar nere');
    expect(res.data).toEqual([]);
  });

  it('ett fel på arbetsordrarna ger fel — inte planned = 0 och tyst banderoll', async () => {
    const res = await getDepotStock(makeClient({ ...base(), crm_work_orders: () => fail('ordrar nere') }));
    expect(res.error?.message).toBe('ordrar nere');
    expect(res.data).toEqual([]);
  });

  it('ett fel på depålistan ger fel', async () => {
    const res = await getDepotStock(makeClient({ ...base(), ops_depots: () => fail('depåer nere') }));
    expect(res.error?.message).toBe('depåer nere');
  });
});

describe('getDepotStock paginerar', () => {
  it('lägger ihop alla sidor av leveranserna — en full första sida är inte hela svaret', async () => {
    // 🧨 PostgREST kapar vid max-rows UTAN att fela. En kapad leveranslista sänker `delivered`, och
    // det driver ÖVERbeställning: bristen ser större ut än den är.
    const full = Array.from({ length: 1000 }, () => delivery);
    const rest = Array.from({ length: 500 }, () => delivery);
    const res = await getDepotStock(makeClient({
      ...base(),
      ops_depot_deliveries: (from) => (from === 0 ? ok(full) : from === 1000 ? ok(rest) : ok([])),
    }));
    expect(res.error).toBeNull();
    expect(res.data[0].rows[0].delivered).toBe(1500);
  });

  it('slutar läsa när en sida inte är full', async () => {
    let calls = 0;
    const res = await getDepotStock(makeClient({
      ...base(),
      ops_depot_deliveries: () => {
        calls += 1;
        return ok([delivery]);
      },
    }));
    expect(res.error).toBeNull();
    expect(calls).toBe(1);
  });
});
