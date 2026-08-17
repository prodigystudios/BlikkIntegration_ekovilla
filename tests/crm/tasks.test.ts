import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesUser, adminUser, effectivePermissionsForRole } from './helpers/supabase';

// authorizeTaskOwner slår upp säljarkatalogen med elevated klient (profiles-RLS är self-only).
vi.mock('@/lib/domains/crm/customers', () => ({ listCrmSellers: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ({})) }));
vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { listCrmSellers } from '@/lib/domains/crm/customers';
import { mapCrmTaskRow } from '@/lib/domains/crm/tasks';
import { authorizeTaskOwner } from '@/app/api/crm/tasks/_lib';

const mockSellers = vi.mocked(listCrmSellers);

const SALJARE = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectivePermissions).mockImplementation(async () =>
    effectivePermissionsForRole((await vi.mocked(getCurrentUser)())?.role));
});

function rawTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    user_id: 'saljare-1',
    created_by: 'chef-1',
    kind: 'note',
    title: 'Ring kunden',
    body: null,
    status: 'active',
    due_at: null,
    remind_at: null,
    completed_at: null,
    created_at: '2026-08-17T08:00:00Z',
    updated_at: '2026-08-17T08:00:00Z',
    related_type: null,
    related_id: null,
    metadata: null,
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// mapCrmTaskRow — delegated
// ---------------------------------------------------------------------------

describe('mapCrmTaskRow — delegated', () => {
  it('flaggar uppgiften när skaparen inte är den som ska göra den', () => {
    expect(mapCrmTaskRow(rawTask()).delegated).toBe(true);
  });

  it('flaggar INTE en uppgift man skapat åt sig själv', () => {
    expect(mapCrmTaskRow(rawTask({ created_by: 'saljare-1' })).delegated).toBe(false);
  });

  // Rader skapade före created_by-kolumnen fanns har null. De är egna uppgifter, inte
  // delegerade — utan den här grenen hade varje gammal uppgift fått en "Från:"-etikett.
  it('behandlar en rad utan created_by som egen, inte delegerad', () => {
    const mapped = mapCrmTaskRow(rawTask({ created_by: null }));
    expect(mapped.delegated).toBe(false);
    expect(mapped.created_by).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// authorizeTaskOwner
// ---------------------------------------------------------------------------

describe('authorizeTaskOwner', () => {
  it('returnerar ingen ägare när uppgiften är till en själv', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(salesUser);

    const result = await authorizeTaskOwner(salesUser.id, salesUser.id);

    expect(result.response).toBeNull();
    expect(result.ownerId).toBeNull();
    // Varken behörighet eller katalog ska slås upp för en uppgift till en själv.
    expect(mockSellers).not.toHaveBeenCalled();
  });

  it('returnerar ingen ägare när fältet utelämnas helt', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(salesUser);

    const result = await authorizeTaskOwner(undefined, salesUser.id);

    expect(result.ownerId).toBeNull();
    expect(result.response).toBeNull();
  });

  it('nekar en vanlig säljare att lägga uppgiften på någon annan', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(salesUser);

    const result = await authorizeTaskOwner(SALJARE, salesUser.id);

    expect(result.response?.status).toBe(403);
    expect(mockSellers).not.toHaveBeenCalled();
  });

  it('låter en administratör lägga uppgiften på en säljare', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(adminUser);
    mockSellers.mockResolvedValue([{ id: SALJARE, full_name: 'Anna', role: 'sales' }]);

    const result = await authorizeTaskOwner(SALJARE, adminUser.id);

    expect(result.response).toBeNull();
    expect(result.ownerId).toBe(SALJARE);
  });

  // Utan den här kontrollen går uppgiften att parkera på en installatör, som varken når /crm
  // eller ser uppgiftslistan — den blir osynlig för alla utom den som skrev den.
  it('avvisar en mottagare som inte finns i säljarkatalogen', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(adminUser);
    mockSellers.mockResolvedValue([]);

    const result = await authorizeTaskOwner(SALJARE, adminUser.id);

    expect(result.response?.status).toBe(422);
    expect(result.ownerId).toBeNull();
  });
});
