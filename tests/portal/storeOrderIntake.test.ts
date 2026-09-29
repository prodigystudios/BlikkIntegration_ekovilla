import { describe, it, expect } from 'vitest';
import {
  decideStoreOrderChange,
  decideStoreOrderWithdraw,
  portalStoreOrderChangeSchema,
  portalStoreOrderSchema,
  portalStoreOrderWithdrawSchema,
  type StoreOrderDecisionRow,
} from '@/lib/domains/portal/storeOrderIntake';
import {
  decideStoreOrderNotice,
  storeOrderLinesTotal,
  storeOrderNoticeKey,
  formatStoreOrderKr,
  storeOrderSummary,
  storeOrderTotals,
  type StoreOrderStatus,
} from '@/lib/domains/portal/storeOrders';
import { CONTRACT_STORE_ORDER } from './helpers/contractFixtures';

/**
 * Butiksbeställningarnas kropp och beslut (fas 8, kontraktets "Flöde 3"). Det som skyddas:
 *   - kontraktets exempel godtas, en m3-rad och ett antal som inte är helt nekas;
 *   - updatedAt: UTC med hela millisekunder, och bara en tid som finns;
 *   - en ändring gäller bara en mottagen beställning med ett STRIKT nyare updatedAt, 409 bara efter bekräftelsen,
 *     och en annan butik eller ett annat nummer är ett fel i anropet, aldrig 409;
 *   - notisen: ny, ändrad (bara den senaste), tillbakadragen, och ingen efter att Ekovilla tagit över.
 */

const clone = () => structuredClone(CONTRACT_STORE_ORDER) as unknown as Record<string, any>;

describe('portalStoreOrderSchema', () => {
  it('godtar kontraktets exempel, trimmar, och en tom kundnummersträng blir null', () => {
    const body = clone();
    body.orderNumber = '  B-2026-003 ';
    body.store.ekovillaCustomerNumber = '  ';
    const parsed = portalStoreOrderSchema.parse(body);
    expect(parsed.orderNumber).toBe('B-2026-003');
    expect(parsed.store.ekovillaCustomerNumber).toBeNull();
    expect(parsed.lines).toHaveLength(2);
    expect(portalStoreOrderSchema.parse(clone()).store.ekovillaCustomerNumber).toBe('1043');
  });

  it('nekar en m3-rad: inblåsning säljs som jobb', () => {
    const body = clone();
    body.lines[0].unit = 'm3';
    const result = portalStoreOrderSchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path.join('.')).toBe('lines.0.unit');
  });

  it('nekar ett antal som inte är helt, noll eller negativt', () => {
    for (const quantity of [1.5, 0, -2]) {
      const body = clone();
      body.lines[1].quantity = quantity;
      const result = portalStoreOrderSchema.safeParse(body);
      expect(result.success, String(quantity)).toBe(false);
      expect(result.error?.issues[0].path.join('.')).toBe('lines.1.quantity');
    }
  });

  it('kräver leveransadressens tre delar, rader och ett id med sökvägens tecken', () => {
    const noCity = clone();
    noCity.delivery.address.city = ' ';
    expect(portalStoreOrderSchema.safeParse(noCity).success).toBe(false);
    const noLines = clone();
    noLines.lines = [];
    expect(portalStoreOrderSchema.safeParse(noLines).success).toBe(false);
    const badId = clone();
    badId.orderId = 'so/1';
    expect(portalStoreOrderSchema.safeParse(badId).success).toBe(false);
    const dots = clone();
    dots.orderId = '..';
    expect(portalStoreOrderSchema.safeParse(dots).success).toBe(false);
  });

  it('priset i hela ören: två decimaler godtas, ett halvt öre nekas', () => {
    for (const unitCost of [335.3, 0.07, 195.3, 12, 0.1]) {
      const body = clone();
      body.lines[0].unitCost = unitCost;
      expect(portalStoreOrderSchema.safeParse(body).success, String(unitCost)).toBe(true);
    }
    const body = clone();
    body.lines[0].unitCost = 1.005;
    const result = portalStoreOrderSchema.safeParse(body);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path.join('.')).toBe('lines.0.unitCost');
  });

  it('priset har ett tak (1 000 000 kr per enhet), så att summan i heltalsören alltid är exakt', () => {
    const at = clone();
    at.lines[0].unitCost = 1_000_000;
    expect(portalStoreOrderSchema.safeParse(at).success).toBe(true);
    const over = clone();
    over.lines[0].unitCost = 1_000_000.01;
    expect(portalStoreOrderSchema.safeParse(over).success).toBe(false);
  });

  it('en negativ rad nekas', () => {
    const body = clone();
    body.lines[0].unitCost = -1;
    expect(portalStoreOrderSchema.safeParse(body).success).toBe(false);
  });
});

describe('portalStoreOrderChangeSchema: updatedAt', () => {
  const withUpdatedAt = (updatedAt: unknown) => ({ ...clone(), updatedAt });

  it('godtar UTC med hela millisekunder', () => {
    expect(portalStoreOrderChangeSchema.parse(withUpdatedAt('2026-09-28T10:15:00.123Z')).updatedAt).toBe('2026-09-28T10:15:00.123Z');
  });

  it('nekar annat format, en annan zon, och en tid som inte finns', () => {
    for (const value of ['2026-09-28T10:15:00Z', '2026-09-28T10:15:00.123+02:00', '2026-02-30T10:15:00.000Z', '2026-09-28T25:00:00.000Z', 1, null]) {
      expect(portalStoreOrderChangeSchema.safeParse(withUpdatedAt(value)).success, String(value)).toBe(false);
    }
  });

  it('utan millisekunder: meddelandet säger hur den ska skrivas', () => {
    const result = portalStoreOrderChangeSchema.safeParse(withUpdatedAt('2026-09-28T10:15:00Z'));
    expect(result.error?.issues[0].message).toContain('millisekunder');
  });

  it('en ändring utan updatedAt nekas', () => {
    expect(portalStoreOrderChangeSchema.safeParse(clone()).success).toBe(false);
  });

  it('tillbakadragningen: bara orderId', () => {
    expect(portalStoreOrderWithdrawSchema.parse({ orderId: 'so-b-2026-003' })).toEqual({ orderId: 'so-b-2026-003' });
    expect(portalStoreOrderWithdrawSchema.safeParse({}).success).toBe(false);
  });
});

const row = (status: StoreOrderStatus, portalUpdatedAt: string | null = null): StoreOrderDecisionRow => ({
  status,
  reseller_id: 'res-norrbygg',
  order_number: 'B-2026-003',
  portal_updated_at: portalUpdatedAt,
});
const change = (updatedAt: string, over: Partial<{ resellerId: string; orderNumber: string }> = {}) => ({
  resellerId: 'res-norrbygg',
  orderNumber: 'B-2026-003',
  updatedAt,
  ...over,
});

describe('decideStoreOrderChange', () => {
  it('första ändringen gäller', () => {
    expect(decideStoreOrderChange(row('received'), change('2026-09-28T10:15:00.123Z'))).toEqual({ kind: 'apply' });
  });

  it('ett strikt nyare updatedAt gäller; samma eller äldre ignoreras (Postgres skriver +00:00)', () => {
    const stored = '2026-09-28 10:15:00.123+00';
    expect(decideStoreOrderChange(row('received', stored), change('2026-09-28T10:15:00.124Z'))).toEqual({ kind: 'apply' });
    expect(decideStoreOrderChange(row('received', stored), change('2026-09-28T10:15:00.123Z'))).toEqual({ kind: 'ignored' });
    expect(decideStoreOrderChange(row('received', stored), change('2026-09-28T10:15:00.122Z'))).toEqual({ kind: 'ignored' });
  });

  it('bekräftad, levererad och fakturerad: 409', () => {
    for (const status of ['confirmed', 'delivered', 'invoiced'] as const) {
      expect(decideStoreOrderChange(row(status), change('2026-09-28T10:15:00.123Z'))).toEqual({ kind: 'confirmed' });
    }
  });

  it('tillbakadragen eller makulerad: ignoreras, aldrig 409 (portalen läser 409 som bekräftad)', () => {
    for (const status of ['withdrawn', 'cancelled'] as const) {
      expect(decideStoreOrderChange(row(status), change('2026-09-28T10:15:00.123Z'))).toEqual({ kind: 'ignored' });
    }
  });

  it('en annan butik eller ett annat nummer är ett fel i anropet, också på en bekräftad', () => {
    expect(decideStoreOrderChange(row('confirmed'), change('2026-09-28T10:15:00.123Z', { resellerId: 'res-annan' }))).toEqual({
      kind: 'mismatch',
      field: 'store.resellerId',
    });
    expect(decideStoreOrderChange(row('received'), change('2026-09-28T10:15:00.123Z', { orderNumber: 'B-2026-004' }))).toEqual({
      kind: 'mismatch',
      field: 'orderNumber',
    });
  });
});

describe('decideStoreOrderWithdraw', () => {
  it('mottagen dras tillbaka, tillbakadragen igen ger samma, bekräftad 409, makulerad ignoreras', () => {
    expect(decideStoreOrderWithdraw(row('received'))).toEqual({ kind: 'apply' });
    expect(decideStoreOrderWithdraw(row('withdrawn'))).toEqual({ kind: 'withdrawn' });
    for (const status of ['confirmed', 'delivered', 'invoiced'] as const) {
      expect(decideStoreOrderWithdraw(row(status))).toEqual({ kind: 'confirmed' });
    }
    expect(decideStoreOrderWithdraw(row('cancelled'))).toEqual({ kind: 'ignored' });
  });
});

describe('summorna och sammanfattningen', () => {
  it('räknar i hela ören, rad för rad', () => {
    expect(storeOrderLinesTotal(CONTRACT_STORE_ORDER.lines)).toBe(4414.2);
    // Räknat i heltalsören: 3 × 0,10 är 0,30, inte 0,30000000000000004.
    expect(storeOrderLinesTotal([{ quantity: 3, unitCost: 0.1 }])).toBe(0.3);
    expect(storeOrderLinesTotal([{ quantity: 7, unitCost: 1.15 }, { quantity: 3, unitCost: 0.29 }])).toBe(8.92);
    // Summan läggs ihop i hela ören: 0,07 × 100 är 7,000000000000001 som flyttal, och tre sådana blir inte 0,21.
    expect(storeOrderLinesTotal([{ quantity: 1, unitCost: 0.07 }, { quantity: 1, unitCost: 0.07 }, { quantity: 1, unitCost: 0.07 }])).toBe(0.21);
  });

  // sv-SE skriver tusental med ett hårt mellanslag; jämförs med vanliga.
  const plain = (s: string) => s.replace(/\s/g, ' ');

  it('notisens brödtext: nummer, rader, summa exkl. moms och önskad leverans', () => {
    expect(plain(storeOrderSummary(CONTRACT_STORE_ORDER))).toBe('B-2026-003 · 2 rader · 4 414 kr exkl. moms · Vecka 41');
    expect(plain(storeOrderSummary({ ...CONTRACT_STORE_ORDER, lines: [CONTRACT_STORE_ORDER.lines[0]], delivery: { ...CONTRACT_STORE_ORDER.delivery, desiredPeriod: ' ' } }))).toBe(
      'B-2026-003 · 1 rad · 4 024 kr exkl. moms',
    );
  });
});

describe('formatStoreOrderKr', () => {
  it('två decimaler, svenskt tusental och "kr"', () => {
    expect(formatStoreOrderKr(4414.2).replace(/\s/g, ' ')).toBe('4 414,20 kr');
    expect(formatStoreOrderKr(0.5).replace(/\s/g, ' ')).toBe('0,50 kr');
  });
});

describe('storeOrderTotals', () => {
  it('utan fraktbeslut: bara raderna, ingen summa inkl. moms än', () => {
    expect(storeOrderTotals(CONTRACT_STORE_ORDER.lines, null)).toEqual({ lines: 4414.2, freight: null, net: null, vat: null, total: null });
  });

  it('frakten och 25 % moms på båda, i hela ören', () => {
    expect(storeOrderTotals(CONTRACT_STORE_ORDER.lines, { mode: 'charged', price: 950 })).toEqual({
      lines: 4414.2,
      freight: 950,
      net: 5364.2,
      vat: 1341.05,
      total: 6705.25,
    });
    // Momsen avrundas till öre: 0,07 kr × 25 % = 0,0175 → 0,02.
    expect(storeOrderTotals([{ quantity: 1, unitCost: 0.07 }], { mode: 'none' })).toEqual({ lines: 0.07, freight: 0, net: 0.07, vat: 0.02, total: 0.09 });
  });

  it('ingen frakt är 0 kr, och momsen följer procenten', () => {
    expect(storeOrderTotals([{ quantity: 2, unitCost: 100 }], { mode: 'none' }, 12)).toMatchObject({ freight: 0, net: 200, vat: 24, total: 224 });
  });
});

describe('notisen', () => {
  const notice = (status: StoreOrderStatus, version: number, notified: string | null) =>
    decideStoreOrderNotice({ status, store_version: version, notified_key: notified });

  it('ny: den ansvarige har inte fått något', () => {
    expect(notice('received', 1, null)).toEqual({ key: 'v1', kind: 'received' });
    // Ändrad innan den första notisen gick iväg: fortfarande "Ny", med det som gäller nu.
    expect(notice('received', 3, null)).toEqual({ key: 'v3', kind: 'received' });
  });

  it('ändrad: bara den senaste versionen, och ingenting när den redan är sagd', () => {
    expect(notice('received', 3, 'v1')).toEqual({ key: 'v3', kind: 'changed' });
    expect(notice('received', 3, 'v3')).toBeNull();
  });

  it('tillbakadragen: alltid en notis, också när ingen notis är bokförd (den kan ha kommit fram ändå)', () => {
    expect(notice('withdrawn', 2, 'v2')).toEqual({ key: 'withdrawn', kind: 'withdrawn' });
    expect(notice('withdrawn', 1, null)).toEqual({ key: 'withdrawn', kind: 'withdrawn' });
    expect(notice('withdrawn', 1, 'withdrawn')).toBeNull();
  });

  it('ingen notis när Ekovilla tagit över', () => {
    for (const status of ['confirmed', 'delivered', 'invoiced', 'cancelled'] as const) {
      expect(storeOrderNoticeKey({ status, store_version: 2 })).toBeNull();
      expect(notice(status, 2, 'v1')).toBeNull();
    }
  });
});
