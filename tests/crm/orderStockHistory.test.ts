import { describe, it, expect } from 'vitest';
import {
  buildStockSnapshot,
  reconstructStock,
  reconstructWindow,
  stockByWeek,
  RECONSTRUCT_FROM,
  type ReconstructOrderRow,
  type StockSnapshot,
} from '@/lib/domains/crm/orderStockHistory';
import { buildOrderStock } from '@/lib/domains/crm/reportKpis';
import type { OrderStockRow } from '@/lib/domains/crm/overviewSummary';

// Orderstocken över tid. Två källor: ögonblicksbilden (exakt, per läge) och — före den första bilden —
// totalen räknad i efterhand. Ögonblicken är UTC med exakt klockslag; dagarna är svenska.

const order = (over: Partial<ReconstructOrderRow> = {}): ReconstructOrderRow => ({
  amount: 10_000, vat_percent: 0, status: 'scheduled', created_at: '2026-08-12T08:00:00Z', fortnox_invoiced_at: null, invoice_rounds: [], ...over,
});

describe('reconstructStock — totalen vid slutet av en svensk dag', () => {
  it('en order ligger i stocken från dagen den skapades', () => {
    const o = [order({ created_at: '2026-08-12T08:00:00Z' })];
    expect(reconstructStock(o, '2026-08-11')).toEqual({ count: 0, value: 0 });
    expect(reconstructStock(o, '2026-08-12')).toEqual({ count: 1, value: 10_000 });
  });

  it('skapad kl. 00.30 svensk tid den 13:e hör till den 13:e, fast UTC säger den 12:e', () => {
    const o = [order({ created_at: '2026-08-12T22:30:00Z' })];
    expect(reconstructStock(o, '2026-08-12').count).toBe(0);
    expect(reconstructStock(o, '2026-08-13').count).toBe(1);
  });

  it('lämnar stocken den dag den slutfakturerades', () => {
    const o = [order({ status: 'invoiced', fortnox_invoiced_at: '2026-09-02T10:00:00Z' })];
    expect(reconstructStock(o, '2026-09-01')).toEqual({ count: 1, value: 10_000 });
    expect(reconstructStock(o, '2026-09-02')).toEqual({ count: 0, value: 0 });
  });

  it('en fakturerad order utan fakturadatum räknas som fakturerad när den skapades', () => {
    expect(reconstructStock([order({ status: 'invoiced', fortnox_invoiced_at: null })], '2026-09-01').count).toBe(0);
  });

  it('delfakturarundorna dras av från sitt datum', () => {
    const o = [order({ status: 'partially_invoiced', invoice_rounds: [{ amount: 3_000, created_at: '2026-08-20T08:00:00Z' }, { amount: '2000.00', created_at: '2026-09-05T08:00:00Z' }] })];
    expect(reconstructStock(o, '2026-08-19').value).toBe(10_000);
    expect(reconstructStock(o, '2026-08-20').value).toBe(7_000);
    expect(reconstructStock(o, '2026-09-05').value).toBe(5_000);
  });

  it('avbrutna order räknas inte (vi vet inte när de avbröts)', () => {
    expect(reconstructStock([order({ status: 'cancelled' })], '2026-09-01').count).toBe(0);
  });

  it('netto: momsen dras av, som i orderstocken', () => {
    expect(reconstructStock([order({ amount: 12_500, vat_percent: 25 })], '2026-09-01').value).toBe(10_000);
  });

  it('räknad för idag ger exakt dagens orderstock (samma population, samma belopp)', () => {
    const current: ReconstructOrderRow[] = [
      order({ status: 'draft', amount: 4_000 }),
      order({ status: 'scheduled', amount: 6_250, vat_percent: 25 }),
      order({ status: 'in_progress', amount: 9_000 }),
      order({ status: 'partially_invoiced', amount: 20_000, invoice_rounds: [{ amount: 5_000, created_at: '2026-09-01T08:00:00Z' }] }),
      order({ status: 'completed', amount: 3_000 }),
      order({ status: 'invoiced', fortnox_invoiced_at: '2026-09-15T08:00:00Z' }),
      order({ status: 'cancelled' }),
    ];
    const asStockRows: OrderStockRow[] = current.map((o) => ({ status: o.status!, amount: o.amount, vat_percent: o.vat_percent, invoice_rounds: (o.invoice_rounds ?? []).map((r) => ({ amount: r.amount })) }));
    const stock = buildOrderStock(asStockRows, null);
    expect(reconstructStock(current, '2026-10-09')).toEqual({ count: stock.count, value: stock.value });
    expect(stock.count).toBe(5);
  });
});

describe('buildStockSnapshot', () => {
  it('lägena summerar till totalen, med öresavrundning', () => {
    const snapshot = buildStockSnapshot([
      { status: 'draft', amount: 1_000.005, vat_percent: 0, invoice_rounds: [] },
      { status: 'scheduled', amount: 2_000, vat_percent: 0, invoice_rounds: [] },
      { status: 'partially_invoiced', amount: 5_000, vat_percent: 0, invoice_rounds: [{ amount: 1_000 }] },
      { status: 'invoiced', amount: 9_999, vat_percent: 0, invoice_rounds: [] },
    ], '2026-10-09');
    expect(snapshot.day).toBe('2026-10-09');
    expect(snapshot.totalCount).toBe(3);
    expect(snapshot.totalValue).toBe(7_000.01);
    expect(snapshot.stages.reduce((sum, s) => sum + s.count, 0)).toBe(3);
    expect(snapshot.stages.find((s) => s.key === 'partially_invoiced')?.value).toBe(4_000);
  });
});

const snap = (day: string, value: number): StockSnapshot => ({ day, totalCount: 1, totalValue: value, stages: [{ key: 'scheduled', count: 1, value }] });
const WEEKS = [
  { from: '2026-08-03', to: '2026-08-09' }, // v. 32 — före RECONSTRUCT_FROM
  { from: '2026-08-10', to: '2026-08-16' }, // v. 33
  { from: '2026-09-28', to: '2026-10-04' }, // v. 40
  { from: '2026-10-05', to: '2026-10-11' }, // v. 41 — med bilder
  { from: '2026-10-12', to: '2026-10-18' }, // v. 42 — lucka
  { from: '2026-10-19', to: '2026-10-21' }, // v. 43 — pågår
];

describe('stockByWeek', () => {
  const reconstructOrders = [order({ created_at: '2026-08-12T08:00:00Z', amount: 7_000 })];
  const result = stockByWeek({
    weeks: WEEKS,
    today: '2026-10-21',
    snapshots: [snap('2026-10-08', 100), snap('2026-10-11', 200), snap('2026-10-09', 150)],
    now: snap('2026-10-21', 999),
    reconstructOrders,
  });

  it('före RECONSTRUCT_FROM: inget', () => {
    expect(RECONSTRUCT_FROM).toBe('2026-08-10');
    expect(result[0]).toBeNull();
  });
  it('före den första bilden, från RECONSTRUCT_FROM: totalen i efterhand vid veckans sista dag', () => {
    expect(result[1]).toEqual({ kind: 'reconstructed', day: '2026-08-16', count: 1, value: 7_000, stages: null });
    expect(result[2]).toMatchObject({ kind: 'reconstructed', day: '2026-10-04' });
  });
  it('en vecka med bilder: veckans senaste, inte den först lagrade', () => {
    expect(result[3]).toMatchObject({ kind: 'snapshot', day: '2026-10-11', value: 200 });
  });
  it('en lucka efter den första bilden fylls inte med en efterhandsräkning', () => {
    expect(result[4]).toBeNull();
  });
  it('den pågående veckan: läget nu', () => {
    expect(result[5]).toMatchObject({ kind: 'now', day: '2026-10-21', value: 999 });
  });
  it('den första bilden någonsin kan ligga före perioden — då räknas inget i efterhand', () => {
    const later = stockByWeek({ weeks: WEEKS.slice(1, 3), today: '2026-10-21', snapshots: [], firstSnapshotDay: '2026-08-01', now: null, reconstructOrders });
    expect(later).toEqual([null, null]);
  });
  it('utan orderna för efterhandsräkningen: inget', () => {
    expect(stockByWeek({ weeks: WEEKS.slice(1, 2), today: '2026-10-21', snapshots: [], now: null, reconstructOrders: null })).toEqual([null]);
  });
});

describe('reconstructWindow', () => {
  const YEAR = { from: '2026-01-01', to: '2026-10-09' };
  it('från RECONSTRUCT_FROM till dagen före den första bilden', () => {
    expect(reconstructWindow({ range: YEAR, today: '2026-10-09', firstSnapshot: '2026-10-08' })).toEqual({ from: '2026-08-10', to: '2026-10-07' });
  });
  it('ingen bild än: till igår', () => {
    expect(reconstructWindow({ range: YEAR, today: '2026-10-09', firstSnapshot: null })).toEqual({ from: '2026-08-10', to: '2026-10-08' });
  });
  it('ett nytt år där bilderna redan finns: inget att räkna fram', () => {
    expect(reconstructWindow({ range: { from: '2027-01-01', to: '2027-01-05' }, today: '2027-01-05', firstSnapshot: '2026-10-09' })).toBeNull();
  });
});
