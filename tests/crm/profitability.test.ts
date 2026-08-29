import { describe, it, expect } from 'vitest';
import { buildProfitability, type ReportOrderRow } from '@/lib/domains/crm/reports';

// Lönsamheten per period. Två regler bär hela siffran, och båda går fel tyst om de bryts:
//
//   1. bara KOMPLETTA jobb räknas — ett halvt underlag ger ett tal som ser exakt ut och är för högt
//   2. intäkt och kostnad summeras VAR FÖR SIG — ett ovägt snitt av procenttalen låter ett jobb på
//      5 000 kr väga lika tungt som ett på 500 000

const order = (id: string, invoicedDay: string): ReportOrderRow => ({
  id,
  amount: 0,
  status: 'invoiced',
  created_at: `${invoicedDay}T08:00:00Z`,
  fortnox_invoiced_at: `${invoicedDay}T08:00:00Z`,
  assigned_to: null,
  client_name: null,
});

const calc = (revenue: number | null, tb1: number | null, tb2: number | null) => ({ revenue, tb1, tb2 });

describe('buildProfitability', () => {
  it('summerar intäkt och TB var för sig — inte ett snitt av procenttalen', () => {
    // 500 000 kr med 10 % och 5 000 kr med 90 %. Ett ovägt snitt hade gett 50 %; det vägda
    // svaret är (50 000 + 4 500) / 505 000 = 10,79 %.
    const orders = [order('a', '2026-08-10'), order('b', '2026-08-11')];
    const calcs = new Map([
      ['a', calc(500_000, 50_000, null)],
      ['b', calc(5_000, 4_500, null)],
    ]);
    const result = buildProfitability(orders, calcs, ['2026-08']);
    expect(result.tg1).toBeCloseTo((54_500 / 505_000) * 100, 10);
    expect(result.tg1).not.toBeCloseTo(50, 1);
  });

  it('jobb utan räknebart TB1 hålls utanför BÅDE täljare och nämnare', () => {
    const orders = [order('a', '2026-08-10'), order('b', '2026-08-11')];
    const calcs = new Map([
      ['a', calc(100_000, 40_000, null)],
      ['b', calc(100_000, null, null)], // materialet går inte att räkna
    ]);
    const result = buildProfitability(orders, calcs, ['2026-08']);
    expect(result.tg1).toBeCloseTo(40, 10);
    expect(result.revenueTb1).toBe(100_000);
    expect(result.jobs).toBe(2);
    expect(result.jobsTb1).toBe(1);
  });

  it('TG1 och TG2 har egna nämnare — annars räknas TG2 mot jobb utan arbetskostnad', () => {
    // Två jobb: det ena har både material och tid, det andra bara material. TG2 får bara se det
    // första. Delade de nämnare hade TG2 blivit (40 000 + 40 000 − 10 000) / 200 000 = 35 % i
    // stället för det sanna 30 %.
    const orders = [order('a', '2026-08-10'), order('b', '2026-08-11')];
    const calcs = new Map([
      ['a', calc(100_000, 40_000, 30_000)],
      ['b', calc(100_000, 40_000, null)],
    ]);
    const result = buildProfitability(orders, calcs, ['2026-08']);
    expect(result.tg1).toBeCloseTo(40, 10);
    expect(result.tg2).toBeCloseTo(30, 10);
    expect(result.revenueTb2).toBe(100_000);
    expect(result.jobsTb1).toBe(2);
    expect(result.jobsTb2).toBe(1);
  });

  it('räknar per faktureringsmånad, inte per skapandemånad', () => {
    // Skapad i juli, fakturerad i augusti — kostnaden hör till augusti.
    const july = { ...order('a', '2026-08-05'), created_at: '2026-07-01T08:00:00Z' };
    const result = buildProfitability([july], new Map([['a', calc(100_000, 25_000, null)]]), ['2026-07', '2026-08']);
    expect(result.overTime.find((p) => p.period === '2026-07')?.tg1).toBeNull();
    expect(result.overTime.find((p) => p.period === '2026-08')?.tg1).toBeCloseTo(25, 10);
  });

  it('en månad utan räknebara jobb ger null, inte 0 %', () => {
    const result = buildProfitability([order('a', '2026-08-10')], new Map([['a', calc(100_000, 25_000, null)]]), ['2026-07', '2026-08']);
    // 0 % hade påstått att månaden gick jämnt ut. Sanningen är att det inte finns något att säga.
    expect(result.overTime.find((p) => p.period === '2026-07')?.tg1).toBeNull();
  });

  it('tom karta ger inga tal men rätt antal jobb — kalkylen kan ha fallerat', () => {
    const result = buildProfitability([order('a', '2026-08-10')], new Map(), ['2026-08']);
    expect(result.tg1).toBeNull();
    expect(result.tg2).toBeNull();
    expect(result.jobs).toBe(1);
    expect(result.jobsTb1).toBe(0);
  });

  it('ett förlustjobb drar ned periodens tal — det får bli negativt', () => {
    const orders = [order('a', '2026-08-10'), order('b', '2026-08-11')];
    const calcs = new Map([
      ['a', calc(100_000, 10_000, 5_000)],
      ['b', calc(100_000, 10_000, -25_000)],
    ]);
    const result = buildProfitability(orders, calcs, ['2026-08']);
    expect(result.tb2).toBe(-20_000);
    expect(result.tg2).toBeCloseTo(-10, 10);
  });

  it('en order utan id kan inte slås upp och räknas inte med', () => {
    const anonymous = { ...order('a', '2026-08-10'), id: undefined };
    const result = buildProfitability([anonymous], new Map([['a', calc(100_000, 25_000, null)]]), ['2026-08']);
    expect(result.tg1).toBeNull();
    expect(result.jobsTb1).toBe(0);
  });
});
