import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesUser, adminUser, effectivePermissionsForRole } from './helpers/supabase';

// PATCH arbetsorder → Avbruten: Fortnox-ordern makuleras först, och ett nej sparar ingenting
// (lib/domains/fortnox/workOrderCancel.ts, William 2026-10-02). Domänens ordning prövas i
// tests/fortnox/workOrderCancel.test.ts; här prövas vad ROUTEN gör med varje utfall.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

vi.mock('@/lib/domains/crm/work-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/work-orders')>();
  return { ...actual, getCrmWorkOrder: vi.fn(), updateCrmWorkOrder: vi.fn(), listWorkOrderInvoiceRounds: vi.fn() };
});

vi.mock('@/lib/domains/fortnox/orders', () => ({
  syncWorkOrderHeaderToFortnox: vi.fn(),
  updateWorkOrderInFortnox: vi.fn(),
}));

// De rena reglerna (stegen, RLS-speglingen) är äkta; Fortnox-vägarna fejkas.
vi.mock('@/lib/domains/fortnox/workOrderCancel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/fortnox/workOrderCancel')>();
  return { ...actual, cancelWorkOrderWithFortnox: vi.fn(), checkWorkOrderReactivation: vi.fn() };
});

vi.mock('@/lib/supabase/session', () => ({ createSessionClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { getCrmWorkOrder, listWorkOrderInvoiceRounds, updateCrmWorkOrder } from '@/lib/domains/crm/work-orders';
import { syncWorkOrderHeaderToFortnox, updateWorkOrderInFortnox } from '@/lib/domains/fortnox/orders';
import { cancelWorkOrderWithFortnox, checkWorkOrderReactivation } from '@/lib/domains/fortnox/workOrderCancel';
import { FortnoxApiError, FortnoxNotConnectedError } from '@/lib/domains/fortnox/client';

const { PATCH } = await import('@/app/api/crm/work-orders/[id]/route');
const { POST: syncPOST } = await import('@/app/api/crm/work-orders/[id]/fortnox/route');

const ID = '77777777-7777-4777-8777-777777777777';
const ctx = { params: { id: ID } };

const order = {
  id: ID,
  status: 'scheduled',
  quote_type: 'business',
  assigned_to: salesUser.id,
  customer_snapshot: { label: 'GAMMAL', your_reference: 'Per Linderdahl' },
  work_address: { city: 'Sandviken', postal_code: '81140', street_address: 'Stallgatan 18' },
  rot_details: {},
  fortnox_order_number: '131',
  fortnox_invoice_number: null as string | null,
};

function patch(payload: Record<string, unknown>) {
  return PATCH(new Request(`http://localhost/api/crm/work-orders/${ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }), ctx);
}

// Det ordersidans Redigera skickar: statusen och de speglade fälten, oförändrade.
const formSave = (status: string) => ({
  status,
  your_reference: 'Per Linderdahl',
  label: 'GAMMAL',
  work_address: { street_address: 'Stallgatan 18', postal_code: '81140', city: 'Sandviken' },
});

function install(current: Record<string, unknown>) {
  vi.mocked(getCrmWorkOrder).mockResolvedValue({ data: current, error: null } as never);
  vi.mocked(updateCrmWorkOrder).mockResolvedValue({ data: { ...current, status: 'cancelled' }, error: null } as never);
}

/** Fortnox tar makuleringen: domänen kör sparandet och svarar med numret. */
function fortnoxAccepts(orderNumber: string | null = '131') {
  vi.mocked(cancelWorkOrderWithFortnox).mockImplementation(async (_id, save) => ({
    kind: 'saved', fortnoxOrderNumber: orderNumber, saved: await save(),
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(salesUser as never);
  vi.mocked(getEffectivePermissions).mockImplementation(async () => effectivePermissionsForRole(salesUser.role));
  vi.mocked(syncWorkOrderHeaderToFortnox).mockResolvedValue({ fortnox_order_number: '131' } as never);
  vi.mocked(updateWorkOrderInFortnox).mockResolvedValue({ fortnox_order_number: '131' } as never);
  install(order);
  fortnoxAccepts();
  vi.mocked(listWorkOrderInvoiceRounds).mockResolvedValue({ data: [], error: null } as never);
});

describe('PATCH arbetsorder → Avbruten', () => {
  // ⚖️ KÄRNAN.
  it('makulerar Fortnox-ordern och sparar statusen genom den', async () => {
    const res = await patch(formSave('cancelled'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(cancelWorkOrderWithFortnox).toHaveBeenCalledOnce();
    expect(updateCrmWorkOrder).toHaveBeenCalledOnce();
    expect(json.data.fortnox_cancelled).toBe('131');
  });

  // 🧨 Redigera skickar alltid de speglade fälten. Utan spärren header-synkade samma PATCH mot ordern den just
  // makulerat — nej från Fortnox, och ordern stämplad 'failed'.
  it('speglar inte till den makulerade ordern i samma sparning', async () => {
    const json = await (await patch(formSave('cancelled'))).json();

    expect(syncWorkOrderHeaderToFortnox).not.toHaveBeenCalled();
    expect(updateWorkOrderInFortnox).not.toHaveBeenCalled();
    expect(json.data.fortnox_error).toBeNull();
  });

  // ⚖️ NEJET SPARAR INGENTING.
  it('sparar ingenting när Fortnox-ordern är fakturerad', async () => {
    vi.mocked(cancelWorkOrderWithFortnox).mockResolvedValue({ kind: 'invoiced', fortnoxOrderNumber: '131', invoiceNumber: '2051' });

    const res = await patch(formSave('cancelled'));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.errorDetails.code).toBe('crm_work_order_fortnox_invoiced');
    expect(json.error).toContain('2051');
    expect(updateCrmWorkOrder).not.toHaveBeenCalled();
  });

  it('sparar ingenting när Fortnox säger nej av annat skäl', async () => {
    vi.mocked(cancelWorkOrderWithFortnox).mockRejectedValue(
      new FortnoxApiError(400, 'Fortnox PUT /orders/131/cancel (400)', 2001383, 'Är låst och kan inte makuleras'));

    const res = await patch(formSave('cancelled'));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.errorDetails.code).toBe('crm_work_order_fortnox_cancel_failed');
    expect(json.error).toContain('inte avbruten');
    expect(updateCrmWorkOrder).not.toHaveBeenCalled();
  });

  it('sparar ingenting när Fortnox inte är kopplat', async () => {
    vi.mocked(cancelWorkOrderWithFortnox).mockRejectedValue(new FortnoxNotConnectedError());

    const res = await patch({ status: 'cancelled' });

    expect(res.status).toBe(409);
    expect((await res.json()).errorDetails.code).toBe('fortnox_not_connected');
    expect(updateCrmWorkOrder).not.toHaveBeenCalled();
  });

  it('sparar ingenting när ett skapande håller claimen', async () => {
    vi.mocked(cancelWorkOrderWithFortnox).mockResolvedValue({ kind: 'busy' });

    const res = await patch({ status: 'cancelled' });

    expect(res.status).toBe(409);
    expect((await res.json()).errorDetails.code).toBe('fortnox_push_in_progress');
    expect(updateCrmWorkOrder).not.toHaveBeenCalled();
  });

  // 🧨 RLS prövas FÖRE Fortnox. Annars: Fortnox-ordern makulerad, sparandet nekat av policyn.
  it('nekar en säljare som inte är ansvarig — innan Fortnox anropas', async () => {
    install({ ...order, assigned_to: 'someone-else' });

    const res = await patch({ status: 'cancelled' });

    expect(res.status).toBe(403);
    expect(cancelWorkOrderWithFortnox).not.toHaveBeenCalled();
    expect(updateCrmWorkOrder).not.toHaveBeenCalled();
  });

  it('släpper igenom crm.admin på någon annans order', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(adminUser as never);
    vi.mocked(getEffectivePermissions).mockImplementation(async () => effectivePermissionsForRole(adminUser.role));
    install({ ...order, assigned_to: 'someone-else' });

    const res = await patch({ status: 'cancelled' });

    expect(res.status).toBe(200);
    expect(cancelWorkOrderWithFortnox).toHaveBeenCalledOnce();
  });

  // Det enda läget där systemen skiljer sig — och det ska sägas, inte sväljas.
  it('säger det rakt ut när Fortnox makulerade men sparandet föll', async () => {
    vi.mocked(updateCrmWorkOrder).mockResolvedValue({ data: null, error: { message: 'connection reset' } } as never);

    const res = await patch({ status: 'cancelled' });
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.errorDetails.code).toBe('crm_work_order_update_failed_after_fortnox_cancel');
    expect(json.error).toContain('131');
  });

  // 🧨 WITH CHECK: Redigera skickar alltid ansvarig. Byter den ansvarige till en kollega i samma sparning nekar policyn
  // den nya raden — efter att Fortnox redan makulerat. Prövas därför före.
  it('nekar den ansvarige som lämnar över och avbryter i samma sparning — innan Fortnox anropas', async () => {
    const res = await patch({ ...formSave('cancelled'), assigned_to: '99999999-9999-4999-8999-999999999999' });

    expect(res.status).toBe(403);
    expect(cancelWorkOrderWithFortnox).not.toHaveBeenCalled();
  });

  // Raden sparades medan claimen höll 'pending'; svaret ska bära läget efter släppet.
  it('läser om raden efter avbrytandet', async () => {
    vi.mocked(getCrmWorkOrder)
      .mockResolvedValueOnce({ data: order, error: null } as never)
      .mockResolvedValueOnce({ data: { ...order, status: 'cancelled', fortnox_order_sync_status: 'synced' }, error: null } as never);
    vi.mocked(updateCrmWorkOrder).mockResolvedValue({ data: { ...order, status: 'cancelled', fortnox_order_sync_status: 'pending' }, error: null } as never);

    const json = await (await patch({ status: 'cancelled' })).json();

    expect(json.data.item.fortnox_order_sync_status).toBe('synced');
  });

  // En lyckad makulering ska inte läsas som ett fel för att märkningen ändrades i samma sparning.
  it('säger inget om speglingen när märkningen ändras i själva avbrytandet', async () => {
    const json = await (await patch({ ...formSave('cancelled'), label: 'NY' })).json();

    expect(json.data.fortnox_error).toBeNull();
    expect(json.data.fortnox_cancelled).toBe('131');
  });

  // Utan nummer går avbrytandet ändå genom domänen: claimen stänger ute ett skapande som är på väg.
  it('går genom claimen också när ordern aldrig skapats i Fortnox', async () => {
    install({ ...order, fortnox_order_number: null });
    fortnoxAccepts(null);

    const json = await (await patch({ status: 'cancelled' })).json();

    expect(cancelWorkOrderWithFortnox).toHaveBeenCalledOnce();
    expect(json.data.fortnox_cancelled).toBeNull();
  });
});

// En delfakturerad arbetsorder avbryts inte (William 2026-10-02) — och Fortnox tillfrågas aldrig.
describe('PATCH arbetsorder → Avbruten, delfakturerad', () => {
  it.each([
    // Varje tecken ensamt.
    ['bara statusen delfakturerad', { status: 'partially_invoiced', partial_invoicing_started_at: null }, 0],
    ['bara kolumnen: tillbaka på Pågående efter en delfaktura', { status: 'in_progress', partial_invoicing_started_at: '2026-10-01T10:00:00Z' }, 0],
    ['bara en runda: kolumnen skrevs aldrig', { status: 'completed', partial_invoicing_started_at: null }, 1],
  ])('nekas: %s', async (_name, fields, rounds) => {
    install({ ...order, ...fields });
    vi.mocked(listWorkOrderInvoiceRounds).mockResolvedValue({ data: Array.from({ length: rounds }, (_, i) => ({ id: `r${i}` })), error: null } as never);

    const res = await patch(formSave('cancelled'));

    expect(res.status).toBe(409);
    expect((await res.json()).errorDetails.code).toBe('crm_work_order_partially_invoiced');
    expect(cancelWorkOrderWithFortnox).not.toHaveBeenCalled();
    expect(updateCrmWorkOrder).not.toHaveBeenCalled();
  });

  // Fail-closed: ett läsfel hade sett ut som "inga fakturor".
  it('nekas när fakturarundorna inte går att läsa', async () => {
    vi.mocked(listWorkOrderInvoiceRounds).mockResolvedValue({ data: null, error: { message: 'timeout' } } as never);

    const res = await patch({ status: 'cancelled' });

    expect(res.status).toBe(503);
    expect(cancelWorkOrderWithFortnox).not.toHaveBeenCalled();
  });

  // Bara avbrytandet: en delfakturerad order får fortfarande byta mellan sina vanliga steg.
  it('stoppar inte andra statusbyten på en delfakturerad order', async () => {
    install({ ...order, status: 'partially_invoiced', partial_invoicing_started_at: '2026-10-01T10:00:00Z' });

    const res = await patch({ status: 'in_progress' });

    expect(res.status).toBe(200);
    expect(listWorkOrderInvoiceRounds).not.toHaveBeenCalled();
  });
});

describe('PATCH arbetsorder ← Avbruten', () => {
  it('öppnar inte en arbetsorder vars Fortnox-order är makulerad', async () => {
    install({ ...order, status: 'cancelled' });
    vi.mocked(checkWorkOrderReactivation).mockResolvedValue({ kind: 'fortnox_cancelled', fortnoxOrderNumber: '131' });

    const res = await patch({ status: 'scheduled' });

    expect(res.status).toBe(409);
    expect((await res.json()).errorDetails.code).toBe('crm_work_order_fortnox_cancelled');
    expect(updateCrmWorkOrder).not.toHaveBeenCalled();
  });

  // En order som avbröts före regeln har sin Fortnox-order öppen: den går att återuppta som förut.
  it('öppnar en avbruten order vars Fortnox-order fortfarande är öppen', async () => {
    install({ ...order, status: 'cancelled' });
    vi.mocked(checkWorkOrderReactivation).mockResolvedValue({ kind: 'allowed' });

    const res = await patch({ status: 'scheduled' });

    expect(res.status).toBe(200);
    expect(updateCrmWorkOrder).toHaveBeenCalledOnce();
    expect(cancelWorkOrderWithFortnox).not.toHaveBeenCalled();
  });

  // Fail-closed: går Fortnox inte att läsa vet vi inte om ordern är makulerad.
  it('står kvar som Avbruten när Fortnox-ordern inte går att läsa', async () => {
    install({ ...order, status: 'cancelled' });
    vi.mocked(checkWorkOrderReactivation).mockRejectedValue(new Error('timeout'));

    const res = await patch({ status: 'scheduled' });

    expect(res.status).toBe(502);
    expect(updateCrmWorkOrder).not.toHaveBeenCalled();
  });


});

describe('PATCH på en avbruten arbetsorder', () => {
  it('speglar inte en ändrad märkning, och säger det', async () => {
    install({ ...order, status: 'cancelled' });

    const json = await (await patch({ ...formSave('cancelled'), label: 'NY' })).json();

    expect(syncWorkOrderHeaderToFortnox).not.toHaveBeenCalled();
    expect(String(json.data.fortnox_error)).toContain('avbruten');
    expect(cancelWorkOrderWithFortnox).not.toHaveBeenCalled();
  });
});

describe('POST Synka om på en avbruten arbetsorder', () => {
  // Med nummer: PUT:en mot den makulerade ordern hade nekats och stämplat 'failed'. Utan: en ny, öppen order.
  it.each([['131'], [null]])('nekas utan Fortnox-anrop (nummer %s)', async (orderNumber) => {
    install({ ...order, status: 'cancelled', fortnox_order_number: orderNumber });

    const res = await syncPOST(new Request(`http://localhost/api/crm/work-orders/${ID}/fortnox`, { method: 'POST' }), ctx);

    expect(res.status).toBe(409);
    expect((await res.json()).errorDetails.code).toBe('crm_work_order_cancelled_locked');
    expect(updateWorkOrderInFortnox).not.toHaveBeenCalled();
  });
});
