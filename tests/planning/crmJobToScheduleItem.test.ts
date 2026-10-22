import { describe, it, expect } from 'vitest';
import { compareScheduleItems, compareScheduleRows, crmJobToScheduleItem, type CrmJobRow, type ScheduleRow } from '@/lib/domains/planning/myJobs';

// The dashboard week schedule renders the legacy get_my_jobs row shape. A CRM job is adapted into
// that shape so it goes through the same card markup — these tests pin the field names the card
// reads, and the `source` marker the three legacy-only code paths branch on.

const crm = (over: Partial<CrmJobRow> = {}): CrmJobRow => ({
  segment_id: 'seg-c1',
  work_order_id: 'wo-1',
  order_number: 'AO-20260810-A1B2',
  fortnox_order_number: '5418',
  project_name: 'Vindsisolering',
  customer: 'Villa Ek',
  job_day: '2026-08-11',
  start_day: '2026-08-11',
  end_day: '2026-08-12',
  truck: 'Bil 2',
  truck_color: '#16a34a',
  job_type: 'Vitull',
  status: 'scheduled',
  work_address: {},
  customer_address: {},
  placeholder_title: null,
  work_description: null,
  sort_index: 0,
  ...over,
});

// En publicerad platshållare: bokad dag utan arbetsorder (service av maskiner, intern dag).
const placeholder = (over: Partial<CrmJobRow> = {}): CrmJobRow =>
  crm({
    work_order_id: null,
    order_number: null,
    fortnox_order_number: null,
    project_name: null,
    customer: null,
    status: null,
    placeholder_title: 'Service av blåsmaskin',
    work_description: 'Filterbyte och smörjning.',
    ...over,
  });

describe('crmJobToScheduleItem', () => {
  it('produces the fields the dashboard card reads', () => {
    expect(crmJobToScheduleItem(crm())).toEqual({
      segment_id: 'seg-c1',
      project_id: null,
      project_name: 'Vindsisolering',
      customer: 'Villa Ek',
      address: null,
      order_number: '#5418',
      start_day: '2026-08-11',
      end_day: '2026-08-12',
      job_day: '2026-08-11',
      truck: 'Bil 2',
      job_type: 'Vitull',
      bag_count: null,
      source: 'crm',
      work_order_id: 'wo-1',
      work_description: null,
      sort_index: 0,
    });
  });

  it('marks the row so the legacy-only paths can skip it', () => {
    // Without this the enrichment queries hit planning_* by a CRM uuid, the detail modal looks up
    // a Blikk project by order number, and the time button opens an empty form.
    expect(crmJobToScheduleItem(crm()).source).toBe('crm');
  });

  it('carries the work order id so the card can lead to the field view', () => {
    expect(crmJobToScheduleItem(crm()).work_order_id).toBe('wo-1');
  });

  it('leads with the Fortnox number, falling back to the internal order number', () => {
    expect(crmJobToScheduleItem(crm()).order_number).toBe('#5418');
    expect(crmJobToScheduleItem(crm({ fortnox_order_number: null })).order_number).toBe('AO-20260810-A1B2');
  });

  it('keeps project_id null — a CRM job has no Blikk project to report time against', () => {
    expect(crmJobToScheduleItem(crm()).project_id).toBeNull();
  });

  it('falls back to the segment start when the expanded day is missing', () => {
    expect(crmJobToScheduleItem(crm({ job_day: null })).job_day).toBe('2026-08-11');
  });

  // ── Adressen (kortets rubrik) ─────────────────────────────────────────────
  // Samma upplösning som /mina-jobb: en separat arbetsadress vinner, annars kundens.
  it('rubriksätter med arbetsadressen när ordern har en egen', () => {
    const row = crm({
      work_address: { street_address: 'Strandgatan 9', postal_code: '814 94', city: 'Skutskär' },
      customer_address: { street_address: 'Kundvägen 1', postal_code: '111 11', city: 'Stockholm' },
    });
    expect(crmJobToScheduleItem(row).address).toBe('Strandgatan 9, 814 94, Skutskär');
  });

  it('faller tillbaka på kundens adress, med leveransadressen först', () => {
    expect(crmJobToScheduleItem(crm({
      customer_address: { street_address: 'Kundvägen 1', postal_code: '111 11', city: 'Stockholm' },
    })).address).toBe('Kundvägen 1, 111 11, Stockholm');
    expect(crmJobToScheduleItem(crm({
      customer_address: { delivery_address: 'Lagergatan 2', delivery_city: 'Uppsala', street_address: 'Kundvägen 1' },
    })).address).toBe('Lagergatan 2, Uppsala');
  });

  it('ger platshållaren ingen adress — feeden skickar bara nullfält för den', () => {
    // get_my_crm_jobs bygger customer_address med jsonb_build_object även utan order, så objektet
    // finns men alla värden är null. Kortet ska då rubriksättas med titeln, inte med en tom adress.
    const nulls = { delivery_address: null, delivery_postal_code: null, delivery_city: null, street_address: null, postal_code: null, city: null };
    expect(crmJobToScheduleItem(placeholder({ work_address: null, customer_address: nulls })).address).toBeNull();
  });

  // ── Publicerade platshållare ──────────────────────────────────────────────
  // De kommer ur samma RPC som riktiga jobb men saknar arbetsorder. Kortet i veckoschemat
  // navigerar till /arbetsorder/<id> och ritar en "Öppna order"-knapp, båda grindade på
  // work_order_id — så det fältet MÅSTE vara null här, annars får besättningen en knapp som
  // leder till /arbetsorder/null.
  it('lämnar work_order_id null på en platshållare, så kortets orderväg stängs', () => {
    expect(crmJobToScheduleItem(placeholder()).work_order_id).toBeNull();
  });

  it('använder platshållarens titel som rubrik', () => {
    expect(crmJobToScheduleItem(placeholder()).project_name).toBe('Service av blåsmaskin');
  });

  it('ger platshållaren inget ordernummer att visa', () => {
    // `workOrderRef(null, '')` svarar med tomma strängen, som hade ritat en tom separatorprick
    // efter kundnamnet i stället för att utebli.
    expect(crmJobToScheduleItem(placeholder()).order_number).toBeNull();
  });

  it('bär arbetsbeskrivningen vidare till kortet', () => {
    expect(crmJobToScheduleItem(placeholder()).work_description).toBe('Filterbyte och smörjning.');
  });
});

// ── Ordningen på dagen ───────────────────────────────────────────────────────
// Planeraren väljer vilket jobb som görs först när flera ligger på samma bil samma dag. Startsidan
// sorterade CRM-jobben på ORDERNUMRET, så valet nådde aldrig dem som kör jobben (2026-10-22).
describe('compareScheduleItems', () => {
  const day = (over: Partial<CrmJobRow>) => crmJobToScheduleItem(crm({ job_day: '2026-10-22', ...over }));
  const order = (...items: ReturnType<typeof day>[]) => [...items].sort(compareScheduleItems).map((it) => it.segment_id);

  it('följer planerarens ordning, inte ordernumret', () => {
    // Ordernumren pekar åt andra hållet: på ordernumret hade #100 stått först.
    const first = day({ segment_id: 'seg-b', fortnox_order_number: '200', start_day: '2026-10-22', end_day: '2026-10-22', sort_index: 0 });
    const second = day({ segment_id: 'seg-a', fortnox_order_number: '100', start_day: '2026-10-22', end_day: '2026-10-22', sort_index: 1 });
    expect(order(second, first)).toEqual(['seg-b', 'seg-a']);
  });

  it('ställer jobbet som fortsätter från igår först när ordningen är lika', () => {
    const continuing = day({ segment_id: 'seg-z', fortnox_order_number: '900', start_day: '2026-10-21', end_day: '2026-10-22', sort_index: 4 });
    const starting = day({ segment_id: 'seg-a', fortnox_order_number: '100', start_day: '2026-10-22', end_day: '2026-10-22', sort_index: 4 });
    expect(order(starting, continuing)).toEqual(['seg-z', 'seg-a']);
  });

  it('låter startdagen avgöra när feeden saknar talet', () => {
    const continuing = day({ segment_id: 'seg-z', start_day: '2026-10-21', end_day: '2026-10-22', sort_index: null });
    const starting = day({ segment_id: 'seg-a', start_day: '2026-10-22', end_day: '2026-10-22', sort_index: null });
    expect(order(starting, continuing)).toEqual(['seg-z', 'seg-a']);
  });

  it('bär talet från feeden och lämnar null när det saknas', () => {
    expect(crmJobToScheduleItem(crm({ sort_index: 3 })).sort_index).toBe(3);
    expect(crmJobToScheduleItem(crm({ sort_index: null })).sort_index).toBeNull();
  });
});

// Startsidans hela jämförelse: bil, källa, sedan källans egen ordning.
describe('compareScheduleRows', () => {
  type Legacy = { truck: string; order_number: string; project_name: string; sort_index: number | null };
  const legacy = (over: Partial<Legacy>): Legacy => ({ truck: 'Bil 1', order_number: '150', project_name: 'Gammalt', sort_index: null, ...over });
  // Som startsidans getSortIndex: radens eget `sort_index` först. Det är så ett CRM-jobbs tal hade
  // läckt in i en jämförelse med en Blikk-rad om källan inte avgjorde först.
  const legacySort = (row: object) => {
    const v = (row as { sort_index?: number | null }).sort_index;
    return typeof v === 'number' ? v : null;
  };
  const item = (over: Partial<CrmJobRow>) =>
    crmJobToScheduleItem(crm({ job_day: '2026-10-22', start_day: '2026-10-22', end_day: '2026-10-22', truck: 'Bil 1', ...over }));
  const label = (r: ScheduleRow) => ('segment_id' in r ? r.segment_id : `legacy:${r.order_number}`);
  const sorted = (rows: ScheduleRow[]) => [...rows].sort((a, b) => compareScheduleRows(a, b, legacySort)).map(label);

  it('ställer CRM-jobben i planerarens ordning', () => {
    const a = item({ segment_id: 'seg-a', fortnox_order_number: '100', sort_index: 1 });
    const b = item({ segment_id: 'seg-b', fortnox_order_number: '200', sort_index: 0 });
    expect(sorted([a, b])).toEqual(['seg-b', 'seg-a']);
  });

  it('jämför aldrig CRM-jobbens tal med de gamla radernas — de gamla står först', () => {
    // CRM-jobbets 0 är mindre än Blikk-radens 3, men talserierna har inget med varandra att göra.
    const crmJob = item({ segment_id: 'seg-a', sort_index: 0 });
    const old = legacy({ sort_index: 3 });
    expect(sorted([crmJob, old])).toEqual(['legacy:150', 'seg-a']);
    expect(sorted([old, crmJob])).toEqual(['legacy:150', 'seg-a']);
  });

  it('ger samma ordning hur raderna än kommer in (granskningens cykel)', () => {
    // CRM-par på id och blandade par på ordernummer gav B < A, A < L, L < B — en cykel, och
    // resultatet berodde på i vilken ordning de två anropen svarade.
    const a = item({ segment_id: 'z', fortnox_order_number: '100', sort_index: 5 });
    const b = item({ segment_id: 'a', fortnox_order_number: '200', sort_index: 5 });
    const l = legacy({ sort_index: 5 });
    const perms = [[a, b, l], [a, l, b], [b, a, l], [b, l, a], [l, a, b], [l, b, a]];
    for (const p of perms) expect(sorted(p)).toEqual(['legacy:150', 'a', 'z']);
  });

  it('sorterar de gamla raderna som förut: deras ordning, sedan ordernummer', () => {
    const x = legacy({ order_number: '300', sort_index: 0 });
    const y = legacy({ order_number: '100', sort_index: 1 });
    const z = legacy({ order_number: '050', sort_index: null });
    expect(sorted([z, y, x])).toEqual(['legacy:300', 'legacy:100', 'legacy:050']);
  });

  it('grupperar på bil först', () => {
    const bil2 = item({ segment_id: 'seg-2', truck: 'Bil 2', sort_index: 0 });
    const bil1 = item({ segment_id: 'seg-1', truck: 'Bil 1', sort_index: 9 });
    expect(sorted([bil2, bil1])).toEqual(['seg-1', 'seg-2']);
  });
});
