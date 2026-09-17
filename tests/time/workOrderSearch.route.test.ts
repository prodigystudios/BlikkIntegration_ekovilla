import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, memberUser, konsultUser, effectivePermissionsForRole } from '../crm/helpers/supabase';

// Ordersökningen i tidrapportens jobbväljare (/api/time/work-orders).
//
// Den finns för att dagens schema inte är hela sanningen: besättningen åker ibland ut en dag
// tidigare än planerat, och då gick tiden inte att rapportera alls. Kontorets egen ordersökning
// (/api/crm/work-orders) svarar 403 för en installatör, därför den här.
//
// 🧨 URVALET ÄR RLS, INTE KOD. Routen skickar SESSIONSKLIENTEN vidare — samma gräns som
// insert-policyn på tidraden. Byts den mot service-rollen ser en installatör hela orderregistret,
// och testet 'skickar sessionsklienten' är det som fångar det.

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

vi.mock('@/lib/domains/crm/work-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/work-orders')>();
  return { ...actual, searchWorkOrdersForTimeReport: vi.fn() };
});

const sessionClient = { marker: 'session' };
vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => sessionClient) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { searchWorkOrdersForTimeReport } from '@/lib/domains/crm/work-orders';

const { GET } = await import('@/app/api/time/work-orders/route');

const mockUser = vi.mocked(getCurrentUser);
const mockSearch = vi.mocked(searchWorkOrdersForTimeReport);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectivePermissions).mockImplementation(async () =>
    effectivePermissionsForRole((await vi.mocked(getCurrentUser)())?.role));
  mockSearch.mockResolvedValue({ data: [], error: null } as any);
});

const req = (url: string) => new Request(`http://localhost${url}`);

describe('GET /api/time/work-orders', () => {
  it('kräver inloggning', async () => {
    mockUser.mockResolvedValue(null);
    expect((await GET(req('/api/time/work-orders?q=657'))).status).toBe(401);
  });

  it('släpper in den som får rapportera tid — installatören', async () => {
    mockUser.mockResolvedValue(memberUser);
    expect((await GET(req('/api/time/work-orders?q=657'))).status).toBe(200);
  });

  it('nekar den som inte får rapportera tid', async () => {
    // konsult är läsroll och har ingen time.entry.write — och därmed inget att söka efter.
    mockUser.mockResolvedValue(konsultUser);
    expect((await GET(req('/api/time/work-orders?q=657'))).status).toBe(403);
  });

  it('kräver minst två tecken', async () => {
    mockUser.mockResolvedValue(memberUser);
    expect((await GET(req('/api/time/work-orders?q=6'))).status).toBe(400);
    expect((await GET(req('/api/time/work-orders'))).status).toBe(400);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('skickar SESSIONSKLIENTEN till sökningen, aldrig en egen klient', async () => {
    mockUser.mockResolvedValue(memberUser);
    await GET(req('/api/time/work-orders?q=Villa'));
    expect(mockSearch).toHaveBeenCalledWith(sessionClient, 'Villa');
  });

  it('svarar med träffarna', async () => {
    mockUser.mockResolvedValue(adminUser);
    mockSearch.mockResolvedValue({
      data: [{ id: 'wo-1', order_number: 'AO-1', fortnox_order_number: '6579', project_name: 'Vind', client_name: 'Villa Ek' }],
      error: null,
    } as any);
    const body = await (await GET(req('/api/time/work-orders?q=657'))).json();
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].fortnox_order_number).toBe('6579');
  });

  it('svarar 500 när sökningen failar i stället för att se ut som noll träffar', async () => {
    mockUser.mockResolvedValue(memberUser);
    mockSearch.mockResolvedValue({ data: [], error: { message: 'boom' } } as any);
    expect((await GET(req('/api/time/work-orders?q=657'))).status).toBe(500);
  });
});
