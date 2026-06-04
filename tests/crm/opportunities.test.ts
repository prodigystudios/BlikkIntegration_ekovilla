import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesUser, adminUser, memberUser } from './helpers/supabase';

// ---------------------------------------------------------------------------
// Mockar
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/domains/crm/opportunities', () => ({
  listCrmOpportunities: vi.fn(),
  createCrmOpportunity: vi.fn(),
  getCrmOpportunity: vi.fn(),
  updateCrmOpportunity: vi.fn(),
}));

vi.mock('@supabase/auth-helpers-nextjs', () => ({
  createRouteHandlerClient: vi.fn(() => ({})),
}));

vi.mock('next/headers', () => ({ cookies: vi.fn() }));

// ---------------------------------------------------------------------------
// Importer
// ---------------------------------------------------------------------------

import { getCurrentUser } from '@/lib/auth/route';
import {
  listCrmOpportunities,
  createCrmOpportunity,
  getCrmOpportunity,
  updateCrmOpportunity,
} from '@/lib/domains/crm/opportunities';
import {
  createCrmOpportunitySchema,
  updateCrmOpportunitySchema,
  listCrmOpportunitiesQuerySchema,
} from '@/app/api/crm/opportunities/_lib';

const { GET: collectionGET, POST } = await import('@/app/api/crm/opportunities/route');
const { GET: itemGET, PATCH } = await import('@/app/api/crm/opportunities/[id]/route');

const mockGetUser = vi.mocked(getCurrentUser);
const mockList = vi.mocked(listCrmOpportunities);
const mockCreate = vi.mocked(createCrmOpportunity);
const mockGet = vi.mocked(getCrmOpportunity);
const mockUpdate = vi.mocked(updateCrmOpportunity);

beforeEach(() => vi.clearAllMocks());

function req(url: string, init?: RequestInit) {
  return new Request(`http://localhost${url}`, init);
}

function patch(body: unknown, url = '/api/crm/opportunities/o1') {
  return req(url, { method: 'PATCH', body: JSON.stringify(body) });
}

// ---------------------------------------------------------------------------
// Schema — createCrmOpportunitySchema
// ---------------------------------------------------------------------------

describe('createCrmOpportunitySchema', () => {
  const base = { title: 'Ny affär', customer_name: 'Test AB' };

  it('godkänner med customer_name', () => {
    expect(createCrmOpportunitySchema.safeParse(base).success).toBe(true);
  });

  it('godkänner med prospect_id (UUID)', () => {
    const result = createCrmOpportunitySchema.safeParse({
      title: 'Ny affär',
      prospect_id: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(true);
  });

  it('misslyckas utan titel', () => {
    expect(createCrmOpportunitySchema.safeParse({ customer_name: 'AB' }).success).toBe(false);
  });

  it('misslyckas utan prospect, kund eller kundnamn', () => {
    expect(createCrmOpportunitySchema.safeParse({ title: 'Test' }).success).toBe(false);
  });

  it('sätter default status till qualified', () => {
    const result = createCrmOpportunitySchema.safeParse(base);
    expect(result.success && result.data.status).toBe('qualified');
  });

  it('misslyckas med ogiltigt status', () => {
    expect(
      createCrmOpportunitySchema.safeParse({ ...base, status: 'pending' }).success
    ).toBe(false);
  });
});

describe('updateCrmOpportunitySchema', () => {
  it('kräver title och status (ej partiell)', () => {
    expect(
      updateCrmOpportunitySchema.safeParse({ customer_name: 'AB' }).success
    ).toBe(false);
  });

  it('godkänner komplett uppdatering', () => {
    expect(
      updateCrmOpportunitySchema.safeParse({
        title: 'Uppdaterad',
        status: 'won',
        customer_name: 'AB',
      }).success
    ).toBe(true);
  });
});

describe('listCrmOpportunitiesQuerySchema', () => {
  it('godkänner tom query', () => {
    expect(listCrmOpportunitiesQuerySchema.safeParse({}).success).toBe(true);
  });

  it('misslyckas med ogiltigt status', () => {
    expect(listCrmOpportunitiesQuerySchema.safeParse({ status: 'open' }).success).toBe(false);
  });

  it('misslyckas med icke-UUID prospect_id', () => {
    expect(listCrmOpportunitiesQuerySchema.safeParse({ prospect_id: 'abc' }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GET /api/crm/opportunities — auth
// ---------------------------------------------------------------------------

describe('GET /api/crm/opportunities — auth', () => {
  it('returnerar 401 utan session', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await collectionGET(req('/api/crm/opportunities'));
    expect(res.status).toBe(401);
  });

  it('returnerar 403 för member', async () => {
    mockGetUser.mockResolvedValue(memberUser);
    const res = await collectionGET(req('/api/crm/opportunities'));
    expect(res.status).toBe(403);
  });

  it('tillåter sales', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockList.mockResolvedValue({ data: [], error: null } as any);
    expect((await collectionGET(req('/api/crm/opportunities'))).status).toBe(200);
  });

  it('tillåter admin', async () => {
    mockGetUser.mockResolvedValue(adminUser);
    mockList.mockResolvedValue({ data: [], error: null } as any);
    expect((await collectionGET(req('/api/crm/opportunities'))).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/crm/opportunities — svar
// ---------------------------------------------------------------------------

describe('GET /api/crm/opportunities — svar', () => {
  it('returnerar ok:true med items-array', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    const data = [{ id: 'o1', title: 'Test' }];
    mockList.mockResolvedValue({ data, error: null } as any);

    const body = await (await collectionGET(req('/api/crm/opportunities'))).json();

    expect(body.ok).toBe(true);
    expect(body.data.items).toEqual(data);
  });

  it('returnerar tom array när data är null', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockList.mockResolvedValue({ data: null, error: null } as any);

    const body = await (await collectionGET(req('/api/crm/opportunities'))).json();

    expect(body.data.items).toEqual([]);
  });

  it('returnerar 500 vid domänfel', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockList.mockResolvedValue({ data: null, error: { message: 'db error' } } as any);

    const res = await collectionGET(req('/api/crm/opportunities'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.errorDetails.code).toBe('crm_opportunities_list_failed');
  });

  it('skickar query-parametrar till domänfunktionen', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockList.mockResolvedValue({ data: [], error: null } as any);

    await collectionGET(req('/api/crm/opportunities?q=sol&status=won'));

    expect(mockList).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ search: 'sol', status: 'won' })
    );
  });
});

// ---------------------------------------------------------------------------
// POST /api/crm/opportunities — validering och framgång
// ---------------------------------------------------------------------------

describe('POST /api/crm/opportunities', () => {
  it('returnerar 400 utan title', async () => {
    mockGetUser.mockResolvedValue(salesUser);

    const res = await POST(
      req('/api/crm/opportunities', {
        method: 'POST',
        body: JSON.stringify({ customer_name: 'AB' }),
      })
    );

    expect(res.status).toBe(400);
  });

  it('returnerar 400 utan kundkoppling', async () => {
    mockGetUser.mockResolvedValue(salesUser);

    const res = await POST(
      req('/api/crm/opportunities', {
        method: 'POST',
        body: JSON.stringify({ title: 'Test' }),
      })
    );

    expect(res.status).toBe(400);
  });

  it('skapar affärsmöjlighet och returnerar 201', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    const created = { id: 'o1', title: 'Ny affär' };
    mockCreate.mockResolvedValue({ data: created, error: null } as any);

    const res = await POST(
      req('/api/crm/opportunities', {
        method: 'POST',
        body: JSON.stringify({ title: 'Ny affär', customer_name: 'Test AB' }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.item).toEqual(created);
  });

  it('sätter created_by och assigned_to till inloggad användare', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockCreate.mockResolvedValue({ data: {}, error: null } as any);

    await POST(
      req('/api/crm/opportunities', {
        method: 'POST',
        body: JSON.stringify({ title: 'T', customer_name: 'AB' }),
      })
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ created_by: salesUser.id, assigned_to: salesUser.id })
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/crm/opportunities/[id]
// ---------------------------------------------------------------------------

describe('GET /api/crm/opportunities/[id]', () => {
  const ctx = { params: { id: 'o1' } };

  it('returnerar 401 utan session', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await itemGET(req('/api/crm/opportunities/o1'), ctx)).status).toBe(401);
  });

  it('returnerar affärsmöjlighet vid framgång', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockGet.mockResolvedValue({ data: { id: 'o1' }, error: null } as any);

    const body = await (await itemGET(req('/api/crm/opportunities/o1'), ctx)).json();

    expect(body.ok).toBe(true);
    expect(body.data.item.id).toBe('o1');
    expect(mockGet).toHaveBeenCalledWith(expect.anything(), 'o1');
  });

  it('returnerar 404 vid saknat objekt', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockGet.mockResolvedValue({ data: null, error: { message: 'not found' } } as any);

    expect((await itemGET(req('/api/crm/opportunities/o1'), ctx)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/crm/opportunities/[id]
// ---------------------------------------------------------------------------

describe('PATCH /api/crm/opportunities/[id]', () => {
  const ctx = { params: { id: 'o1' } };
  const validUpdate = { title: 'Uppdaterad', status: 'won', customer_name: 'AB' };

  it('returnerar 401 utan session', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await PATCH(patch(validUpdate), ctx)).status).toBe(401);
  });

  it('returnerar 400 utan required fält', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    expect((await PATCH(patch({ notes: 'Bara en notering' }), ctx)).status).toBe(400);
  });

  it('uppdaterar och returnerar 200', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    const updated = { id: 'o1', ...validUpdate };
    mockUpdate.mockResolvedValue({ data: updated, error: null } as any);

    const res = await PATCH(patch(validUpdate), ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.item).toEqual(updated);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      expect.objectContaining({ status: 'won' })
    );
  });
});
