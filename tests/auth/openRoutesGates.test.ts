import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { memberUser } from '../crm/helpers/supabase';

/**
 * Rutterna som förr bara krävde "inloggad" och sedan läste med service-role — förbi RLS, alltså utan
 * någon andra försvarslinje (RBAC steg 2c). För varje rutt:
 *   - utan nyckeln: 403, och INGEN klient har byggts — ingen dataåtkomst före grinden;
 *   - med nyckeln: grinden släpper igenom till dataåtkomsten;
 *   - utan inloggning: 401.
 *
 * Klienterna ersätts med en stubbe som kastar vid första användning, så en rutt som når datan med
 * nyckeln slutar i sin egen felhantering. Det som prövas är ORDNINGEN: grind först, data sen.
 */

const h = vi.hoisted(() => ({ held: new Set<string>(), user: null as unknown, clientCalls: 0 }));

function stubClient() {
  h.clientCalls += 1;
  return new Proxy({}, { get: () => { throw new Error('dataåtkomst'); } });
}

vi.mock('@/lib/auth/route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/route')>();
  return { ...actual, getCurrentUser: vi.fn(async () => h.user) };
});
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn(async () => h.held) };
});
vi.mock('@/lib/supabase/server', () => ({
  getSupabaseAdmin: vi.fn(stubClient),
  getOptionalSupabaseAdmin: vi.fn(stubClient),
}));
vi.mock('@/lib/supabase/session', () => ({ createSessionClient: vi.fn(stubClient) }));
vi.mock('@/lib/phoneListStorage', () => ({ loadPhoneListDocument: vi.fn(async () => stubClient()) }));
vi.mock('next/cache', () => ({ unstable_noStore: vi.fn(), revalidateTag: vi.fn() }));

const get = (path: string) => new NextRequest(`http://localhost${path}`);
const post = (path: string) =>
  new NextRequest(`http://localhost${path}`, { method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json' } });

const ROUTES: { name: string; key: string; call: () => Promise<Response> }[] = [
  {
    name: 'GET /api/storage/list-all',
    key: 'app.archive.read',
    call: async () => (await import('@/app/api/storage/list-all/route')).GET(get('/api/storage/list-all')),
  },
  {
    name: 'GET /api/storage/list',
    key: 'app.archive.read',
    call: async () => (await import('@/app/api/storage/list/route')).GET(get('/api/storage/list')),
  },
  {
    name: 'GET /api/storage/download',
    key: 'app.archive.read',
    call: async () =>
      (await import('@/app/api/storage/download/route')).GET(get('/api/storage/download?path=Egenkontroller/a.pdf')),
  },
  {
    name: 'POST /api/storage/save',
    key: 'app.access',
    call: async () => (await import('@/app/api/storage/save/route')).POST(post('/api/storage/save')),
  },
  {
    name: 'GET /api/material-quality/list',
    key: 'app.access',
    call: async () => (await import('@/app/api/material-quality/list/route')).GET(get('/api/material-quality/list')),
  },
  {
    name: 'POST /api/material-quality/ingest',
    key: 'app.access',
    call: async () =>
      (await import('@/app/api/material-quality/ingest/route')).POST(post('/api/material-quality/ingest')),
  },
  {
    name: 'GET /api/contacts',
    key: 'app.contacts.read',
    call: async () => (await import('@/app/api/contacts/route')).GET(),
  },
  {
    name: 'GET /api/phone-list',
    key: 'app.contacts.read',
    call: async () => (await import('@/app/api/phone-list/route')).GET(),
  },
  {
    name: 'GET /api/planning/truck-assignments',
    key: 'planning.schedule.read',
    call: async () =>
      (await import('@/app/api/planning/truck-assignments/route')).GET(
        new Request('http://localhost/api/planning/truck-assignments?from=2026-09-01&to=2026-09-30'),
      ),
  },
];

beforeEach(() => {
  h.held = new Set();
  h.user = memberUser;
  h.clientCalls = 0;
});

describe.each(ROUTES)('$name', ({ key, call }) => {
  it(`nekar utan ${key} — innan någon klient byggs`, async () => {
    h.held = new Set(['crm.access', 'time.entry.write']);
    const res = await call();
    expect(res.status).toBe(403);
    expect(h.clientCalls).toBe(0);
  });

  it(`släpper igenom med ${key}`, async () => {
    h.held = new Set([key]);
    // Stubben kastar vid första användning; rutter utan egen try/catch låter kastet bubbla. Det är
    // förväntat — det som prövas är att grinden släppte igenom till dataåtkomsten.
    await call().catch(() => undefined);
    expect(h.clientCalls).toBeGreaterThan(0);
  });

  it('401 utan inloggning', async () => {
    h.user = null;
    const res = await call();
    expect(res.status).toBe(401);
    expect(h.clientCalls).toBe(0);
  });
});

// Nedladdningen släpper också igenom den som läser arbetsordrar: egenkontrollens länk står på orderns
// säckkort och i kommentarerna, och lönebyrån (ekonomi) läser ordrarna utan att ha arkivet. Listan
// gör det INTE — hon får hämta filen hon fått länken till, inte bläddra i hela arkivet.
describe('arkivets nedladdning vs listning', () => {
  const download = ROUTES.find((r) => r.name === 'GET /api/storage/download')!;
  const listAll = ROUTES.find((r) => r.name === 'GET /api/storage/list-all')!;

  it('nedladdningen släpper igenom med bara crm.workorder.read', async () => {
    h.held = new Set(['crm.workorder.read']);
    await download.call().catch(() => undefined);
    expect(h.clientCalls).toBeGreaterThan(0);
  });

  it('listningen nekar med bara crm.workorder.read', async () => {
    h.held = new Set(['crm.workorder.read']);
    expect((await listAll.call()).status).toBe(403);
    expect(h.clientCalls).toBe(0);
  });
});
