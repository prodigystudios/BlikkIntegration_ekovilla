import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesUser, adminUser, effectivePermissionsForRole } from './helpers/supabase';

// DELETE /api/crm/customers/[id] — kunden tas bort här och i Fortnox, eller ingenstans
// (lib/domains/fortnox/customerDelete.ts, William 2026-10-02). Domänens ordning prövas i
// tests/fortnox/customerDelete.test.ts; här prövas behörigheten och vad ROUTEN gör med varje utfall.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

// Felklasserna och beskedet är äkta; själva raderingen fejkas.
vi.mock('@/lib/domains/fortnox/customerDelete', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/fortnox/customerDelete')>();
  return { ...actual, deleteCrmCustomerWithFortnox: vi.fn(), customerDeleteDeps: vi.fn(() => ({})) };
});

vi.mock('@/lib/supabase/session', () => ({ createSessionClient: vi.fn(() => ({})) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { FortnoxApiError, FortnoxNotConnectedError } from '@/lib/domains/fortnox/client';
import {
  CustomerFortnoxDeleteError,
  CustomerLocalDeleteError,
  deleteCrmCustomerWithFortnox,
} from '@/lib/domains/fortnox/customerDelete';

const { DELETE } = await import('@/app/api/crm/customers/[id]/route');

const ID = '11111111-1111-4111-8111-111111111111';
const del = (id = ID) => DELETE(new Request(`http://localhost/api/crm/customers/${id}`, { method: 'DELETE' }), { params: { id } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectivePermissions).mockImplementation(async () =>
    effectivePermissionsForRole((await vi.mocked(getCurrentUser)())?.role));
  vi.mocked(getCurrentUser).mockResolvedValue(adminUser);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('DELETE /api/crm/customers/[id]', () => {
  it('säljaren nekas — bara crm.admin, och domänen anropas aldrig', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(salesUser);
    const res = await del();
    expect(res.status).toBe(403);
    expect(deleteCrmCustomerWithFortnox).not.toHaveBeenCalled();
  });

  it('ogiltigt id → 400', async () => {
    const res = await del('inte-ett-id');
    expect(res.status).toBe(400);
    expect(deleteCrmCustomerWithFortnox).not.toHaveBeenCalled();
  });

  it('borttagen → 200 med Fortnox-numret', async () => {
    vi.mocked(deleteCrmCustomerWithFortnox).mockResolvedValue({ kind: 'deleted', fortnoxCustomerNumber: '1042' });
    const res = await del();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ deleted: true, fortnox_customer_number: '1042' });
  });

  it('spärrad → 409 med vad som spärrar', async () => {
    const blockers = { quotes: 3, workOrders: 1, portal: 0 };
    vi.mocked(deleteCrmCustomerWithFortnox).mockResolvedValue({ kind: 'blocked', blockers });
    const res = await del();
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('Kunden har 3 offerter och 1 arbetsorder och kan inte tas bort.');
    expect(json.errorDetails).toMatchObject({ code: 'crm_customer_has_links', details: blockers });
  });

  it('finns inte → 404', async () => {
    vi.mocked(deleteCrmCustomerWithFortnox).mockResolvedValue({ kind: 'not_found' });
    expect((await del()).status).toBe(404);
  });

  it('Fortnox nej → 502 med Fortnox skäl och att ingenting är borttaget', async () => {
    vi.mocked(deleteCrmCustomerWithFortnox).mockRejectedValue(
      new CustomerFortnoxDeleteError('1042', new FortnoxApiError(400, 'x', 9999999, 'Kunden har fakturor')));
    const res = await del();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('Fortnox tog inte bort kund 1042: Kunden har fakturor Ingenting är borttaget.');
  });

  it('Fortnox inte kopplat → 409 med anslutningsbeskedet', async () => {
    vi.mocked(deleteCrmCustomerWithFortnox).mockRejectedValue(
      new CustomerFortnoxDeleteError('1042', new FortnoxNotConnectedError()));
    const res = await del();
    expect(res.status).toBe(409);
    expect((await res.json()).errorDetails.code).toBe('fortnox_not_connected');
  });

  it('vår radering föll efter Fortnox ja → 500 som säger att ett nytt försök läker det', async () => {
    vi.mocked(deleteCrmCustomerWithFortnox).mockRejectedValue(new CustomerLocalDeleteError('Ingen rad togs bort.', '1042'));
    const res = await del();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('borttagen i Fortnox men inte här');
  });

  it('vår radering föll utan Fortnox-koppling → 500 utan ord om Fortnox', async () => {
    vi.mocked(deleteCrmCustomerWithFortnox).mockRejectedValue(new CustomerLocalDeleteError('Ingen rad togs bort.', null));
    const json = await (await del()).json();
    expect(json.error).toBe('Kunden kunde inte tas bort: Ingen rad togs bort.');
  });
});
