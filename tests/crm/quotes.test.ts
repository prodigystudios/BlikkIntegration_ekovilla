import { describe, it, expect, vi, beforeEach } from 'vitest';
import { salesUser, adminUser, memberUser } from './helpers/supabase';

// ---------------------------------------------------------------------------
// Mockar
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/route', () => ({ getCurrentUser: vi.fn() }));

vi.mock('@/lib/domains/crm/quotes', () => ({
  listCrmQuotesWithFilters: vi.fn(),
  createCrmQuote: vi.fn(),
  getCrmQuote: vi.fn(),
  updateCrmQuote: vi.fn(),
  markCrmQuoteWon: vi.fn(),
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
  listCrmQuotesWithFilters,
  createCrmQuote,
  getCrmQuote,
  updateCrmQuote,
  markCrmQuoteWon,
} from '@/lib/domains/crm/quotes';
import { createCrmQuoteSchema, listCrmQuotesQuerySchema } from '@/app/api/crm/quotes/_lib';

const { GET: collectionGET, POST } = await import('@/app/api/crm/quotes/route');
const { GET: itemGET, PATCH } = await import('@/app/api/crm/quotes/[id]/route');

const mockGetUser = vi.mocked(getCurrentUser);
const mockList = vi.mocked(listCrmQuotesWithFilters);
const mockCreate = vi.mocked(createCrmQuote);
const mockGet = vi.mocked(getCrmQuote);
const mockUpdate = vi.mocked(updateCrmQuote);
const mockMarkWon = vi.mocked(markCrmQuoteWon);

beforeEach(() => vi.clearAllMocks());

function req(url: string, init?: RequestInit) {
  return new Request(`http://localhost${url}`, init);
}

// Minimal giltig offert-payload
const validQuoteBase = {
  project_name: 'Takisolering Storgatan',
  amount: 45000,
  quote_date: '2026-06-04',
  customer_name: 'Test AB',
  customer_snapshot: { company_name: 'Test AB' },
};

// ---------------------------------------------------------------------------
// Schema — createCrmQuoteSchema
// ---------------------------------------------------------------------------

describe('createCrmQuoteSchema', () => {
  it('godkänner minimal giltig offert', () => {
    expect(createCrmQuoteSchema.safeParse(validQuoteBase).success).toBe(true);
  });

  it('misslyckas utan project_name', () => {
    const { project_name: _, ...rest } = validQuoteBase;
    expect(createCrmQuoteSchema.safeParse(rest).success).toBe(false);
  });

  it('misslyckas utan amount', () => {
    const { amount: _, ...rest } = validQuoteBase;
    expect(createCrmQuoteSchema.safeParse(rest).success).toBe(false);
  });

  it('misslyckas utan quote_date', () => {
    const { quote_date: _, ...rest } = validQuoteBase;
    expect(createCrmQuoteSchema.safeParse(rest).success).toBe(false);
  });

  it('misslyckas utan prospect_id, opportunity_id eller customer_name', () => {
    const { customer_name: _, ...rest } = validQuoteBase;
    expect(
      createCrmQuoteSchema.safeParse({ ...rest, customer_snapshot: {} }).success
    ).toBe(false);
  });

  it('misslyckas med ogiltigt datumformat i quote_date', () => {
    expect(
      createCrmQuoteSchema.safeParse({ ...validQuoteBase, quote_date: '04-06-2026' }).success
    ).toBe(false);
  });

  it('godkänner offert kopplad till prospect_id utan customer_name (men med company_name i snapshot)', () => {
    // quote_type är 'business' som default → kräver customer_name ELLER customer_snapshot.company_name
    const { customer_name: _, ...rest } = validQuoteBase;
    expect(
      createCrmQuoteSchema.safeParse({
        ...rest,
        prospect_id: '123e4567-e89b-12d3-a456-426614174000',
        customer_snapshot: { company_name: 'Prospektföretag AB' },
      }).success
    ).toBe(true);
  });

  it('misslyckas om business-offert saknar både customer_name och snapshot.company_name', () => {
    // Första refine-check passerar (prospect_id finns), men tredje check misslyckas
    const { customer_name: _, ...rest } = validQuoteBase;
    expect(
      createCrmQuoteSchema.safeParse({
        ...rest,
        prospect_id: '123e4567-e89b-12d3-a456-426614174000',
        customer_snapshot: {},
      }).success
    ).toBe(false);
  });

  it('misslyckas med ROT aktiverat för företagskund', () => {
    expect(
      createCrmQuoteSchema.safeParse({
        ...validQuoteBase,
        quote_type: 'business',
        rot_details: { enabled: true },
      }).success
    ).toBe(false);
  });

  it('misslyckas med ROT aktiverat utan personnummer', () => {
    expect(
      createCrmQuoteSchema.safeParse({
        ...validQuoteBase,
        quote_type: 'private',
        customer_snapshot: { personal_number: '19801231-1234' },
        rot_details: { enabled: true },
        // saknar rot_details.personal_number
      }).success
    ).toBe(false);
  });

  it('godkänner privatkund med ROT när personnummer finns', () => {
    expect(
      createCrmQuoteSchema.safeParse({
        ...validQuoteBase,
        quote_type: 'private',
        customer_snapshot: { personal_number: '19801231-1234' },
        rot_details: { enabled: true, personal_number: '19801231-1234' },
      }).success
    ).toBe(true);
  });

  it('godkänner negativt belopp ej — amount måste vara >= 0', () => {
    expect(
      createCrmQuoteSchema.safeParse({ ...validQuoteBase, amount: -100 }).success
    ).toBe(false);
  });

  it('sätter default status till draft', () => {
    const result = createCrmQuoteSchema.safeParse(validQuoteBase);
    expect(result.success && result.data.status).toBe('draft');
  });

  it('sätter default currency_code till SEK', () => {
    const result = createCrmQuoteSchema.safeParse(validQuoteBase);
    expect(result.success && result.data.currency_code).toBe('SEK');
  });

  it('behåller customer_id (kund-länken får inte strippas)', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const result = createCrmQuoteSchema.safeParse({ ...validQuoteBase, customer_id: id });
    expect(result.success && result.data.customer_id).toBe(id);
  });

  it('defaultar customer_id till null när den saknas', () => {
    const result = createCrmQuoteSchema.safeParse(validQuoteBase);
    expect(result.success && result.data.customer_id).toBeNull();
  });
});

describe('listCrmQuotesQuerySchema', () => {
  it('godkänner tom query', () => {
    expect(listCrmQuotesQuerySchema.safeParse({}).success).toBe(true);
  });

  it('misslyckas med ogiltigt status', () => {
    expect(listCrmQuotesQuerySchema.safeParse({ status: 'unknown' }).success).toBe(false);
  });

  it('godkänner giltiga filter', () => {
    expect(
      listCrmQuotesQuerySchema.safeParse({ status: 'draft', q: 'tak' }).success
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/crm/quotes — auth
// ---------------------------------------------------------------------------

describe('GET /api/crm/quotes — auth', () => {
  it('returnerar 401 utan session', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await collectionGET(req('/api/crm/quotes'))).status).toBe(401);
  });

  it('returnerar 403 för member', async () => {
    mockGetUser.mockResolvedValue(memberUser);
    expect((await collectionGET(req('/api/crm/quotes'))).status).toBe(403);
  });

  it('tillåter sales', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    // listCrmQuotesWithFilters returnerar en query som sedan awaitas i routen
    mockList.mockResolvedValue({ data: [], error: null } as any);
    expect((await collectionGET(req('/api/crm/quotes'))).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/crm/quotes — svar
// ---------------------------------------------------------------------------

describe('GET /api/crm/quotes — svar', () => {
  it('returnerar items-array', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    const data = [{ id: 'q1', project_name: 'Test' }];
    mockList.mockResolvedValue({ data, error: null } as any);

    const body = await (await collectionGET(req('/api/crm/quotes'))).json();

    expect(body.ok).toBe(true);
    expect(body.data.items).toEqual(data);
  });

  it('returnerar 500 vid domänfel', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockList.mockResolvedValue({ data: null, error: { message: 'db error' } } as any);

    const res = await collectionGET(req('/api/crm/quotes'));

    expect(res.status).toBe(500);
    expect((await res.json()).errorDetails.code).toBe('crm_quotes_list_failed');
  });
});

// ---------------------------------------------------------------------------
// POST /api/crm/quotes — validering och framgång
// ---------------------------------------------------------------------------

describe('POST /api/crm/quotes', () => {
  it('returnerar 400 utan project_name', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    const { project_name: _, ...rest } = validQuoteBase;

    const res = await POST(
      req('/api/crm/quotes', { method: 'POST', body: JSON.stringify(rest) })
    );

    expect(res.status).toBe(400);
  });

  it('returnerar 400 utan customer_name / prospect / opportunity', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    const { customer_name: _, ...rest } = validQuoteBase;

    const res = await POST(
      req('/api/crm/quotes', {
        method: 'POST',
        body: JSON.stringify({ ...rest, customer_snapshot: {} }),
      })
    );

    expect(res.status).toBe(400);
  });

  it('skapar offert och returnerar 201', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    const created = { id: 'q1', ...validQuoteBase };
    mockCreate.mockResolvedValue({ data: created, error: null } as any);

    const res = await POST(
      req('/api/crm/quotes', { method: 'POST', body: JSON.stringify(validQuoteBase) })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.item).toEqual(created);
  });

  it('sätter created_by och assigned_to till inloggad användare', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockCreate.mockResolvedValue({ data: {}, error: null } as any);

    await POST(
      req('/api/crm/quotes', { method: 'POST', body: JSON.stringify(validQuoteBase) })
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ created_by: salesUser.id, assigned_to: salesUser.id })
    );
  });

  it('sätter default currency_code till SEK om saknas', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockCreate.mockResolvedValue({ data: {}, error: null } as any);

    await POST(
      req('/api/crm/quotes', { method: 'POST', body: JSON.stringify(validQuoteBase) })
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ currency_code: 'SEK' })
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/crm/quotes/[id]
// ---------------------------------------------------------------------------

describe('GET /api/crm/quotes/[id]', () => {
  const ctx = { params: { id: 'q1' } };

  it('returnerar 401 utan session', async () => {
    mockGetUser.mockResolvedValue(null);
    expect((await itemGET(req('/api/crm/quotes/q1'), ctx)).status).toBe(401);
  });

  it('returnerar offert vid framgång', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockGet.mockResolvedValue({ data: { id: 'q1' }, error: null } as any);

    const body = await (await itemGET(req('/api/crm/quotes/q1'), ctx)).json();

    expect(body.ok).toBe(true);
    expect(body.data.item.id).toBe('q1');
    expect(mockGet).toHaveBeenCalledWith(expect.anything(), 'q1');
  });

  it('returnerar 404 vid saknat objekt', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockGet.mockResolvedValue({ data: null, error: { message: 'not found' } } as any);

    expect((await itemGET(req('/api/crm/quotes/q1'), ctx)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/crm/quotes/[id] — normal uppdatering
// ---------------------------------------------------------------------------

describe('PATCH /api/crm/quotes/[id]', () => {
  const ctx = { params: { id: 'q1' } };

  const validUpdate = {
    ...validQuoteBase,
    status: 'sent',
  };

  it('returnerar 401 utan session', async () => {
    mockGetUser.mockResolvedValue(null);
    const res = await PATCH(
      req('/api/crm/quotes/q1', { method: 'PATCH', body: JSON.stringify(validUpdate) }),
      ctx
    );
    expect(res.status).toBe(401);
  });

  it('returnerar 400 vid ogiltig body', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    const res = await PATCH(
      req('/api/crm/quotes/q1', { method: 'PATCH', body: JSON.stringify({ status: 'sent' }) }),
      ctx
    );
    expect(res.status).toBe(400);
  });

  it('uppdaterar offert och returnerar 200', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    const updated = { id: 'q1', status: 'sent' };
    mockUpdate.mockResolvedValue({ data: updated, error: null } as any);

    const res = await PATCH(
      req('/api/crm/quotes/q1', { method: 'PATCH', body: JSON.stringify(validUpdate) }),
      ctx
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.item).toEqual(updated);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.anything(),
      'q1',
      expect.objectContaining({ status: 'sent' })
    );
  });

  // Regression: a partial PATCH (e.g. the list's status-change quick action) must not
  // overwrite untouched columns with schema-injected defaults. Only the fields actually
  // present in the request body may reach updateCrmQuote.
  it('skriver inte fält som inte skickades (partial PATCH nollar inte offerten)', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockUpdate.mockResolvedValue({ data: { id: 'q1' }, error: null } as any);

    // Speglar status-bytet i listan: en delmängd skickas, UTAN
    // internal_handoff / line_items / rot_details / customer_id.
    await PATCH(
      req('/api/crm/quotes/q1', { method: 'PATCH', body: JSON.stringify({ ...validQuoteBase, status: 'sent' }) }),
      ctx
    );

    const passedInput = mockUpdate.mock.calls[0][2];
    expect(passedInput).not.toHaveProperty('internal_handoff');
    expect(passedInput).not.toHaveProperty('line_items');
    expect(passedInput).not.toHaveProperty('rot_details');
    expect(passedInput).not.toHaveProperty('customer_id');
    expect(passedInput).toHaveProperty('status', 'sent');
    expect(passedInput).toHaveProperty('project_name');
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/crm/quotes/[id] — status=won → markCrmQuoteWon
// ---------------------------------------------------------------------------

describe('PATCH /api/crm/quotes/[id] — status won', () => {
  const ctx = { params: { id: 'q1' } };
  const wonUpdate = { ...validQuoteBase, status: 'won' };

  it('anropar markCrmQuoteWon istället för updateCrmQuote', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockMarkWon.mockResolvedValue({ data: { id: 'q1' }, error: null } as any);

    await PATCH(
      req('/api/crm/quotes/q1', { method: 'PATCH', body: JSON.stringify(wonUpdate) }),
      ctx
    );

    expect(mockMarkWon).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returnerar 200 när won lyckas', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockMarkWon.mockResolvedValue({ data: { id: 'q1', status: 'won' }, error: null } as any);

    const res = await PATCH(
      req('/api/crm/quotes/q1', { method: 'PATCH', body: JSON.stringify(wonUpdate) }),
      ctx
    );

    expect(res.status).toBe(200);
  });

  it('returnerar 500 när markCrmQuoteWon misslyckas', async () => {
    mockGetUser.mockResolvedValue(salesUser);
    mockMarkWon.mockResolvedValue({
      data: null,
      error: { code: 'crm_quote_won_failed', message: 'could not convert' },
    } as any);

    const res = await PATCH(
      req('/api/crm/quotes/q1', { method: 'PATCH', body: JSON.stringify(wonUpdate) }),
      ctx
    );

    expect(res.status).toBe(500);
    expect((await res.json()).errorDetails.code).toBe('crm_quote_won_failed');
  });
});
