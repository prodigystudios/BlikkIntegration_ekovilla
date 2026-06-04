import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesUser, adminUser, memberUser } from './helpers/supabase';

// ---------------------------------------------------------------------------
// Mockar
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/domains/crm/prospects', () => ({
  listCrmProspects: vi.fn(),
  createCrmProspect: vi.fn(),
  updateCrmProspect: vi.fn(),
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
  listCrmProspects,
  createCrmProspect,
  updateCrmProspect,
} from '@/lib/domains/crm/prospects';
import {
  createCrmProspectSchema,
  updateCrmProspectSchema,
  listCrmProspectsQuerySchema,
} from '@/app/api/crm/prospects/_lib';

const { GET: collectionGET, POST } = await import('@/app/api/crm/prospects/route');
const { PATCH } = await import('@/app/api/crm/prospects/[id]/route');

const mockGetUser = vi.mocked(getCurrentUser);
const mockList = vi.mocked(listCrmProspects);
const mockCreate = vi.mocked(createCrmProspect);
const mockUpdate = vi.mocked(updateCrmProspect);

beforeEach(() => vi.clearAllMocks());

function req(url: string, init?: RequestInit) {
  return new Request(`http://localhost${url}`, init);
}

// ---------------------------------------------------------------------------
// Schema — createCrmProspectSchema
// ---------------------------------------------------------------------------

describe('createCrmProspectSchema', () => {
  it('godkänner minimal giltig input', () => {
    expect(
      createCrmProspectSchema.safeParse({ company_name: 'Acme AB' }).success
    ).toBe(true);
  });

  it('misslyckas utan company_name', () => {
    expect(createCrmProspectSchema.safeParse({}).success).toBe(false);
  });

  it('misslyckas med tom company_name', () => {
    expect(createCrmProspectSchema.safeParse({ company_name: '' }).success).toBe(false);
  });

  it('godkänner vanlig e-post', () => {
    expect(
      createCrmProspectSchema.safeParse({
        company_name: 'AB',
        email: 'kontakt@example.com',
      }).success
    ).toBe(true);
  });

  it('misslyckas med ogiltig e-post', () => {
    expect(
      createCrmProspectSchema.safeParse({
        company_name: 'AB',
        email: 'inte-en-email',
      }).success
    ).toBe(false);
  });

  it('godkänner e-post med internationell domän', () => {
    // Valideraren använder domainToASCII för internationella domäner
    expect(
      createCrmProspectSchema.safeParse({
        company_name: 'AB',
        email: 'kontakt@example.se',
      }).success
    ).toBe(true);
  });

  it('trimmar whitespace från textfält', () => {
    const result = createCrmProspectSchema.safeParse({
      company_name: '  Acme AB  ',
    });
    expect(result.success && result.data.company_name).toBe('Acme AB');
  });

  it('sätter null-default för valfria fält', () => {
    const result = createCrmProspectSchema.safeParse({ company_name: 'AB' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBeNull();
      expect(result.data.phone).toBeNull();
      expect(result.data.contact_name).toBeNull();
    }
  });
});

describe('updateCrmProspectSchema', () => {
  it('godkänner giltig uppdatering med status', () => {
    expect(
      updateCrmProspectSchema.safeParse({
        company_name: 'AB',
        status: 'qualified',
      }).success
    ).toBe(true);
  });

  it('misslyckas med ogiltigt status-värde', () => {
    expect(
      updateCrmProspectSchema.safeParse({
        company_name: 'AB',
        status: 'fel',
      }).success
    ).toBe(false);
  });

  it('godkänner alla giltiga status-värden', () => {
    const statuses = ['new', 'contacted', 'qualified', 'quoted', 'won', 'lost'];
    for (const status of statuses) {
      expect(
        updateCrmProspectSchema.safeParse({ company_name: 'AB', status }).success,
        `status "${status}" ska vara giltig`
      ).toBe(true);
    }
  });
});

describe('listCrmProspectsQuerySchema', () => {
  it('godkänner tom query', () => {
    expect(listCrmProspectsQuerySchema.safeParse({}).success).toBe(true);
  });

  it('godkänner söksträng', () => {
    expect(listCrmProspectsQuerySchema.safeParse({ q: 'tak' }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/crm/prospects — auth
// ---------------------------------------------------------------------------

describe('GET /api/crm/prospects — auth', () => {
  it('returnerar 401 utan session', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await collectionGET(req('/api/crm/prospects'))).status).toBe(401);
  });

  it('returnerar 403 för member', async () => {
    mockGetUser.mockResolvedValue(memberUser);
    expect((await collectionGET(req('/api/crm/prospects'))).status).toBe(403);
  });

  it('tillåter sales', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockList.mockResolvedValue({ data: [], error: null } as any);
    expect((await collectionGET(req('/api/crm/prospects'))).status).toBe(200);
  });

  it('tillåter admin', async () => {
    mockGetUser.mockResolvedValue(adminUser);
    mockList.mockResolvedValue({ data: [], error: null } as any);
    expect((await collectionGET(req('/api/crm/prospects'))).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/crm/prospects — svar
// ---------------------------------------------------------------------------

describe('GET /api/crm/prospects — svar', () => {
  it('returnerar ok:true med items-array', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    const data = [{ id: 'p1', company_name: 'Acme AB' }];
    mockList.mockResolvedValue({ data, error: null } as any);

    const body = await (await collectionGET(req('/api/crm/prospects'))).json();

    expect(body.ok).toBe(true);
    expect(body.data.items).toEqual(data);
  });

  it('returnerar tom array när data är null', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockList.mockResolvedValue({ data: null, error: null } as any);

    const body = await (await collectionGET(req('/api/crm/prospects'))).json();

    expect(body.data.items).toEqual([]);
  });

  it('returnerar 500 vid domänfel', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockList.mockResolvedValue({ data: null, error: { message: 'db error' } } as any);

    const res = await collectionGET(req('/api/crm/prospects'));

    expect(res.status).toBe(500);
    expect((await res.json()).errorDetails.code).toBe('crm_prospects_list_failed');
  });

  it('skickar sökparameter till domänfunktionen', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockList.mockResolvedValue({ data: [], error: null } as any);

    await collectionGET(req('/api/crm/prospects?q=acme'));

    expect(mockList).toHaveBeenCalledWith(expect.anything(), 'acme');
  });

  it('skickar undefined till domänfunktionen när q saknas', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockList.mockResolvedValue({ data: [], error: null } as any);

    await collectionGET(req('/api/crm/prospects'));

    expect(mockList).toHaveBeenCalledWith(expect.anything(), undefined);
  });
});

// ---------------------------------------------------------------------------
// POST /api/crm/prospects — validering och framgång
// ---------------------------------------------------------------------------

describe('POST /api/crm/prospects', () => {
  it('returnerar 400 utan company_name', async () => {
    mockGetUser.mockResolvedValue(salesUser);

    const res = await POST(
      req('/api/crm/prospects', {
        method: 'POST',
        body: JSON.stringify({ phone: '070123456' }),
      })
    );

    expect(res.status).toBe(400);
  });

  it('returnerar 400 med ogiltig e-post', async () => {
    mockGetUser.mockResolvedValue(salesUser);

    const res = await POST(
      req('/api/crm/prospects', {
        method: 'POST',
        body: JSON.stringify({ company_name: 'AB', email: 'inte-en-email' }),
      })
    );

    expect(res.status).toBe(400);
  });

  it('returnerar 400 vid trasig JSON', async () => {
    mockGetUser.mockResolvedValue(salesUser);

    const res = await POST(
      new Request('http://localhost/api/crm/prospects', {
        method: 'POST',
        body: 'inte json{{{',
      })
    );

    expect(res.status).toBe(400);
  });

  it('skapar prospekt och returnerar 201', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    const created = { id: 'p1', company_name: 'Acme AB' };
    mockCreate.mockResolvedValue({ data: created, error: null } as any);

    const res = await POST(
      req('/api/crm/prospects', {
        method: 'POST',
        body: JSON.stringify({ company_name: 'Acme AB' }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.item).toEqual(created);
  });

  it('sätter status till new, created_by och assigned_to', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockCreate.mockResolvedValue({ data: {}, error: null } as any);

    await POST(
      req('/api/crm/prospects', {
        method: 'POST',
        body: JSON.stringify({ company_name: 'AB' }),
      })
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'new',
        created_by: salesUser.id,
        assigned_to: salesUser.id,
      })
    );
  });

  it('returnerar 500 vid domänfel', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockCreate.mockResolvedValue({ data: null, error: { message: 'db error' } } as any);

    const res = await POST(
      req('/api/crm/prospects', {
        method: 'POST',
        body: JSON.stringify({ company_name: 'AB' }),
      })
    );

    expect(res.status).toBe(500);
    expect((await res.json()).errorDetails.code).toBe('crm_prospect_create_failed');
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/crm/prospects/[id]
// ---------------------------------------------------------------------------

describe('PATCH /api/crm/prospects/[id]', () => {
  const ctx = { params: { id: 'p1' } };

  it('returnerar 401 utan session', async () => {
    mockGetUser.mockResolvedValue(null);

    const res = await PATCH(
      req('/api/crm/prospects/p1', {
        method: 'PATCH',
        body: JSON.stringify({ company_name: 'AB' }),
      }),
      ctx
    );

    expect(res.status).toBe(401);
  });

  it('returnerar 400 med ogiltig status', async () => {
    mockGetUser.mockResolvedValue(salesUser);

    const res = await PATCH(
      req('/api/crm/prospects/p1', {
        method: 'PATCH',
        body: JSON.stringify({ company_name: 'AB', status: 'ogiltig' }),
      }),
      ctx
    );

    expect(res.status).toBe(400);
  });

  it('uppdaterar prospekt och returnerar 200', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    const updated = { id: 'p1', company_name: 'Uppdaterad AB', status: 'qualified' };
    mockUpdate.mockResolvedValue({ data: updated, error: null } as any);

    const res = await PATCH(
      req('/api/crm/prospects/p1', {
        method: 'PATCH',
        body: JSON.stringify({ company_name: 'Uppdaterad AB', status: 'qualified' }),
      }),
      ctx
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.item).toEqual(updated);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.anything(),
      'p1',
      expect.objectContaining({ status: 'qualified' })
    );
  });

  it('returnerar 500 vid domänfel', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockUpdate.mockResolvedValue({ data: null, error: { message: 'db error' } } as any);

    const res = await PATCH(
      req('/api/crm/prospects/p1', {
        method: 'PATCH',
        body: JSON.stringify({ company_name: 'AB' }),
      }),
      ctx
    );

    expect(res.status).toBe(500);
    expect((await res.json()).errorDetails.code).toBe('crm_prospect_update_failed');
  });
});
