import { describe, it, expect } from 'vitest';
import { getDepotStockWithForecast } from '@/lib/domains/planning/depotStock';

// Läsvägarna i depotStock, till skillnad från de rena funktionerna bredvid.
//
// 🧨 Det som vaktas här är att beräkningen failar STÄNGT. Fem läsningar svalde tidigare sina fel och
// getDepotStock returnerade hårdkodat `error: null`, så rutten kunde bara vidarebefordra ett fel den
// aldrig fick. Utfallet blev ett TAL i stället för ett fel — och åt olika håll beroende på vilken
// läsning som gick sönder. "Behöver 0 säck" är en lögn som snart ska få fylla i en beställning.

type PageResult = { data: unknown[] | null; error: { message: string } | null };

/**
 * Minimal Supabase-klient där varje tabell svarar per sida (range-offset → svar).
 *
 * ⚠️ `rpc` MÅSTE FINNAS HÄR. Kedjan är handrullad, så varje metod produktionskoden börjar använda
 * måste läggas till — annars kraschar testet med "is not a function" i stället för att pröva det
 * det finns för. Leveransvillkoren läses via rpc('planning_supply_terms') just för att tabellen är
 * hårdare RLS-grindad än rutten.
 */
function makeClient(
  tables: Record<string, (from: number | null) => PageResult>,
  rpcs: Record<string, () => PageResult> = {},
) {
  return {
    rpc(name: string) {
      const responder = rpcs[name] ?? (() => ({ data: [], error: null }));
      return Promise.resolve(responder());
    },
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
// Fast datum: prognosen behöver ett 'idag', och ett rörligt hade gjort testerna beroende av
// när de kördes. stockholmTodayISO() hör hemma i routen, inte här.
const TODAY = '2026-09-14';

/** Grundläge: allt svarar tomt och felfritt. */
const base = (): Record<string, (from: number | null) => PageResult> => ({
  ops_depots: () => ok([depot]),
  ops_trucks: () => ok([]),
  ops_depot_deliveries: () => ok([]),
  ops_segment_reports: () => ok([]),
  crm_work_orders: () => ok([]),
  ops_segments: () => ok([]),
});

describe('getDepotStockWithForecast failar stängt', () => {
  it('räknar normalt när alla läsningar svarar', async () => {
    const res = await getDepotStockWithForecast(makeClient({ ...base(), ops_depot_deliveries: () => ok([delivery]) }), TODAY);
    expect(res.error).toBeNull();
    expect(res.data[0].rows[0]).toMatchObject({ material: 'EKOVILLA', delivered: 1 });
  });

  it('ett fel på SIDA 2 av rapporterna ger ett fel, inte ett tal', async () => {
    // 🧨 Den farligaste varianten: supersede-regeln prövas bara på rader som kom fram, så en final
    // på den kapade sidan gör att jobbets delrapporter räknas — dubbeldebitering av depån. Loopen
    // `break`:ade tidigare vid fel och returnerade de sidor som hunnit komma.
    const page1 = Array.from({ length: 1000 }, () => ({ work_order_id: 'wo1', sacks_blown: 1, kind: 'partial', material: 'EKOVILLA' }));
    const res = await getDepotStockWithForecast(makeClient({
      ...base(),
      ops_segment_reports: (from) => (from === 0 ? ok(page1) : fail('nätverksfel på sida 2')),
    }), TODAY);
    expect(res.error?.message).toBe('nätverksfel på sida 2');
    expect(res.data).toEqual([]);
  });

  it('ett fel på leveransläsningen ger fel — inte delivered = 0 och uppblåst brist', async () => {
    const res = await getDepotStockWithForecast(makeClient({ ...base(), ops_depot_deliveries: () => fail('leveranser nere') }), TODAY);
    expect(res.error?.message).toBe('leveranser nere');
    expect(res.data).toEqual([]);
  });

  it('ett fel på bilarna ger fel — inte en tom depåkarta och noll förbrukning', async () => {
    const res = await getDepotStockWithForecast(makeClient({ ...base(), ops_trucks: () => fail('bilar nere') }), TODAY);
    expect(res.error?.message).toBe('bilar nere');
    expect(res.data).toEqual([]);
  });

  it('ett fel på arbetsordrarna ger fel — inte planned = 0 och tyst banderoll', async () => {
    const res = await getDepotStockWithForecast(makeClient({ ...base(), crm_work_orders: () => fail('ordrar nere') }), TODAY);
    expect(res.error?.message).toBe('ordrar nere');
    expect(res.data).toEqual([]);
  });

  it('ett fel på depålistan ger fel', async () => {
    const res = await getDepotStockWithForecast(makeClient({ ...base(), ops_depots: () => fail('depåer nere') }), TODAY);
    expect(res.error?.message).toBe('depåer nere');
  });

  // Prognosen tillför två läsningar till, och båda måste faila stängt av samma skäl som de
  // ursprungliga fem: ett halvt underlag ger ett TAL i stället för ett fel, och talet pekar åt fel
  // håll. Faller de väntade leveranserna bort saknas inflödet -> uppblåst brist -> överbeställning.
  // Faller leverantörerna bort försvinner ledtid och pallstorlek -> förslaget dateras för sent.
  it('propagerar fel från väntade leveranser', async () => {
    const res = await getDepotStockWithForecast(
      makeClient({ ...base(), ops_expected_deliveries: () => fail('väntade leveranser nere') }),
      TODAY,
    );
    expect(res.error?.message).toBe('väntade leveranser nere');
    expect(res.forecast).toBeNull();
  });

  // ⚠️ Faller räkningarna bort räknas varje avstämd depå om över ALL TID — tillbaka till fantomsaldot
  // (t.ex. Sandvikens −1100) som avstämningen fanns för att ersätta. Och det syns inte: siffran ser
  // lika räknad ut. Ett fel är ett svar; ett tyst återfall till gamla siffror är det inte.
  it('propagerar fel från avstämningarna', async () => {
    const res = await getDepotStockWithForecast(
      makeClient({ ...base(), ops_depot_stock_counts: () => fail('räkningar nere') }),
      TODAY,
    );
    expect(res.error?.message).toBe('räkningar nere');
    expect(res.forecast).toBeNull();
    expect(res.data).toEqual([]);
  });

  it('en räkning blir baslinje hela vägen genom läsningen', async () => {
    const res = await getDepotStockWithForecast(
      makeClient({
        ...base(),
        // Levererat 2000 i augusti, men räknat 400 i september: saldot ska vara 400, inte 2000.
        ops_depot_deliveries: () => ok([{ depot_id: 'd1', material: 'EKOVILLA', sacks: 2000, delivered_on: '2026-08-01' }]),
        ops_depot_stock_counts: () => ok([{ depot_id: 'd1', material: 'EKOVILLA', counted_sacks: 400, counted_on: '2026-09-10' }]),
      }),
      TODAY,
    );
    expect(res.error).toBeNull();
    const row = res.data[0].rows.find((r) => r.material === 'EKOVILLA');
    expect(row?.balance).toBe(400);
    expect(row?.counted).toBe(400);
    // Prognosen räknar från samma baslinje — de får inte kunna säga olika saker.
    expect(res.forecast?.rows.find((r) => r.material === 'EKOVILLA')?.opening).toBe(400);
  });

  /**
   * 🧨 SUPERSEDE GENOM HELA LÄSVÄGEN — och varför det måste provas HÄR och inte bara i enhetstestet.
   *
   * Min första version drog förbrukningen genom samma datumfilter som leveranserna. En egenkontroll
   * ERSÄTTER delrapporterna och bär sitt eget datum, så filtret drog av hela jobbet efter räkningen.
   * consumptionAfterCounts har egna enhetstester, men de anropar funktionen DIREKT: skulle läsvägen
   * kopplas tillbaka till datumfiltret märks det inte där. Bara ett test genom getDepotStockWithForecast
   * fångar det — mutationstestat, datumfiltret ger 280 i stället för 330.
   */
  it('en egenkontroll efter räkningen drar bara av det som blåstes efter den', async () => {
    const res = await getDepotStockWithForecast(
      makeClient({
        ...base(),
        ops_trucks: () => ok([{ id: 't1', depot_id: 'd1' }]),
        ops_segment_reports: () => ok([
          // Fredag: delrapport 50. Måndag: egenkontroll 120 för hela jobbet. Räknat måndag morgon: 400.
          { work_order_id: 'wo1', sacks_blown: 50, kind: 'partial', material: 'EKOVILLA', report_day: '2026-09-11', segment: { truck_id: 't1' } },
          { work_order_id: 'wo1', sacks_blown: 120, kind: 'final', material: 'EKOVILLA', report_day: '2026-09-14', segment: { truck_id: 't1' } },
        ]),
        ops_depot_stock_counts: () => ok([{ depot_id: 'd1', material: 'EKOVILLA', counted_sacks: 400, counted_on: '2026-09-14' }]),
      }),
      TODAY,
    );
    expect(res.error).toBeNull();
    // 400 − 70 (bara det efter räkningen). Datumfiltret gav 400 − 120 = 280.
    expect(res.data[0].rows.find((r) => r.material === 'EKOVILLA')?.balance).toBe(330);
  });

  it('propagerar fel från leveransvillkoren', async () => {
    const res = await getDepotStockWithForecast(
      makeClient(base(), { planning_supply_terms: () => fail('villkoren nere') }),
      TODAY,
    );
    expect(res.error?.message).toBe('villkoren nere');
    expect(res.forecast).toBeNull();
  });

  /**
   * 🧨 RLS NEKAR INTE, DEN FILTRERAR — och det är därför den här raden finns.
   *
   * ops_material_suppliers SELECT kräver planning.depot.manage medan rutten grindar på
   * planning.schedule.read. För sales och konsult kom NOLL RADER tillbaka UTAN FEL, prognosen föll
   * tyst tillbaka på ingen ledtid, och "beställ senast" blev run-out-dagen själv. Ett tomt svar får
   * alltså aldrig se ut som ett räknat svar.
   */
  it('tomma leveransvillkor ger INGET föreslaget datum, inte run-out-dagen', async () => {
    const res = await getDepotStockWithForecast(
      makeClient(
        {
          ...base(),
          ops_depots: () => ok([depot]),
          ops_trucks: () => ok([{ id: 't1', depot_id: 'd1' }]),
          ops_depot_deliveries: () => ok([]),
          crm_work_orders: () => ok([
            { id: 'wo1', status: 'scheduled', line_items: [{ article_name: 'Ekovilla lösull', density: '30', pricing_mode: 'm2', m2: '100', thickness_mm: '400' }] },
          ]),
          ops_segments: () => ok([{ id: 's1', work_order_id: 'wo1', truck_id: 't1', start_day: '2026-09-30' }]),
        },
        { planning_supply_terms: () => ok([]) },
      ),
      TODAY,
    );
    expect(res.error).toBeNull();
    const row = res.forecast?.rows.find((r) => r.material === 'EKOVILLA');
    expect(row?.run_out_day).toBe('2026-09-30');
    expect(row?.supply_known).toBe(false);
    expect(row?.suggested_date).toBeNull();
  });

  it('ger en prognos när allt svarar', async () => {
    const res = await getDepotStockWithForecast(
      makeClient({ ...base(), ops_depot_deliveries: () => ok([delivery]) }),
      TODAY,
    );
    expect(res.error).toBeNull();
    expect(res.forecast?.rows).toEqual([
      expect.objectContaining({ depot_id: 'd1', material: 'EKOVILLA', opening: 1, run_out_day: null }),
    ]);
  });
});

/**
 * ⚠️ BESTÄLLNINGSSPÅRETS KÄRNINVARIANT, OCH DEN SAKNADE VAKT HELT.
 *
 * En väntad leverans är material som är BESTÄLLT, inte material som STÅR på depån. Räknades den i
 * saldot skulle bristvarningen slockna så fort någon lagt in en beställning — oavsett om fabriken
 * levererar — och felet upptäcks först när en bil står utan material.
 *
 * Prognosen SKA däremot se den, som inflöde. De två påståendena prövas här tillsammans, för det är
 * skillnaden mellan dem som är hela poängen.
 */
describe('väntade leveranser rör aldrig saldot — men syns i prognosen', () => {
  const wideBase = () => ({
    ...base(),
    ops_trucks: () => ok([{ id: 't1', depot_id: 'd1' }]),
    crm_work_orders: () => ok([
      { id: 'wo1', status: 'scheduled', line_items: [{ article_name: 'Ekovilla lösull', density: '30', pricing_mode: 'm2', m2: '100', thickness_mm: '400' }] },
    ]),
    ops_segments: () => ok([{ id: 's1', work_order_id: 'wo1', truck_id: 't1', start_day: '2026-09-30' }]),
  });

  it('saldot är identiskt med och utan en väntad leverans', async () => {
    const utan = await getDepotStockWithForecast(makeClient(wideBase()), TODAY);
    const med = await getDepotStockWithForecast(
      makeClient({
        ...wideBase(),
        ops_expected_deliveries: () => ok([
          { id: 'e1', depot_id: 'd1', material: 'EKOVILLA', sacks: 5000, expected_on: '2026-09-25', note: null, status: 'expected', depot: { name: 'Syd' } },
        ]),
      }),
      TODAY,
    );
    expect(utan.error).toBeNull();
    expect(med.error).toBeNull();
    // 5000 säck på väg får inte flytta EN ENDA säck i saldot.
    expect(med.data).toEqual(utan.data);
  });

  it('men prognosen räknar in den som inflöde och bristen försvinner', async () => {
    const med = await getDepotStockWithForecast(
      makeClient({
        ...wideBase(),
        ops_expected_deliveries: () => ok([
          { id: 'e1', depot_id: 'd1', material: 'EKOVILLA', sacks: 5000, expected_on: '2026-09-25', note: null, status: 'expected', depot: { name: 'Syd' } },
        ]),
      }),
      TODAY,
    );
    const row = med.forecast?.rows.find((r) => r.material === 'EKOVILLA');
    expect(row?.run_out_day).toBeNull();
    expect(row?.worst_deficit).toBe(0);

    // Utan den täcks ingenting — annars vore testet ovan tomt.
    const utan = await getDepotStockWithForecast(makeClient(wideBase()), TODAY);
    expect(utan.forecast?.rows.find((r) => r.material === 'EKOVILLA')?.worst_deficit).toBeGreaterThan(0);
  });
});

describe('getDepotStockWithForecast paginerar', () => {
  it('lägger ihop alla sidor av leveranserna — en full första sida är inte hela svaret', async () => {
    // 🧨 PostgREST kapar vid max-rows UTAN att fela. En kapad leveranslista sänker `delivered`, och
    // det driver ÖVERbeställning: bristen ser större ut än den är.
    const full = Array.from({ length: 1000 }, () => delivery);
    const rest = Array.from({ length: 500 }, () => delivery);
    const res = await getDepotStockWithForecast(makeClient({
      ...base(),
      ops_depot_deliveries: (from) => (from === 0 ? ok(full) : from === 1000 ? ok(rest) : ok([])),
    }), TODAY);
    expect(res.error).toBeNull();
    expect(res.data[0].rows[0].delivered).toBe(1500);
  });

  it('slutar läsa när en sida inte är full', async () => {
    let calls = 0;
    const res = await getDepotStockWithForecast(makeClient({
      ...base(),
      ops_depot_deliveries: () => {
        calls += 1;
        return ok([delivery]);
      },
    }), TODAY);
    expect(res.error).toBeNull();
    expect(calls).toBe(1);
  });
});
