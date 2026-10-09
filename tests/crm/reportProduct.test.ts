import { describe, it, expect } from 'vitest';
import {
  buildDepotSplit,
  buildProductVolume,
  buildReportProduct,
  buildVolumeByMonth,
  orderDepots,
  scheduleOrderIds,
  volumeLines,
  volumeOrderIds,
  type ProductDepotRow,
  type ProductSegmentRow,
  type ProductStockRow,
} from '@/lib/domains/crm/reportProduct';
import { computePricing, lineItemRowTotal } from '@/lib/domains/crm/pricing';
import { partitionOrders, type ReportOrderRow } from '@/lib/domains/crm/reports';
import type { InvoicedRevenue } from '@/lib/domains/crm/invoicedRevenue';

// Produkt & marknad (spec 2026-10-07, 4.5): sålda m³, kr/m³ per konstruktion och material, m³ per
// månad och fakturerat och orderstock per depå.

const order = (id: string | undefined, over: Partial<ReportOrderRow> = {}): ReportOrderRow => ({
  id,
  amount: 10_000,
  vat_percent: 0,
  status: 'scheduled',
  created_at: '2026-09-10T08:00:00Z',
  fortnox_invoiced_at: null,
  partial_invoicing_started_at: null,
  assigned_to: null,
  client_name: 'Kund A',
  quote_type: 'business',
  customer_id: null,
  rot_enabled: null,
  customer: null,
  ...over,
});

/** En m³-rad: yta × tjocklek (mm) till ett à-pris. */
const m3Row = (m2: number, mm: number, price: number, over: Record<string, unknown> = {}) => ({
  pricing_mode: 'm3', m2: String(m2), thickness_mm: String(mm), unit_price: String(price),
  article_name: 'Ekovilla lösull vind', construction: 'vind', ...over,
});
const itemRow = (price: number) => ({ pricing_mode: 'item', quantity: '1', unit_price: String(price), article_name: 'Vindduk', construction: '' });

describe('volumeLines — orderns m³-rader', () => {
  it('räknar m³ som yta × tjocklek och priset som lineItemRowTotal, utan styckrader', () => {
    const [line, ...rest] = volumeLines([m3Row(100, 300, 400), itemRow(1500)]);
    expect(rest).toHaveLength(0);
    expect(line).toEqual({ m3: 30, value: 12_000, construction: 'vind', material: 'EKOVILLA' });
  });

  it('en rad utan pricing_mode är en m³-rad — samma regel som lineItemQuantity', () => {
    const { pricing_mode: _omitted, ...row } = m3Row(10, 100, 500);
    expect(volumeLines([row])).toHaveLength(1);
  });

  it('en rad utan volym räknas inte (den tomma raden står som m³ från start)', () => {
    expect(volumeLines([m3Row(0, 300, 400), { pricing_mode: 'm3', m2: '', thickness_mm: '', unit_price: '' }])).toEqual([]);
  });

  it('rabatten dras av, och artikelns pris gäller när à-priset är tomt', () => {
    const [discounted] = volumeLines([m3Row(100, 100, 500, { discount_percent: '10' })]);
    expect(discounted.value).toBe(4_500);
    const [catalogue] = volumeLines([m3Row(100, 100, 0, { unit_price: '', article_price: 300 })]);
    expect(catalogue.value).toBe(3_000);
  });

  it('läser en gammal rad med tal i stället för strängar, och kommatecken', () => {
    const [line] = volumeLines([{ pricing_mode: 'm3', m2: 50, thickness_mm: 200, unit_price: '450,50', article_name: 'Knauf Supafil', construction: 'vagg' }]);
    expect(line).toMatchObject({ m3: 10, value: 4_505, construction: 'vagg', material: 'KNAUF SUPAFIL' });
  });

  it('konstruktionen normaliseras; okänd, tom eller icke-sträng blir null utan att kasta', () => {
    const lines = volumeLines([
      m3Row(10, 100, 1, { construction: ' Snedtak ' }),
      m3Row(10, 100, 1, { construction: 'garage' }),
      m3Row(10, 100, 1, { construction: '' }),
      m3Row(10, 100, 1, { construction: 42 }),
      m3Row(10, 100, 1, { construction: null }),
    ]);
    expect(lines.map((line) => line.construction)).toEqual(['snedtak', null, null, null, null]);
  });

  it('materialet ur artikelnamnet; okänt fabrikat blir null', () => {
    const lines = volumeLines([m3Row(10, 100, 1, { article_name: 'Lösull vind (okänt fabrikat)' }), m3Row(10, 100, 1, { article_name: 42 })]);
    expect(lines.map((line) => line.material)).toEqual([null, null]);
  });

  it('tål det som inte är en lista eller ett objekt', () => {
    expect(volumeLines(null)).toEqual([]);
    expect(volumeLines('[]')).toEqual([]);
    expect(volumeLines([null, 'rad', 3])).toEqual([]);
  });

  // ⚠️ Specen bad om kontrollen: radtotalen ska vara HELA radens pris, netto — också när ROT bryter ut
  // arbetet. Utbrytningen är en del av priset, inget avdrag, och ROT dras från kundens att betala.
  it('🔒 ROT-utbrytningen sänker inte radens pris, och priset är exklusive moms', () => {
    const row = m3Row(100, 100, 500, { labor_cost: '200' });
    const [line] = volumeLines([row]);
    expect(line.value).toBe(5_000);
    const pricing = computePricing([row], 25, { isPrivate: true, rot: { enabled: true, rot_percent: 30, max_deduction: 50_000 } });
    // subtotal = summan av radtotalerna (netto); arbetet står i carvedLabor och är redan inräknat.
    expect(pricing.subtotal).toBe(lineItemRowTotal(row));
    expect(pricing.carvedLabor).toBe(2_000);
    expect(pricing.total).toBe(6_250);
    expect(pricing.rotDeduction).toBeGreaterThan(0);
  });
});

describe('buildProductVolume — periodens sålda m³', () => {
  const lineItems = new Map<string, unknown>([
    ['a', [m3Row(20, 100, 1000), itemRow(2_500)]], // 2 m³ à 1000
    ['b', [m3Row(1000, 200, 300, { construction: 'vagg', article_name: 'Knauf Supafil vägg' })]], // 200 m³ à 300
    ['c', [itemRow(1_500)]], // bara styckrad
    ['x', [m3Row(1000, 1000, 1000)]], // avbruten
  ]);

  it('kr/m³ är summan delad med summan — inte ett snitt av radernas priser', () => {
    const { total } = buildProductVolume([order('a'), order('b'), order('c'), order('x', { status: 'cancelled' })], lineItems);
    expect(total.m3).toBe(202);
    expect(total.value).toBe(62_000);
    expect(total.pricePerM3).toBeCloseTo(62_000 / 202, 6);
    // a och b har m³; c har bara en styckrad och x är avbruten.
    expect(total.orders).toBe(2);
  });

  it('räknar inte avbrutna order, inte heller när listan inte är partitionerad', () => {
    expect(buildProductVolume([order('x', { status: 'cancelled' })], lineItems).total.m3).toBe(0);
  });

  it('en order utan id eller utan rader i läsningen bidrar inte', () => {
    expect(buildProductVolume([order(undefined), order('saknas')], lineItems).total).toEqual({ m3: 0, value: 0, pricePerM3: null, orders: 0 });
  });

  it('per konstruktion: störst först, utan tomma, och "Saknas" sist även när den är störst', () => {
    const items = new Map<string, unknown>([
      ['a', [m3Row(100, 100, 400, { construction: 'vind' }), m3Row(1000, 100, 300, { construction: '' })]],
      ['b', [m3Row(150, 100, 600, { construction: 'vagg' }), m3Row(100, 100, 500, { construction: 'vind' })]],
    ]);
    const { byConstruction, total } = buildProductVolume([order('a'), order('b')], items);
    // Fyra m³-rader, två order: antalet är order, inte rader.
    expect(total.orders).toBe(2);
    expect(byConstruction.map((row) => [row.construction, row.m3, row.orders])).toEqual([
      ['vind', 20, 2],
      ['vagg', 15, 1],
      [null, 100, 1],
    ]);
    expect(byConstruction[0].pricePerM3).toBe(450);
  });

  it('per konstruktion vid lika volym: vokabulärens ordning (vägg före vind)', () => {
    const items = new Map<string, unknown>([['a', [m3Row(100, 100, 1, { construction: 'vind' }), m3Row(100, 100, 1, { construction: 'vagg' })]]]);
    expect(buildProductVolume([order('a')], items).byConstruction.map((row) => row.construction)).toEqual(['vagg', 'vind']);
  });

  it('per material: andel av volymen, störst först, och "Övrigt/okänt" sist', () => {
    const items = new Map<string, unknown>([
      ['a', [m3Row(300, 100, 1, { article_name: 'Ekovilla' }), m3Row(500, 100, 1, { article_name: 'Okänd lösull' })]],
      ['b', [m3Row(200, 100, 1, { article_name: 'Knauf Supafil' })]],
    ]);
    const { byMaterial } = buildProductVolume([order('a'), order('b')], items);
    expect(byMaterial.map((row) => [row.material, row.m3, row.share])).toEqual([
      ['EKOVILLA', 30, 30],
      ['KNAUF SUPAFIL', 20, 20],
      [null, 50, 50],
    ]);
  });

  it('inget sålt: tomma listor och inget pris — null, inte 0 kr/m³', () => {
    const volume = buildProductVolume([], new Map());
    expect(volume).toEqual({ total: { m3: 0, value: 0, pricePerM3: null, orders: 0 }, byConstruction: [], byMaterial: [] });
  });
});

describe('buildVolumeByMonth — svensk dag', () => {
  it('en order kl. 00.30 svensk tid den 1 september räknas i september, fast UTC säger 31 augusti', () => {
    const lineItems = new Map<string, unknown>([['natt', [m3Row(100, 100, 400)]]]);
    const months = buildVolumeByMonth({
      orders: [order('natt', { created_at: '2026-08-31T22:30:00Z' })],
      lineItems,
      window: { from: '2026-08-01', to: '2026-09-30' },
      selected: { from: '2026-09-01', to: '2026-09-30' },
    });
    expect(months.map((m) => [m.period, m.m3])).toEqual([['2026-08', 0], ['2026-09', 10]]);
  });
});

describe('buildVolumeByMonth — sålda m³ i trendens fönster', () => {
  const window = { from: '2026-06-29', to: '2026-10-07' };
  const selected = { from: '2026-09-01', to: '2026-09-30' };
  const lineItems = new Map<string, unknown>([
    ['jul', [m3Row(100, 100, 400)]],
    ['sep', [m3Row(200, 100, 500)]],
    ['avbr', [m3Row(999, 100, 500)]],
    ['före', [m3Row(999, 100, 500)]],
  ]);
  const orders = [
    order('jul', { created_at: '2026-07-15T08:00:00Z' }),
    order('sep', { created_at: '2026-09-02T08:00:00Z' }),
    order('avbr', { created_at: '2026-09-03T08:00:00Z', status: 'cancelled' }),
    order('före', { created_at: '2026-06-10T08:00:00Z' }),
  ];

  it('en punkt per månad i fönstret, delmånader märkta och vald period markerad', () => {
    const months = buildVolumeByMonth({ orders, lineItems, window, selected });
    expect(months.map((m) => m.period)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(months[0]).toMatchObject({ m3: 0, partial: { from: '2026-06-29', to: '2026-06-30' }, inPeriod: false });
    expect(months[1]).toMatchObject({ m3: 10, value: 4_000, pricePerM3: 400, partial: null });
    // Avbruten bort; ordern före fönstret räknas inte i juni.
    expect(months[3]).toMatchObject({ m3: 20, pricePerM3: 500, inPeriod: true });
    expect(months[4].partial).toEqual({ from: '2026-10-01', to: '2026-10-07' });
  });
});

describe('volumeOrderIds — orderna vars rader läses', () => {
  it('periodens och trendens skapade order, en gång var, utan avbrutna och order utanför fönstret', () => {
    const ids = volumeOrderIds({
      ordersCreated: [order('a'), order('b'), order(undefined)],
      trend: {
        orders: [order('b'), order('c'), order('d', { status: 'cancelled' }), order('e', { created_at: '2025-01-01T08:00:00Z' })],
        window: { from: '2026-06-29', to: '2026-10-07' },
      },
    });
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('utan trend: bara periodens', () => {
    expect(volumeOrderIds({ ordersCreated: [order('a')], trend: null })).toEqual(['a']);
  });
});

// ── Depåerna ──

const segment = (workOrderId: string | null, start: string, end: string, depotId: string | null): ProductSegmentRow => ({
  work_order_id: workOrderId, start_day: start, end_day: end, truck: { depot_id: depotId },
});

describe('orderDepots — orderns depå ur schemat', () => {
  it('flest segmentdagar vinner (3 mot 1)', () => {
    const map = orderDepots([segment('o5', '2026-10-05', '2026-10-07', 'sandviken'), segment('o5', '2026-10-08', '2026-10-08', 'sodertalje')]);
    expect(map.get('o5')).toEqual({ depotId: 'sandviken' });
  });

  it('segment på samma depå läggs ihop', () => {
    const map = orderDepots([
      segment('o', '2026-10-05', '2026-10-05', 'a'),
      segment('o', '2026-10-06', '2026-10-06', 'a'),
      segment('o', '2026-10-07', '2026-10-07', 'b'),
    ]);
    expect(map.get('o')).toEqual({ depotId: 'a' });
  });

  it('dagarna är arbetsdagar: helgen mitt i ett segment räknas inte', () => {
    // a: fre 2 okt – mån 5 okt = 2 arbetsdagar (4 kalenderdagar). b: tis–tors = 3.
    const map = orderDepots([segment('o', '2026-10-02', '2026-10-05', 'a'), segment('o', '2026-10-06', '2026-10-08', 'b')]);
    expect(map.get('o')).toEqual({ depotId: 'b' });
  });

  it('ett segment på en helg väger ändå en dag', () => {
    // a: lördag och söndag, var för sig (2). b: en måndag (1).
    const map = orderDepots([
      segment('o', '2026-10-05', '2026-10-05', 'b'),
      segment('o', '2026-10-03', '2026-10-03', 'a'),
      segment('o', '2026-10-04', '2026-10-04', 'a'),
    ]);
    expect(map.get('o')).toEqual({ depotId: 'a' });
  });

  it('vid lika: depån där orderns första segment började', () => {
    // Testdatans AO-RT-O12: tis–ons i Borlänge, tors–fre i Upplands Väsby. Ordningen i listan ska inte spela roll.
    const borlange = segment('o12', '2026-09-29', '2026-09-30', 'zz-borlange');
    const vasby = segment('o12', '2026-10-01', '2026-10-02', 'aa-vasby');
    expect(orderDepots([vasby, borlange]).get('o12')).toEqual({ depotId: 'zz-borlange' });
    expect(orderDepots([borlange, vasby]).get('o12')).toEqual({ depotId: 'zz-borlange' });
  });

  it('vid lika: den tidigaste starten räknas, också när depåns första segment står sist i listan', () => {
    // a: 8 okt och 1 okt (2 dagar, började 1 okt). b: 5–6 okt (2 dagar).
    const map = orderDepots([
      segment('o', '2026-10-08', '2026-10-08', 'a'),
      segment('o', '2026-10-05', '2026-10-06', 'b'),
      segment('o', '2026-10-01', '2026-10-01', 'a'),
    ]);
    expect(map.get('o')).toEqual({ depotId: 'a' });
  });

  it('vid lika och samma startdag: en riktig depå före "Bil utan depå", sedan depåns id', () => {
    // 'zz' sorterar efter strängen "null" — regeln, inte alfabetet, ska ge depån.
    expect(orderDepots([segment('o', '2026-10-05', '2026-10-05', null), segment('o', '2026-10-05', '2026-10-05', 'zz')]).get('o')).toEqual({ depotId: 'zz' });
    expect(orderDepots([segment('o', '2026-10-05', '2026-10-05', 'b'), segment('o', '2026-10-05', '2026-10-05', 'a')]).get('o')).toEqual({ depotId: 'a' });
  });

  it('en bil utan depå ger depotId null; bilen som lista eller saknad tåls', () => {
    const map = orderDepots([
      segment('o6', '2026-10-12', '2026-10-13', null),
      { work_order_id: 'lista', start_day: '2026-10-05', end_day: '2026-10-05', truck: [{ depot_id: 'a' }] },
      { work_order_id: 'ingen', start_day: '2026-10-05', end_day: '2026-10-05', truck: null },
    ]);
    expect(map.get('o6')).toEqual({ depotId: null });
    expect(map.get('lista')).toEqual({ depotId: 'a' });
    expect(map.get('ingen')).toEqual({ depotId: null });
  });

  it('platshållare (utan order) ignoreras', () => {
    expect([...orderDepots([segment(null, '2026-10-14', '2026-10-14', 'a')]).keys()]).toEqual([]);
  });
});

describe('buildDepotSplit — fakturerat och orderstock per depå', () => {
  const depots: ProductDepotRow[] = [
    { id: 'sv', name: 'Sandviken', active: true },
    { id: 'bo', name: 'Borlänge', active: true },
    { id: 'gammal', name: 'Nedlagd', active: false },
    { id: 'tom', name: 'Tom nedlagd', active: false },
  ];
  const segments = [
    segment('o1', '2026-09-07', '2026-09-08', 'sv'),
    segment('o2', '2026-09-07', '2026-09-08', 'bo'),
    segment('o3', '2026-09-07', '2026-09-08', null),
    segment('o4', '2026-09-07', '2026-09-08', 'gammal'),
    segment('s1', '2026-10-20', '2026-10-21', 'bo'),
  ];
  const invoice = (amount: number, workOrderId: string | null): InvoicedRevenue => ({
    amount, at: '2026-09-15T08:00:00Z', assigned_to: null, client_name: null, quote_type: 'business', work_order_id: workOrderId,
  });
  const revenue = [
    invoice(10_000, 'o1'),
    invoice(40_000, 'o2'),
    // Två rundor på samma order: en order i antalet.
    invoice(3_000, 'o3'),
    invoice(2_000, 'o3'),
    invoice(7_000, 'o4'),
    // Ej planerad fakturerade mer än Nedlagd, men står ändå sist: den är ingen depå.
    invoice(9_000, 'oplanerad'),
    invoice(500, null),
  ];
  const stock: ProductStockRow[] = [
    { id: 's1', status: 'scheduled', amount: 20_000, vat_percent: 0, invoice_rounds: [] },
    // Delfakturerad: bara resten är kvar i stocken.
    { id: 'o1', status: 'partially_invoiced', amount: 50_000, vat_percent: 0, invoice_rounds: [{ amount: 10_000 }] },
    { id: 'ny', status: 'draft', amount: 8_000, vat_percent: 0, invoice_rounds: [] },
    // Inte i stocken.
    { id: 'o2', status: 'invoiced', amount: 99_000, vat_percent: 0, invoice_rounds: [] },
  ];

  it('fördelar fakturerat och orderstock, med samma summor som Fakturerat och orderstocken', () => {
    const rows = buildDepotSplit({ revenue, stockRows: stock, segments, depots });
    expect(rows.map((r) => [r.kind, r.name, r.invoiced, r.invoicedOrders, r.stock, r.stockOrders])).toEqual([
      ['depot', 'Borlänge', 40_000, 1, 20_000, 1],
      ['depot', 'Sandviken', 10_000, 1, 40_000, 1],
      ['depot', 'Nedlagd', 7_000, 1, 0, 0],
      ['no_depot', null, 5_000, 1, 0, 0],
      ['unplanned', null, 9_500, 2, 8_000, 1],
    ]);
    expect(rows.reduce((t, r) => t + r.invoiced, 0)).toBe(71_500);
    expect(rows.reduce((t, r) => t + (r.stock ?? 0), 0)).toBe(68_000);
  });

  it('aktiva depåer står med utan något; nedlagda och specialraderna bara med något', () => {
    const rows = buildDepotSplit({ revenue: [], stockRows: [], segments, depots });
    // Inget att rangordna på: namnordning.
    expect(rows.map((r) => [r.kind, r.name, r.invoiced, r.stock])).toEqual([
      ['depot', 'Borlänge', 0, 0],
      ['depot', 'Sandviken', 0, 0],
    ]);
  });

  it('orderstocken som inte gick att läsa blir null på varje rad — fakturerat står kvar', () => {
    const rows = buildDepotSplit({ revenue, stockRows: null, segments, depots });
    expect(rows.every((r) => r.stock === null && r.stockOrders === null)).toBe(true);
    expect(rows.find((r) => r.name === 'Borlänge')!.invoiced).toBe(40_000);
  });

  it('en depå som inte finns bland de lästa får inget namn', () => {
    const rows = buildDepotSplit({ revenue: [invoice(100, 'x')], stockRows: [], segments: [segment('x', '2026-09-07', '2026-09-07', 'borta')], depots: [] });
    expect(rows).toEqual([{ kind: 'depot', depotId: 'borta', name: null, invoiced: 100, invoicedOrders: 1, stock: 0, stockOrders: 0 }]);
  });
});

describe('scheduleOrderIds — orderna vars schema läses', () => {
  it('orderna bakom fakturorna och i orderstocken, en gång var', () => {
    const invoice = (id: string | null): InvoicedRevenue => ({ amount: 1, at: '2026-09-01', assigned_to: null, client_name: null, quote_type: null, work_order_id: id });
    const ids = scheduleOrderIds({
      revenue: [invoice('a'), invoice('a'), invoice(null)],
      stockRows: [{ id: 'b', status: 'draft', amount: 1, invoice_rounds: [] }, { id: 'a', status: 'draft', amount: 1, invoice_rounds: [] }],
    });
    expect(ids).toEqual(['a', 'b']);
    expect(scheduleOrderIds({ revenue: [invoice('a')], stockRows: null })).toEqual(['a']);
  });
});

describe('buildReportProduct — en trasig läsning tar bara sin del', () => {
  const range = { from: '2026-09-01', to: '2026-09-30' };
  const orders = [order('a')];
  const lineItems = new Map<string, unknown>([['a', [m3Row(100, 100, 400)]]]);
  const trend = { orders, window: { from: '2026-06-29', to: '2026-10-07' } };
  const schedule = { segments: [segment('a', '2026-09-07', '2026-09-07', 'sv')], depots: [{ id: 'sv', name: 'Sandviken', active: true }] };
  const base = { ordersCreated: partitionOrders(orders, range, []).created, range, lineItems, trend, revenue: [], stockRows: [], schedule };

  it('allt läst: alla tre delarna', () => {
    const product = buildReportProduct(base);
    expect(product.volume?.total.m3).toBe(10);
    expect(product.volumeByMonth?.find((m) => m.period === '2026-09')?.m3).toBe(10);
    expect(product.depots?.map((r) => r.name)).toEqual(['Sandviken']);
  });

  it('utan orderrader: m³-delarna null — aldrig "0 m³" — men depåerna kvar', () => {
    const product = buildReportProduct({ ...base, lineItems: null });
    expect(product.volume).toBeNull();
    expect(product.volumeByMonth).toBeNull();
    expect(product.depots).not.toBeNull();
  });

  it('utan trend: bara m³ per månad null', () => {
    const product = buildReportProduct({ ...base, trend: null });
    expect(product.volumeByMonth).toBeNull();
    expect(product.volume).not.toBeNull();
  });

  it('utan schema: bara depåerna null', () => {
    const product = buildReportProduct({ ...base, schedule: null });
    expect(product.depots).toBeNull();
    expect(product.volume).not.toBeNull();
  });
});
