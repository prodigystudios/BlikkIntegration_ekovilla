import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesUser, effectivePermissionsForRole } from './helpers/supabase';

// Speglingen av en redigerad arbetsorder mot Fortnox — och framför allt vad routen SÄGER när den
// inte gick fram.
//
// 🧨 Buggen filen föddes ur: `syncWorkOrderHeaderToFortnox` svarar `null` (inte ett fel) på ett
// fakturerat dokument, och routen läste det som "inget att rapportera". Svaret bar då
// `fortnox_error: null`, klienten visade grön "Arbetsorder sparad", och en märkning som aldrig
// nådde kundens order eller faktura såg sparad-och-synkad ut. Mätt i drift på Fortnox-order 131.
//
// Det som prövas här är alltså inte att synken fungerar — det gör tests/fortnox/orderPayload.test.ts
// — utan att TYSTNADEN är borta. Sparningen ska fortfarande landa; det är beskedet som ändrats.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

// ⚠️ `mergeWorkOrderSnapshotOverrides` behålls ÄKTA med flit. Det är regeln som avgör vad som
// faktiskt hamnar i snapshoten (och som armerar `label_cleared`); en mockad kopia hade gjort
// testet blint för just den sömmen.
vi.mock('@/lib/domains/crm/work-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/work-orders')>();
  return { ...actual, getCrmWorkOrder: vi.fn(), updateCrmWorkOrder: vi.fn(), listWorkOrderInvoiceRounds: vi.fn() };
});

vi.mock('@/lib/domains/fortnox/orders', () => ({
  syncWorkOrderHeaderToFortnox: vi.fn(),
  updateWorkOrderInFortnox: vi.fn(),
}));

vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { getCrmWorkOrder, updateCrmWorkOrder } from '@/lib/domains/crm/work-orders';
import { syncWorkOrderHeaderToFortnox, updateWorkOrderInFortnox } from '@/lib/domains/fortnox/orders';

const { PATCH } = await import('@/app/api/crm/work-orders/[id]/route');

const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';
const ctx = { params: { id: WORK_ORDER_ID } };

// En företagsorder som ligger i Fortnox. `invoiced`-fälten sätts per test.
const openOrder = {
  id: WORK_ORDER_ID,
  status: 'in_progress',
  quote_type: 'business',
  customer_snapshot: { label: 'GAMMAL', your_reference: 'Per Linderdahl' },
  rot_details: {},
  fortnox_order_number: '131',
  fortnox_invoice_number: null as string | null,
};

// ⚠️ `status` är OBLIGATORISKT i updateCrmWorkOrderSchema — klienten skickar alltid orderns
// nuvarande status vid varje sparning, och routen läser ett oförändrat värde som en no-op. Utan
// det faller varje PATCH på 400 och testet mäter valideringen i stället för speglingen.
function patchReq(payload: Record<string, unknown>) {
  return new Request(`http://localhost/api/crm/work-orders/${WORK_ORDER_ID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function install(current: Record<string, unknown>) {
  vi.mocked(getCrmWorkOrder).mockResolvedValue({ data: current, error: null } as never);
  vi.mocked(updateCrmWorkOrder).mockResolvedValue({ data: current, error: null } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue(salesUser as never);
  vi.mocked(getEffectivePermissions).mockImplementation(async () =>
    effectivePermissionsForRole(salesUser.role));
  vi.mocked(syncWorkOrderHeaderToFortnox).mockResolvedValue({ fortnox_order_number: '131' } as never);
  vi.mocked(updateWorkOrderInFortnox).mockResolvedValue({ fortnox_order_number: '131' } as never);
});

describe('PATCH arbetsorder — speglingen mot Fortnox', () => {
  // ⚖️ KÄRNAN. En fakturerad order tar inte emot ändringar, och det ska SÄGAS — inte sväljas.
  it('säger ifrån när märkningen ändras på en fakturerad order', async () => {
    install({ ...openOrder, status: 'invoiced', fortnox_invoice_number: '2026' });

    const res = await PATCH(patchReq({ status: 'invoiced', label: '58184' }), ctx);
    const json = await res.json();

    // Sparningen landar som förut …
    expect(res.status).toBe(200);
    // … men svaret får inte låtsas att ändringen nådde Fortnox.
    expect(json.data.fortnox_error).toBeTruthy();
    expect(String(json.data.fortnox_error)).toContain('fakturerad');
    // Och ingen skrivning ska ens försökas — Fortnox avvisar den ändå.
    expect(syncWorkOrderHeaderToFortnox).not.toHaveBeenCalled();
    expect(updateWorkOrderInFortnox).not.toHaveBeenCalled();
  });

  // Samma sak när fakturanumret finns men statusen inte hunnit bli 'invoiced' — det är
  // `fortnox_invoice_number` som stänger dokumentet hos Fortnox, inte vår egen statuskolumn.
  it('säger ifrån även när bara fakturanumret är satt', async () => {
    install({ ...openOrder, status: 'completed', fortnox_invoice_number: '2026' });

    const json = await (await PATCH(patchReq({ status: 'completed', label: '58184' }), ctx)).json();

    expect(json.data.fortnox_error).toBeTruthy();
    expect(syncWorkOrderHeaderToFortnox).not.toHaveBeenCalled();
  });

  // Grinden får inte slå till på en ÖPPEN order — då vore märkningen omöjlig att spegla alls.
  it('speglar märkningen som vanligt på en öppen order', async () => {
    install(openOrder);

    const json = await (await PATCH(patchReq({ status: 'in_progress', label: '58184' }), ctx)).json();

    expect(syncWorkOrderHeaderToFortnox).toHaveBeenCalledWith(WORK_ORDER_ID);
    expect(json.data.fortnox_error).toBeNull();
  });

  // ⚠️ Och inte på en sparning som inte rör ett speglat fält. Annars hade varje statusändring på
  // en fakturerad order larmat om en synk som aldrig var aktuell.
  it('larmar inte när sparningen inte rör något Fortnox speglar', async () => {
    install({ ...openOrder, status: 'completed', fortnox_invoice_number: '2026' });

    const json = await (await PATCH(patchReq({ status: 'completed' }), ctx)).json();

    expect(json.data.fortnox_error).toBeNull();
    expect(syncWorkOrderHeaderToFortnox).not.toHaveBeenCalled();
  });
});
