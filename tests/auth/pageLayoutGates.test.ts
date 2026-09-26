import { describe, it, expect, vi, beforeEach } from 'vitest';

// Segmentlayouterna som gatar sidor på nycklar (RBAC 2b/2c). Varje layout ska fråga EXAKT sin nyckel
// innan barnen renderas. En borttagen layout eller fel nyckel syns inte i någon annan test — sidorna
// renderas aldrig i sviten — så den här tabellen är vakten.

const h = vi.hoisted(() => ({ asked: [] as string[] }));
vi.mock('@/lib/auth/pageGuards', () => ({
  requirePagePermission: vi.fn(async (key: string) => {
    h.asked.push(key);
  }),
}));

const LAYOUTS: Record<string, string> = {
  'mina-jobb': 'app.access',
  egenkontroll: 'app.access',
  'mina-dokument': 'app.access',
  nyheter: 'app.access',
  'material-kvalitet': 'app.access',
  'bestallning-klader': 'app.access',
  felanmalan: 'app.access',
  'dokument-information': 'app.access',
  // Samma nyckel som rutten sidan hämtar ifrån (/api/contacts respektive /api/storage/list-all).
  'kontakt-lista': 'app.contacts.read',
  archive: 'app.archive.read',
  // Hela CRM:et.
  crm: 'crm.access',
};

beforeEach(() => {
  h.asked = [];
});

describe.each(Object.entries(LAYOUTS))('app/%s/layout.tsx', (segment, key) => {
  it(`frågar ${key} innan barnen renderas`, async () => {
    const { default: Layout } = await import(`@/app/${segment}/layout.tsx`);
    const children = { marker: segment };
    const out = await Layout({ children });
    expect(h.asked).toEqual([key]);
    expect(JSON.stringify(out)).toContain(segment);
  });
});
