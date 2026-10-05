import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesUser, effectivePermissionsForRole } from './helpers/supabase';

// "Fakturera allt" har två vägar: orderns createinvoice i Fortnox när ingen delfakturering börjat,
// annars resten som en sista runda. Valet är skillnaden mellan rätt faktura och att fakturera hela
// ordern en gång till — createinvoice vet ingenting om rundorna.
//
// 🧨 Valet läste bara status och partial_invoicing_started_at. Båda skrivs av createPartialInvoice
// EFTER rundan, så fallerade den skrivningen stod ordern som "Fakturera" med rundor men utan kolumn
// — och "Fakturera allt" gick till createinvoice. Nu räknas rundorna också (workOrderInvoicingStarted,
// samma fråga som avbrytandet ställer).

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

// workOrderInvoicingStarted behålls ÄKTA: det är regeln som prövas.
vi.mock('@/lib/domains/crm/work-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/work-orders')>();
  return {
    ...actual,
    getCrmWorkOrder: vi.fn(),
    listWorkOrderInvoiceRounds: vi.fn(),
    countWorkOrderInvoiceRounds: vi.fn(),
  };
});
vi.mock('@/lib/domains/fortnox/orders', () => ({ createInvoiceFromWorkOrder: vi.fn() }));
vi.mock('@/lib/domains/fortnox/partialInvoices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/fortnox/partialInvoices')>();
  return { ...actual, invoiceRemainingForWorkOrder: vi.fn(), createPartialInvoice: vi.fn() };
});
vi.mock('@/lib/supabase/session', () => ({ createSessionClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { countWorkOrderInvoiceRounds, getCrmWorkOrder, listWorkOrderInvoiceRounds } from '@/lib/domains/crm/work-orders';
import { createInvoiceFromWorkOrder } from '@/lib/domains/fortnox/orders';
import { createPartialInvoice, invoiceRemainingForWorkOrder } from '@/lib/domains/fortnox/partialInvoices';
import { FortnoxInvoiceNotRecordedError } from '@/lib/domains/fortnox/client';

const { POST: invoicePOST } = await import('@/app/api/crm/work-orders/[id]/invoice/route');
const { POST: partialPOST } = await import('@/app/api/crm/work-orders/[id]/invoice/partial/route');

const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';
const ctx = { params: { id: WORK_ORDER_ID } };

// En order i "Fakturera" UTAN status eller kolumn från delfaktureringen — läget efter att
// skrivningen efter en runda fallerat.
const completedOrder = {
  id: WORK_ORDER_ID,
  status: 'completed',
  partial_invoicing_started_at: null,
  fortnox_invoice_number: null,
  line_items: [{ id: 'line-a', pricing_mode: 'item', unit_price: '100', quantity: '10' }],
};

const invoiceReq = () => new Request(`http://localhost/api/crm/work-orders/${WORK_ORDER_ID}/invoice`, { method: 'POST' });
const partialReq = () => new Request(`http://localhost/api/crm/work-orders/${WORK_ORDER_ID}/invoice/partial`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ lines: [{ line_id: 'line-a', quantity: 4 }] }),
});

const roundCount = (count: number | null, error: { message: string } | null = null) =>
  vi.mocked(countWorkOrderInvoiceRounds).mockResolvedValue({ count, error } as never);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(getCurrentUser).mockResolvedValue(salesUser as any);
  vi.mocked(getEffectivePermissions).mockImplementation(async () => effectivePermissionsForRole('sales') as any);
  vi.mocked(getCrmWorkOrder).mockResolvedValue({ data: completedOrder, error: null } as never);
  vi.mocked(listWorkOrderInvoiceRounds).mockResolvedValue({ data: [], error: null } as never);
  vi.mocked(invoiceRemainingForWorkOrder).mockResolvedValue({} as never);
  vi.mocked(createInvoiceFromWorkOrder).mockResolvedValue({} as never);
});

describe('POST /invoice — "Fakturera allt" väljer väg på rundorna', () => {
  it('fakturerar resten som en runda när rundor finns, fast status och kolumn saknas', async () => {
    roundCount(1);

    const res = await invoicePOST(invoiceReq(), ctx);

    expect(res.status).toBe(200);
    expect(invoiceRemainingForWorkOrder).toHaveBeenCalledWith(WORK_ORDER_ID, salesUser.id);
    expect(createInvoiceFromWorkOrder).not.toHaveBeenCalled();
  });

  it('använder orderns createinvoice när ingen runda finns', async () => {
    roundCount(0);

    await invoicePOST(invoiceReq(), ctx);

    expect(createInvoiceFromWorkOrder).toHaveBeenCalledWith(WORK_ORDER_ID);
    expect(invoiceRemainingForWorkOrder).not.toHaveBeenCalled();
  });

  // Fail closed: ett läsfel som tolkas som "inga rundor" är precis vägen till dubbelfakturan.
  it('fakturerar ingenting när rundorna inte går att räkna', async () => {
    roundCount(null, { message: 'db down' });

    const res = await invoicePOST(invoiceReq(), ctx);

    expect(res.status).toBe(500);
    expect(createInvoiceFromWorkOrder).not.toHaveBeenCalled();
    expect(invoiceRemainingForWorkOrder).not.toHaveBeenCalled();
  });

  it('fakturerar ingenting när räkningen saknar svar', async () => {
    roundCount(null);

    expect((await invoicePOST(invoiceReq(), ctx)).status).toBe(500);
    expect(createInvoiceFromWorkOrder).not.toHaveBeenCalled();
  });
});

// Beskedet "Fakturera INTE igen" måste nå användaren ordagrant genom båda rutterna — det
// generiska svaret var "Försök igen", och ett nytt försök fakturerar samma antal en gång till.
describe('faktura skapad men inte sparad — beskedet når fram', () => {
  const notRecorded = new FortnoxInvoiceNotRecordedError('9001', 'Faktura 9001 skapades i Fortnox men kunde inte sparas i CRM. Fakturera INTE igen.');

  it('genom "Fakturera allt"', async () => {
    roundCount(1);
    vi.mocked(invoiceRemainingForWorkOrder).mockRejectedValue(notRecorded);

    const json = await (await invoicePOST(invoiceReq(), ctx)).json();

    expect(json.error).toBe(notRecorded.message);
  });

  it('genom delfaktureringen', async () => {
    vi.mocked(createPartialInvoice).mockRejectedValue(notRecorded);

    const json = await (await partialPOST(partialReq(), ctx)).json();

    expect(json.error).toBe(notRecorded.message);
  });
});
