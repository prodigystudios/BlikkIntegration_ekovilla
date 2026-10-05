import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 🧨 EFTER FORTNOX-ANROPET FINNS FAKTURAN HOS KUNDEN. Två skrivningar följer, och ingen av dem
// kontrollerades:
//   · rundan i crm_work_order_invoices — det enda som säger vilka antal som fakturerats. Saknas den
//     ser raderna ofakturerade ut och samma antal kan faktureras en gång till.
//   · arbetsordern (status, partial_invoicing_started_at).
// Båda svarade "lyckades" fast de fallerat. Nu prövas de två gånger, och fallerar de ändå kastas
// ett fel som bär fakturanumret och säger åt användaren att INTE fakturera igen.

vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn() }));

vi.mock('@/lib/domains/fortnox/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/fortnox/client')>();
  return { ...actual, fortnoxGet: vi.fn(), fortnoxPost: vi.fn(), fortnoxPut: vi.fn() };
});

vi.mock('@/lib/domains/fortnox/orders', () => ({ pushWorkOrderToFortnox: vi.fn(), updateWorkOrderInFortnox: vi.fn() }));

import { getSupabaseAdmin } from '@/lib/supabase/server';
import { fortnoxGet, fortnoxPost, FortnoxInvoiceNotRecordedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { createPartialInvoice } from '@/lib/domains/fortnox/partialInvoices';

const WORK_ORDER_ID = 'wo-1';
const LINE_ID = 'line-a';

// Ordern ligger redan i Fortnox, så push-grenen hoppas över och testet handlar om skrivningarna.
const workOrderRow = {
  id: WORK_ORDER_ID,
  status: 'completed',
  project_name: 'Vindsisolering Kv Björken',
  vat_percent: 25,
  customer_id: 'cust-1',
  customer_snapshot: { reverse_vat: false },
  line_items: [{ id: LINE_ID, pricing_mode: 'item', unit_price: '100', quantity: '10' }],
  partial_invoicing_started_at: null,
  fortnox_order_number: '131',
  rot_details: null,
};

type Result = { data?: unknown; error: unknown };

function makeChain(result: Result) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'neq', 'lt', 'order', 'limit'] as const) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  chain.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => Promise.resolve(result).then(ok, err);
  return chain;
}

const failure = { error: { message: 'connection reset' } };

let invoices: Record<string, any>;
let workOrders: Record<string, any>;
/** Svaren på orderuppdateringen med `status` — den efter fakturan. Tom kö = lyckas. */
let orderPatchResults: Result[];
/** Orderns uppdateringar med `status`, i den ordning de gjordes. */
let orderPatches: Array<Record<string, unknown>>;
/** Alla andra uppdateringar av ordern — claimen och felgrenens syncstatus. */
let otherPatches: Array<Record<string, unknown>>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});

  invoices = makeChain({ data: [], error: null });
  invoices.insert = vi.fn().mockResolvedValue({ error: null });
  invoices.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });

  orderPatchResults = [];
  orderPatches = [];
  otherPatches = [];
  workOrders = makeChain({ data: [{ id: WORK_ORDER_ID }], error: null });
  workOrders.single = vi.fn()
    .mockResolvedValueOnce({ data: workOrderRow, error: null })
    .mockResolvedValue({ data: { status: 'completed' }, error: null });
  const claimAndCatchUpdate = workOrders.update;
  workOrders.update = vi.fn((patch: Record<string, unknown>) => {
    if (!('status' in patch)) { otherPatches.push(patch); return claimAndCatchUpdate(patch); }
    orderPatches.push(patch);
    const result = orderPatchResults.shift() ?? { error: null };
    return makeChain(result);
  });

  vi.mocked(getSupabaseAdmin).mockReturnValue({
    from: vi.fn((table: string) => (table === 'crm_work_order_invoices' ? invoices : workOrders)),
  } as unknown as ReturnType<typeof getSupabaseAdmin>);

  vi.mocked(fortnoxGet).mockResolvedValue({ Order: { CustomerNumber: 55 } } as never);
  vi.mocked(fortnoxPost).mockResolvedValue({ Invoice: { DocumentNumber: 9001 } } as never);
});

afterEach(() => vi.restoreAllMocks());

const invoiceFour = () => createPartialInvoice(WORK_ORDER_ID, [{ line_id: LINE_ID, quantity: 4 }], 'user-1');

describe('createPartialInvoice — rundan måste sparas', () => {
  it('sparar rundan och uppdaterar ordern när allt går', async () => {
    await expect(invoiceFour()).resolves.toMatchObject({ fortnox_invoice_number: '9001', status: 'partially_invoiced' });
    expect(invoices.insert).toHaveBeenCalledTimes(1);
    expect(orderPatches).toHaveLength(1);
  });

  it('försöker igen när första sparningen fallerar', async () => {
    invoices.insert.mockResolvedValueOnce(failure);

    await expect(invoiceFour()).resolves.toMatchObject({ fortnox_invoice_number: '9001' });
    expect(invoices.insert).toHaveBeenCalledTimes(2);
  });

  // Svaret kan tappas EFTER att raden skrevs. Ett blint omförsök hade då studsat på
  // (work_order_id, round_number) och rapporterat en sparad runda som förlorad.
  it('räknar rundan som sparad när raden finns med vårt fakturanummer', async () => {
    invoices.insert.mockResolvedValueOnce(failure);
    invoices.maybeSingle.mockResolvedValueOnce({ data: { fortnox_invoice_number: '9001' }, error: null });

    await expect(invoiceFour()).resolves.toMatchObject({ fortnox_invoice_number: '9001' });
    expect(invoices.insert).toHaveBeenCalledTimes(1);
  });

  it('räknar inte en rad med ANNAT fakturanummer som vår', async () => {
    invoices.insert.mockResolvedValue(failure);
    invoices.maybeSingle.mockResolvedValue({ data: { fortnox_invoice_number: '8000' }, error: null });

    await expect(invoiceFour()).rejects.toBeInstanceOf(FortnoxInvoiceNotRecordedError);
  });

  it('kastar med fakturanumret och "fakturera inte igen" när rundan inte går att spara', async () => {
    invoices.insert.mockResolvedValue(failure);

    const error = await invoiceFour().catch((e) => e);

    expect(error).toBeInstanceOf(FortnoxInvoiceNotRecordedError);
    expect(error.invoiceNumber).toBe('9001');
    expect(error.message).toMatch(/Faktura 9001 skapades i Fortnox/);
    expect(error.message).toMatch(/Fakturera INTE igen/);
    // Loggen bär raden, så en administratör kan lägga in den för hand.
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).toMatch(/"fortnox_invoice_number":"9001"/);
    // Ordern flyttas inte fram på en runda som inte finns.
    expect(orderPatches).toEqual([]);
  });

  // 🧨 'failed' hade SLÄPPT claimen, och då stod ett nytt försök med samma antal ett klick bort.
  it('håller claimen — skriver inte failed — när rundan inte sparats', async () => {
    invoices.insert.mockResolvedValue(failure);

    await invoiceFour().catch(() => {});

    const syncWrites = otherPatches.map((patch) => patch.fortnox_invoice_sync_status);
    expect(syncWrites).toEqual(['pending']); // bara claimen
  });

  it('loggar varje misslyckat försök med orsaken', async () => {
    invoices.insert.mockResolvedValue(failure);
    invoices.maybeSingle.mockResolvedValue({ data: { fortnox_invoice_number: '8000' }, error: null });

    await invoiceFour().catch(() => {});

    const log = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(log).toMatch(/försök 1: connection reset/);
    expect(log).toMatch(/försök 2: connection reset · rundnumret upptaget av faktura 8000/);
  });

  // Beskedet får inte tvättas till "Något gick fel. Försök igen." — ett nytt försök på en runda som
  // inte sparats fakturerar samma antal en gång till.
  it('når användaren ordagrant genom friendlyFortnoxMessage', async () => {
    invoices.insert.mockResolvedValue(failure);
    const error = await invoiceFour().catch((e) => e);
    expect(friendlyFortnoxMessage(error)).toBe(error.message);
  });
});

describe('createPartialInvoice — ordern måste uppdateras', () => {
  it('försöker igen när orderuppdateringen fallerar en gång', async () => {
    orderPatchResults = [failure];

    await expect(invoiceFour()).resolves.toMatchObject({ fortnox_invoice_number: '9001' });
    expect(orderPatches).toHaveLength(2);
  });

  it('kastar med fakturanumret när ordern inte går att uppdatera — rundan är sparad', async () => {
    orderPatchResults = [failure, failure];

    const error = await invoiceFour().catch((e) => e);

    expect(error).toBeInstanceOf(FortnoxInvoiceNotRecordedError);
    expect(error.message).toMatch(/Faktura 9001 skapades i Fortnox och är sparad/);
    expect(error.roundRecorded).toBe(true);
    expect(invoices.insert).toHaveBeenCalledTimes(1);
    // Rundan finns, så claimen får släppas: ett nytt försök läser rundan och fakturerar inte igen.
    expect(otherPatches.at(-1)).toEqual({ fortnox_invoice_sync_status: 'failed' });
  });
});
