import { describe, it, expect, vi, beforeEach } from 'vitest';

// Delfakturan speglar ORDERNS huvud ut på kundens faktura ("Ert referensnummer",
// partialInvoiceReferenceField). Går den vägen på en order vars huvud vi VET är inaktuellt trycks
// ett gammalt värde på ett helt nytt dokument hos kunden.
//
// 🧨 Läget uppstår när delfaktureringen själv måste skapa ordern först: `pushWorkOrderToFortnox`
// svarar då `mirrorFailed` när en sparning landat mitt i pushen och inte gått att spegla. Det
// resultatet kastades tidigare bort — fakturan gick ut med 200 och ingen varning.

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

vi.mock('@/lib/domains/fortnox/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/fortnox/client')>();
  return { ...actual, fortnoxGet: vi.fn(), fortnoxPost: vi.fn(), fortnoxPut: vi.fn() };
});

vi.mock('@/lib/domains/fortnox/orders', () => ({ pushWorkOrderToFortnox: vi.fn() }));

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxGet, fortnoxPost } from '@/lib/domains/fortnox/client';
import { pushWorkOrderToFortnox } from '@/lib/domains/fortnox/orders';
import { createPartialInvoice } from '@/lib/domains/fortnox/partialInvoices';

const WORK_ORDER_ID = 'wo-1';
const LINE_ID = 'line-a';

// En order som ännu INTE ligger i Fortnox — det är enda vägen in i push-grenen.
const workOrderRow = {
  id: WORK_ORDER_ID,
  status: 'completed',
  project_name: 'Vindsisolering Kv Björken',
  vat_percent: 25,
  customer_id: 'cust-1',
  customer_snapshot: { reverse_vat: false },
  line_items: [{ id: LINE_ID, pricing_mode: 'item', unit_price: '100', quantity: '10' }],
  partial_invoicing_started_at: null,
  fortnox_order_number: null as string | null,
  rot_details: null,
};

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'lt', 'order', 'limit'] as const) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
    Promise.resolve(result).then(ok, err);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  const workOrders = makeChain({ data: [{ id: WORK_ORDER_ID }], error: null });
  workOrders.single = vi.fn().mockResolvedValue({ data: workOrderRow, error: null });
  const invoices = makeChain({ data: [], error: null });
  vi.mocked(getSupabaseAdmin).mockReturnValue({
    from: vi.fn((table: string) => (table === 'crm_work_order_invoices' ? invoices : workOrders)),
  } as unknown as ReturnType<typeof getSupabaseAdmin>);

  vi.mocked(fortnoxGet).mockResolvedValue({ Order: { CustomerNumber: 55, YourOrderNumber: 'GAMMAL' } } as never);
  vi.mocked(fortnoxPost).mockResolvedValue({ Invoice: { DocumentNumber: 9001 } } as never);
});

describe('createPartialInvoice — ett känt inaktuellt orderhuvud', () => {
  // ⚖️ KÄRNAN. Vet vi att Fortnox-ordern inte matchar CRM får vi inte spegla dess huvud vidare.
  it('vägrar fakturera när orderpushen rapporterade mirrorFailed', async () => {
    vi.mocked(pushWorkOrderToFortnox).mockResolvedValue(
      { fortnox_order_number: '131', mirrorFailed: true } as never);

    await expect(createPartialInvoice(WORK_ORDER_ID, [{ line_id: LINE_ID, quantity: 4 }], 'user-1'))
      .rejects.toThrow(/[Ss]ynka om/);

    // Ingen faktura fick skapas hos kunden.
    expect(fortnoxPost).not.toHaveBeenCalled();
  });

  // …och en ren push ska förstås gå vidare som vanligt.
  it('fakturerar som vanligt när pushen speglade allt', async () => {
    vi.mocked(pushWorkOrderToFortnox).mockResolvedValue({ fortnox_order_number: '131' } as never);

    await createPartialInvoice(WORK_ORDER_ID, [{ line_id: LINE_ID, quantity: 4 }], 'user-1');

    expect(fortnoxPost).toHaveBeenCalled();
  });
});
