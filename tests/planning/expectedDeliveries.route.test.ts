import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, effectivePermissionsForRole } from '../crm/helpers/supabase';

// PATCH på en väntad leverans som kom ur en materialbeställning. Databasen låser depå och material (det
// fabriken fick i mailet); routen ska säga det på svenska i stället för ett 500 med triggerns namn.

vi.mock('@/lib/auth/route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/route')>();
  return { ...actual, getCurrentUser: vi.fn() };
});
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});
vi.mock('@/lib/domains/planning/expectedDeliveries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/planning/expectedDeliveries')>();
  return { ...actual, updateExpectedDelivery: vi.fn() };
});
vi.mock('@/lib/domains/planning/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@supabase/auth-helpers-nextjs', () => ({ createRouteHandlerClient: vi.fn(() => ({ __client: 'session' })) }));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { updateExpectedDelivery } from '@/lib/domains/planning/expectedDeliveries';
import { PATCH } from '@/app/api/crm/planering/expected-deliveries/[id]/route';

const ID = '11111111-2222-4333-8444-555555555555';
const patch = (body: unknown) => PATCH(new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify(body) }), { params: { id: ID } });

beforeEach(() => {
  vi.clearAllMocks();
  (getCurrentUser as any).mockResolvedValue(adminUser);
  (getEffectivePermissions as any).mockResolvedValue(effectivePermissionsForRole('admin'));
});

describe('en beställd rad', () => {
  it('byte av depå eller material: 409 på svenska, inte 500', async () => {
    (updateExpectedDelivery as any).mockResolvedValue({ data: null, error: { message: 'expected_delivery_ordered_line_is_locked', code: '23514' } });
    const res = await patch({ depot_id: '22222222-2222-4333-8444-555555555555' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/beställd hos fabriken/);
  });

  it('ett annat databasfel är fortfarande ett 500', async () => {
    (updateExpectedDelivery as any).mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect((await patch({ sacks: 10 })).status).toBe(500);
  });
});
