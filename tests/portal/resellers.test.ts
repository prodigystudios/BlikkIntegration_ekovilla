import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { adminUser, salesUser } from '../crm/helpers/supabase';
import { RESELLER_ID_PATTERN, setPortalFallbackUser, setResellerSeller, toPortalReseller } from '@/lib/domains/portal/resellers';

/**
 * Butikerna och reserven på portalsidan (fas 3a). Det som skyddas:
 *   - grinden före allt (401/403, ingen klient), och att den valda kan skriva arbetsordrar INNAN något sparas;
 *   - sparandet sätter updated_by till den inloggade och läser tillbaka raden: noll rader är "finns inte";
 *   - butikens id har portalens tecken, samma regel som migreringen;
 *   - sidans panel importerar bara typer ur domänen.
 */

const h = vi.hoisted(() => ({
  held: new Set<string>(),
  user: null as unknown,
  clients: 0,
  writers: new Set<string>(),
  writerChecks: [] as string[],
  updates: [] as { table: string; values: unknown; filters: [string, unknown][] }[],
  result: { data: {} as unknown, error: null as unknown },
}));

vi.mock('@/lib/auth/route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/route')>();
  return { ...actual, getCurrentUser: vi.fn(async () => h.user) };
});
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn(async () => h.held) };
});
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ((h.clients += 1), { kind: 'admin' })) }));
vi.mock('@/lib/domains/portal/assignment', () => ({
  userCanWriteWorkOrders: vi.fn(async (_admin: unknown, id: string) => (h.writerChecks.push(id), h.writers.has(id))),
}));
vi.mock('@/lib/supabase/session', () => ({
  createSessionClient: vi.fn(() => {
    h.clients += 1;
    return {
      from: (table: string) => {
        const update = { table, values: undefined as unknown, filters: [] as [string, unknown][] };
        const chain: any = {
          update: (values: unknown) => ((update.values = values), h.updates.push(update), chain),
          eq: (c: string, v: unknown) => (update.filters.push([c, v]), chain),
          select: () => chain,
          maybeSingle: async () => h.result,
        };
        return chain;
      },
    };
  }),
}));

const SELLER = '11111111-1111-4111-8111-111111111111';

async function putSeller(resellerId: string, body: unknown) {
  const { PUT } = await import('@/app/api/crm/portal/resellers/[resellerId]/route');
  const req = new Request(`http://localhost/api/crm/portal/resellers/${resellerId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return PUT(req, { params: { resellerId } });
}

async function putFallback(body: unknown) {
  const { PUT } = await import('@/app/api/crm/portal/settings/route');
  return PUT(
    new Request('http://localhost/api/crm/portal/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  h.held = new Set();
  h.user = null;
  h.clients = 0;
  h.writers = new Set([SELLER]);
  h.writerChecks = [];
  h.updates = [];
  h.result = { data: { seller_user_id: SELLER, fallback_user_id: SELLER }, error: null };
});

describe.each([
  ['PUT /api/crm/portal/resellers/[resellerId]', () => putSeller('res-norrbygg', { seller_user_id: SELLER })],
  ['PUT /api/crm/portal/settings', () => putFallback({ fallback_user_id: SELLER })],
])('%s: grinden', (_name, call) => {
  it('utan inloggning: 401 och ingen klient', async () => {
    expect((await call()).status).toBe(401);
    expect(h.clients).toBe(0);
  });

  it('utan crm.portal.manage: 403 och ingen klient', async () => {
    h.user = salesUser;
    h.held = new Set(['crm.access', 'crm.write', 'crm.workorder.write']);
    expect((await call()).status).toBe(403);
    expect(h.clients).toBe(0);
  });
});

describe('PUT /api/crm/portal/resellers/[resellerId]', () => {
  beforeEach(() => {
    h.user = adminUser;
    h.held = new Set(['crm.portal.manage']);
  });

  it('sparar säljaren i den inloggades namn, efter att ha prövat att säljaren kan skriva arbetsordrar', async () => {
    const res = await putSeller('res-norrbygg', { seller_user_id: SELLER });
    expect(res.status).toBe(200);
    expect(h.writerChecks).toEqual([SELLER]);
    expect(h.updates).toEqual([
      {
        table: 'crm_portal_resellers',
        values: { seller_user_id: SELLER, updated_by: adminUser.id },
        filters: [['reseller_id', 'res-norrbygg']],
      },
    ]);
  });

  it('en säljare som inte kan skriva arbetsordrar: 422, ingenting sparas', async () => {
    h.writers = new Set();
    expect((await putSeller('res-norrbygg', { seller_user_id: SELLER })).status).toBe(422);
    expect(h.updates).toEqual([]);
  });

  it('null = följ kedjan: ingen behörighetsfråga, sparas', async () => {
    h.result = { data: { seller_user_id: null }, error: null };
    expect((await putSeller('res-norrbygg', { seller_user_id: null })).status).toBe(200);
    expect(h.writerChecks).toEqual([]);
    expect(h.updates[0].values).toEqual({ seller_user_id: null, updated_by: adminUser.id });
  });

  it.each([
    ['blanksteg', 'res%20norrbygg'],
    ['snedstreck', 'res%2Fnorrbygg'],
    ['trasig procentkod', '%E0'],
    ['för långt', 'x'.repeat(101)],
  ])('ogiltigt butiks-id (%s): 400, ingenting sparas', async (_label, raw) => {
    expect((await putSeller(raw, { seller_user_id: SELLER })).status).toBe(400);
    expect(h.updates).toEqual([]);
  });

  it('ogiltig kropp: 400', async () => {
    for (const body of [{}, { seller_user_id: 'anna' }, { seller_user_id: 7 }]) {
      expect((await putSeller('res-norrbygg', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(h.updates).toEqual([]);
  });

  it('ingen rad tillbaka: butiken finns inte, 404', async () => {
    h.result = { data: null, error: null };
    expect((await putSeller('res-okand', { seller_user_id: SELLER })).status).toBe(404);
  });
});

describe('PUT /api/crm/portal/settings', () => {
  beforeEach(() => {
    h.user = adminUser;
    h.held = new Set(['crm.portal.manage']);
  });

  it('sparar reserven i den inloggades namn', async () => {
    expect((await putFallback({ fallback_user_id: SELLER })).status).toBe(200);
    expect(h.updates).toEqual([
      { table: 'crm_portal_settings', values: { fallback_user_id: SELLER, updated_by: adminUser.id }, filters: [['id', true]] },
    ]);
  });

  it('en reserv som inte kan skriva arbetsordrar: 422, ingenting sparas', async () => {
    h.writers = new Set();
    expect((await putFallback({ fallback_user_id: SELLER })).status).toBe(422);
    expect(h.updates).toEqual([]);
  });

  it('ingen reserv (null) går att spara', async () => {
    h.result = { data: { fallback_user_id: null }, error: null };
    expect((await putFallback({ fallback_user_id: null })).status).toBe(200);
  });
});

describe('lagret', () => {
  function session(result: { data: unknown; error: unknown }) {
    const chain: any = { update: () => chain, eq: () => chain, select: () => chain, maybeSingle: async () => result };
    return { from: () => chain } as never;
  }

  it('noll rader är "finns inte", 42501 är "nekad", 23503 är en okänd användare', async () => {
    expect(await setResellerSeller(session({ data: null, error: null }), 'r', null, 'u')).toEqual({ kind: 'not_found' });
    expect(await setPortalFallbackUser(session({ data: null, error: { code: '42501', message: 'x' } }), null, 'u')).toEqual({ kind: 'forbidden' });
    expect(await setResellerSeller(session({ data: null, error: { code: '23503', message: 'fk' } }), 'r', SELLER, 'u')).toEqual({
      kind: 'db_error',
      message: 'Användaren finns inte.',
    });
  });

  it('kundkortets namn: företag, privatperson, eller inget när kortet inte syns', () => {
    const base = {
      reseller_id: 'r',
      name: 'Norrbygg AB',
      street: '',
      postal_code: '',
      city: '',
      customer_number: '1043',
      customer_id: 'c',
      seller_user_id: null,
      first_seen_at: 't',
      last_seen_at: 't',
    };
    expect(toPortalReseller({ ...base, customer: { customer_type: 'business', company_name: 'Norrbygg AB', first_name: null, last_name: null } }).customerName).toBe('Norrbygg AB');
    expect(toPortalReseller({ ...base, customer: { customer_type: 'private', company_name: null, first_name: 'Eva', last_name: 'Ek' } }).customerName).toBe('Eva Ek');
    expect(toPortalReseller({ ...base, customer: null }).customerName).toBeNull();
  });

  it('butikens id: portalens tecken, samma som migreringens check', () => {
    for (const ok of ['res-norrbygg', 'b7c1e0e4-2f3a-4c55-9d7e-1a2b3c4d5e6f', 'a.b_c~d']) expect(RESELLER_ID_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ['', 'res norrbygg', 'res/norr', 'rés', 'x'.repeat(101)]) expect(RESELLER_ID_PATTERN.test(bad), bad).toBe(false);
    const sql = readFileSync('supabase/migrations/20260928082554_portal_resellers.sql', 'utf8');
    expect(sql).toContain(`check (reseller_id ~ '${RESELLER_ID_PATTERN.source}')`);
  });
});

describe('webbläsarens del', () => {
  it('ResellersPanel importerar bara typer ur domänen (kundmodulen ska inte till webbläsaren)', () => {
    const source = readFileSync('app/crm/installningar/aterforsaljarportalen/ResellersPanel.tsx', 'utf8');
    const imports = [...source.matchAll(/\bimport\s+(type\s+)?([^;]*?)\s+from\s+['"]([^'"]+)['"]/g)].map((m) => ({ typeOnly: Boolean(m[1]), from: m[3] }));
    const domain = imports.filter((i) => i.from.startsWith('@/lib/domains/'));
    expect(domain.map((i) => i.from)).toEqual(['@/lib/domains/portal/resellers']);
    expect(domain.filter((i) => !i.typeOnly)).toEqual([]);
    expect(source).not.toMatch(/\bimport\s*\(?\s*['"]@\/lib\/domains\//);
  });
});
