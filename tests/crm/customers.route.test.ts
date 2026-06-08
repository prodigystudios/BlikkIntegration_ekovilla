import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesUser, adminUser, memberUser, effectivePermissionsForRole } from './helpers/supabase';

// ---------------------------------------------------------------------------
// Mockar måste deklareras INNAN modulimporter
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/route', () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock('@/lib/domains/crm/customers', () => ({
  listCrmCustomers: vi.fn(),
  createCrmCustomer: vi.fn(),
  getCrmCustomer: vi.fn(),
  updateCrmCustomer: vi.fn(),
}));

vi.mock('@supabase/auth-helpers-nextjs', () => ({
  createRouteHandlerClient: vi.fn(() => ({})),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Importer (efter mock-deklarationer)
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import {
  listCrmCustomers,
  createCrmCustomer,
  getCrmCustomer,
  updateCrmCustomer,
} from '@/lib/domains/crm/customers';

// Dynamiska importer av route-handlers för att säkerställa att mockar är aktiva
const { GET: collectionGET, POST } = await import('@/app/api/crm/customers/route');
const { GET: itemGET, PATCH } = await import('@/app/api/crm/customers/[id]/route');

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockList = vi.mocked(listCrmCustomers);
const mockCreate = vi.mocked(createCrmCustomer);
const mockGet = vi.mocked(getCrmCustomer);
const mockUpdate = vi.mocked(updateCrmCustomer);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getEffectivePermissions).mockImplementation(async () =>
    effectivePermissionsForRole((await vi.mocked(getCurrentUser)())?.role));
});

// ---------------------------------------------------------------------------
// Hjälpare
// ---------------------------------------------------------------------------

function makeRequest(url: string, options?: RequestInit) {
  return new Request(`http://localhost${url}`, options);
}

function jsonBody(body: unknown) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// GET /api/crm/customers — auth
// ---------------------------------------------------------------------------

describe('GET /api/crm/customers — auth', () => {
  it('returnerar 401 när användare saknas', async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const res = await collectionGET(makeRequest('/api/crm/customers'));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(body.errorDetails.code).toBe('unauthorized');
  });

  it('returnerar 403 för role member', async () => {
    mockGetCurrentUser.mockResolvedValue(memberUser);

    const res = await collectionGET(makeRequest('/api/crm/customers'));

    expect(res.status).toBe(403);
  });

  it('tillåter sales-användare', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);
    mockList.mockResolvedValue({ data: [], error: null } as any);

    const res = await collectionGET(makeRequest('/api/crm/customers'));

    expect(res.status).toBe(200);
  });

  it('tillåter admin-användare', async () => {
    mockGetCurrentUser.mockResolvedValue(adminUser);
    mockList.mockResolvedValue({ data: [], error: null } as any);

    const res = await collectionGET(makeRequest('/api/crm/customers'));

    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/crm/customers — framgång och fel
// ---------------------------------------------------------------------------

describe('GET /api/crm/customers — svar', () => {
  it('returnerar ok:true med items-array', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);
    const mockData = [{ id: 'c1', company_name: 'Test AB' }];
    mockList.mockResolvedValue({ data: mockData, error: null } as any);

    const res = await collectionGET(makeRequest('/api/crm/customers'));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.data.items).toEqual(mockData);
  });

  it('returnerar tom array när inga kunder finns', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);
    mockList.mockResolvedValue({ data: null, error: null } as any);

    const res = await collectionGET(makeRequest('/api/crm/customers'));
    const body = await res.json();

    expect(body.data.items).toEqual([]);
  });

  it('returnerar 500 vid domänfel', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);
    mockList.mockResolvedValue({ data: null, error: { message: 'db error' } } as any);

    const res = await collectionGET(makeRequest('/api/crm/customers'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.errorDetails.code).toBe('crm_customers_list_failed');
  });

  it('skickar query-parametrar vidare till domänfunktionen', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);
    mockList.mockResolvedValue({ data: [], error: null } as any);

    await collectionGET(
      makeRequest('/api/crm/customers?q=test&status=active&stage=prospect')
    );

    expect(mockList).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        search: 'test',
        status: 'active',
        stage: 'prospect',
      })
    );
  });
});

// ---------------------------------------------------------------------------
// POST /api/crm/customers — validering
// ---------------------------------------------------------------------------

describe('POST /api/crm/customers — validering', () => {
  it('returnerar 400 vid saknad customer_type', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);

    const res = await POST(
      makeRequest('/api/crm/customers', jsonBody({ company_name: 'Test AB' }))
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.errorDetails.code).toBe('validation_error');
  });

  it('returnerar 400 för business utan company_name', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);

    const res = await POST(
      makeRequest('/api/crm/customers', jsonBody({ customer_type: 'business' }))
    );

    expect(res.status).toBe(400);
  });

  it('returnerar 400 för privatkund utan efternamn', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);

    const res = await POST(
      makeRequest(
        '/api/crm/customers',
        jsonBody({ customer_type: 'private', first_name: 'Anna' })
      )
    );

    expect(res.status).toBe(400);
  });

  it('returnerar 400 vid trasig JSON-body', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);

    const res = await POST(
      new Request('http://localhost/api/crm/customers', {
        method: 'POST',
        body: 'inte json{{{',
      })
    );

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/crm/customers — framgång
// ---------------------------------------------------------------------------

describe('POST /api/crm/customers — framgång', () => {
  it('skapar kund och returnerar 201', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);
    const created = { id: 'new-1', customer_type: 'business', company_name: 'Nytt AB' };
    mockCreate.mockResolvedValue({ data: created, error: null } as any);

    const res = await POST(
      makeRequest(
        '/api/crm/customers',
        jsonBody({ customer_type: 'business', company_name: 'Nytt AB' })
      )
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.item).toEqual(created);
  });

  it('sätter created_by och assigned_to till inloggad användares id', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);
    mockCreate.mockResolvedValue({ data: {}, error: null } as any);

    await POST(
      makeRequest(
        '/api/crm/customers',
        jsonBody({ customer_type: 'business', company_name: 'AB' })
      )
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        created_by: salesUser.id,
        assigned_to: salesUser.id,
      })
    );
  });

  it('returnerar 500 vid domänfel', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);
    mockCreate.mockResolvedValue({ data: null, error: { message: 'constraint violation' } } as any);

    const res = await POST(
      makeRequest(
        '/api/crm/customers',
        jsonBody({ customer_type: 'business', company_name: 'AB' })
      )
    );

    expect(res.status).toBe(500);
    expect((await res.json()).errorDetails.code).toBe('crm_customer_create_failed');
  });
});

// ---------------------------------------------------------------------------
// GET /api/crm/customers/[id]
// ---------------------------------------------------------------------------

describe('GET /api/crm/customers/[id]', () => {
  const ctx = { params: { id: 'c1' } };

  it('returnerar 401 utan session', async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const res = await itemGET(makeRequest('/api/crm/customers/c1'), ctx);
    expect(res.status).toBe(401);
  });

  it('returnerar kund vid framgång', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);
    const customer = { id: 'c1', company_name: 'Test AB' };
    mockGet.mockResolvedValue({ data: customer, error: null } as any);

    const res = await itemGET(makeRequest('/api/crm/customers/c1'), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.item).toEqual(customer);
    expect(mockGet).toHaveBeenCalledWith(expect.anything(), 'c1');
  });

  it('returnerar 404 om kund inte hittas', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);
    mockGet.mockResolvedValue({ data: null, error: { message: 'not found' } } as any);

    const res = await itemGET(makeRequest('/api/crm/customers/c1'), ctx);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/crm/customers/[id]
// ---------------------------------------------------------------------------

describe('PATCH /api/crm/customers/[id]', () => {
  const ctx = { params: { id: 'c1' } };

  it('returnerar 401 utan session', async () => {
    mockGetCurrentUser.mockResolvedValue(null);

    const res = await PATCH(
      makeRequest('/api/crm/customers/c1', { method: 'PATCH', body: '{}' }),
      ctx
    );
    expect(res.status).toBe(401);
  });

  it('returnerar 400 vid ogiltig body', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);

    const res = await PATCH(
      makeRequest(
        '/api/crm/customers/c1',
        { method: 'PATCH', body: JSON.stringify({ status: 'ogiltig' }) }
      ),
      ctx
    );

    expect(res.status).toBe(400);
  });

  it('uppdaterar kund och returnerar 200', async () => {
    mockGetCurrentUser.mockResolvedValue(salesUser);
    const updated = { id: 'c1', status: 'inactive' };
    mockUpdate.mockResolvedValue({ data: updated, error: null } as any);

    const res = await PATCH(
      makeRequest(
        '/api/crm/customers/c1',
        { method: 'PATCH', body: JSON.stringify({ status: 'inactive' }) }
      ),
      ctx
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.item).toEqual(updated);
    expect(mockUpdate).toHaveBeenCalledWith(expect.anything(), 'c1', expect.objectContaining({ status: 'inactive' }));
  });
});
