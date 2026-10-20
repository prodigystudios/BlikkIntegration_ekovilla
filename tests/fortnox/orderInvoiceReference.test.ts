import { describe, it, expect, vi, beforeEach } from 'vitest';

// "Fakturera allt" (createInvoiceFromWorkOrder) och Fortnox-orderns `InvoiceReference`.
//
// 🧨 Felet (flaggat 2026-09-29): en OFAKTURERAD Fortnox-order svarar `InvoiceReference: "0"` — strängen
// noll, inte null. Ett sanningsvärdestest läste den som faktura nummer 0. På en order som inte var
// synkad stämplades den då 'invoiced' med fakturanumret "0": ingen faktura fanns, ordern såg klar ut,
// och en fakturerad order går inte att synka om.

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

vi.mock('@/lib/domains/fortnox/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/fortnox/client')>();
  return { ...actual, fortnoxGet: vi.fn(), fortnoxPost: vi.fn(), fortnoxPut: vi.fn() };
});

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxGet, fortnoxPut } from '@/lib/domains/fortnox/client';
import { createInvoiceFromWorkOrder } from '@/lib/domains/fortnox/orders';

const WORK_ORDER_ID = 'wo-1';

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'lt', 'or', 'is', 'order', 'limit'] as const) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => Promise.resolve(result).then(ok, err);
  return chain;
}

// Allt som skrivs till arbetsordern, i ordning.
let updates: Record<string, unknown>[] = [];

function mockOrder(row: Record<string, unknown>) {
  updates = [];
  // Claimen (update … .select('id')) vinner: en rad tillbaka.
  const workOrders = makeChain({ data: [{ id: WORK_ORDER_ID }], error: null });
  workOrders.update = vi.fn((values: Record<string, unknown>) => {
    updates.push(values);
    return workOrders;
  });
  workOrders.single = vi.fn().mockResolvedValue({
    data: {
      id: WORK_ORDER_ID,
      fortnox_order_number: '131',
      fortnox_invoice_number: null,
      fortnox_order_sync_status: 'synced',
      line_items: [{ id: 'line-a', pricing_mode: 'item', unit_price: '100', quantity: '10' }],
      ...row,
    },
    error: null,
  });
  vi.mocked(getSupabaseAdmin).mockReturnValue({ from: vi.fn(() => workOrders) } as unknown as ReturnType<typeof getSupabaseAdmin>);
}

const invoicedUpdate = () => updates.find((u) => u.status === 'invoiced');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fortnoxGet).mockReset();
  vi.mocked(fortnoxPut).mockReset();
});

describe('en order som inte är synkad', () => {
  it('"0" är ingen faktura: ordern stämplas inte fakturerad, och beskedet säger synka om', async () => {
    for (const none of ['0', 0]) {
      mockOrder({ fortnox_order_sync_status: 'failed' });
      vi.mocked(fortnoxGet).mockResolvedValue({ Order: { InvoiceReference: none } } as never);

      await expect(createInvoiceFromWorkOrder(WORK_ORDER_ID)).rejects.toThrow(/[Ss]ynka om/);
      expect(invoicedUpdate()).toBeUndefined();
      expect(updates).not.toContainEqual(expect.objectContaining({ fortnox_invoice_number: '0' }));
      expect(fortnoxPut).not.toHaveBeenCalled();
    }
  });

  // Återhämtningen står kvar: en faktura som skapades men vars nummer föll bort hittas.
  it('en riktig faktura hittas och stämplas', async () => {
    mockOrder({ fortnox_order_sync_status: 'failed' });
    vi.mocked(fortnoxGet).mockResolvedValue({ Order: { InvoiceReference: 49 } } as never);

    expect(await createInvoiceFromWorkOrder(WORK_ORDER_ID)).toEqual({ fortnox_invoice_number: '49' });
    expect(invoicedUpdate()).toMatchObject({ fortnox_invoice_number: '49', status: 'invoiced' });
  });
});

describe('createinvoice', () => {
  // createinvoice svarar med ORDERN, inte fakturan (mätt 2026-09-29) — numret står i dess InvoiceReference.
  it('numret läses ur createinvoice-svaret, utan en extra läsning', async () => {
    mockOrder({});
    vi.mocked(fortnoxPut).mockResolvedValue({ Order: { DocumentNumber: 131, InvoiceReference: 50 } } as never);

    expect(await createInvoiceFromWorkOrder(WORK_ORDER_ID)).toEqual({ fortnox_invoice_number: '50' });
    expect(invoicedUpdate()).toMatchObject({ fortnox_invoice_number: '50', status: 'invoiced' });
    expect(fortnoxGet).not.toHaveBeenCalled();
  });

  it('svaret bär "0": ordern frågas', async () => {
    mockOrder({});
    vi.mocked(fortnoxPut).mockResolvedValue({ Order: { DocumentNumber: 131, InvoiceReference: '0' } } as never);
    vi.mocked(fortnoxGet).mockResolvedValue({ Order: { InvoiceReference: '50' } } as never);

    expect(await createInvoiceFromWorkOrder(WORK_ORDER_ID)).toEqual({ fortnox_invoice_number: '50' });
  });

  it('"0" i både svaret och ordern är inget fakturanummer', async () => {
    mockOrder({});
    vi.mocked(fortnoxPut).mockResolvedValue({ Order: { DocumentNumber: 131, InvoiceReference: '0' } } as never);
    vi.mocked(fortnoxGet).mockResolvedValue({ Order: { InvoiceReference: '0' } } as never);

    await expect(createInvoiceFromWorkOrder(WORK_ORDER_ID)).rejects.toThrow(/inget fakturanummer/);
    expect(invoicedUpdate()).toBeUndefined();
  });

  // Ett createinvoice som faller på en ofakturerad order är ett riktigt fel — inte "redan fakturerad".
  it('ett misslyckat createinvoice på en ofakturerad order kastar sitt eget fel', async () => {
    mockOrder({});
    vi.mocked(fortnoxPut).mockRejectedValue(new Error('Fortnox 400: Kunde inte skapa faktura') as never);
    vi.mocked(fortnoxGet).mockResolvedValue({ Order: { InvoiceReference: '0' } } as never);

    await expect(createInvoiceFromWorkOrder(WORK_ORDER_ID)).rejects.toThrow(/Kunde inte skapa faktura/);
    expect(invoicedUpdate()).toBeUndefined();
  });

  it('ett misslyckat createinvoice på en redan fakturerad order hittar fakturan', async () => {
    mockOrder({});
    vi.mocked(fortnoxPut).mockRejectedValue(new Error('Fortnox 400: 2000496 redan fakturerad') as never);
    vi.mocked(fortnoxGet).mockResolvedValue({ Order: { InvoiceReference: '51' } } as never);

    expect(await createInvoiceFromWorkOrder(WORK_ORDER_ID)).toEqual({ fortnox_invoice_number: '51' });
    expect(invoicedUpdate()).toMatchObject({ fortnox_invoice_number: '51', status: 'invoiced', fortnox_invoice_sync_status: 'synced' });
  });
});
