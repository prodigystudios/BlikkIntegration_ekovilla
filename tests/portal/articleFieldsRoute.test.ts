import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, salesUser } from '../crm/helpers/supabase';

/**
 * PUT /api/crm/portal/article-fields/[articleNumber] (fas 2a). Grinden före allt annat: utan inloggning 401, utan
 * crm.article.manage 403, och i båda fallen har ingen databasklient byggts. Sedan artikelnumret och kroppen (400),
 * och sist sparandet med sessionen, där RLS är den verkliga grinden.
 */

const h = vi.hoisted(() => ({
  held: new Set<string>(),
  user: null as unknown,
  clientCalls: 0,
  result: { data: null as unknown, error: null as unknown },
  upserts: [] as unknown[],
}));

vi.mock('@/lib/auth/route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/route')>();
  return { ...actual, getCurrentUser: vi.fn(async () => h.user) };
});
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn(async () => h.held) };
});
vi.mock('@/lib/supabase/session', () => ({
  createSessionClient: vi.fn(() => {
    h.clientCalls += 1;
    const chain = {
      upsert: vi.fn((row: unknown) => {
        h.upserts.push(row);
        return chain;
      }),
      select: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => h.result),
    };
    return { from: vi.fn(() => chain) };
  }),
}));

const BODY = {
  customer_name: 'Lösull på vinden',
  category: 'losull',
  labor_share: 0.45,
  note: '',
  sort_order: 10,
  publish: true,
};

async function put(articleNumber: string, body: unknown = BODY) {
  const { PUT } = await import('@/app/api/crm/portal/article-fields/[articleNumber]/route');
  const req = new Request(`http://localhost/api/crm/portal/article-fields/${articleNumber}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return PUT(req, { params: { articleNumber } });
}

beforeEach(() => {
  h.held = new Set();
  h.user = null;
  h.clientCalls = 0;
  h.result = { data: null, error: null };
  h.upserts = [];
});

describe('PUT /api/crm/portal/article-fields/[articleNumber]', () => {
  it('utan inloggning: 401 och ingen klient', async () => {
    const res = await put('2410509');
    expect(res.status).toBe(401);
    expect(h.clientCalls).toBe(0);
  });

  it('utan crm.article.manage (säljaren): 403 och ingen klient', async () => {
    h.user = salesUser;
    h.held = new Set(['crm.access', 'crm.write']);
    const res = await put('2410509');
    expect(res.status).toBe(403);
    expect(h.clientCalls).toBe(0);
  });

  describe('med crm.article.manage', () => {
    beforeEach(() => {
      h.user = adminUser;
      h.held = new Set(['crm.article.manage']);
    });

    it('sparar med den inloggades id och svarar med raden', async () => {
      h.result = { data: { article_number: '2410509', ...BODY, labor_share: '0.450', updated_at: 'x' }, error: null };
      const res = await put('2410509');
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.fields.labor_share).toBe(0.45);
      expect(h.upserts).toEqual([{ article_number: '2410509', ...BODY, updated_by: adminUser.id }]);
    });

    it('artikelnumret avkodas ur adressen', async () => {
      h.result = { data: { article_number: 'A B', ...BODY }, error: null };
      expect((await put('A%20B')).status).toBe(200);
      expect(h.upserts).toEqual([expect.objectContaining({ article_number: 'A B' })]);
    });

    it.each([
      ['blanksteg runt', '%202410509'],
      ['trasig procentkod', '%E0'],
      ['för långt', 'x'.repeat(51)],
    ])('ogiltigt artikelnummer (%s): 400 och ingen klient', async (_label, raw) => {
      const res = await put(raw);
      expect(res.status).toBe(400);
      expect(h.clientCalls).toBe(0);
    });

    it('ogiltig kropp: 400 och ingen klient', async () => {
      for (const body of ['inte json', { ...BODY, customer_name: '' }, { ...BODY, labor_share: 0.4555 }]) {
        const res = await put('2410509', body);
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
      expect(h.clientCalls).toBe(0);
    });

    it('RLS stoppar (42501 eller ingen rad tillbaka): 403', async () => {
      h.result = { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
      expect((await put('2410509')).status).toBe(403);
      h.result = { data: null, error: null };
      expect((await put('2410509')).status).toBe(403);
    });

    it('en regel i databasen (23514): 400; annat databasfel: 500', async () => {
      h.result = { data: null, error: { code: '23514', message: 'check' } };
      expect((await put('2410509')).status).toBe(400);
      h.result = { data: null, error: { code: 'XX000', message: 'boom' } };
      expect((await put('2410509')).status).toBe(500);
    });
  });
});
