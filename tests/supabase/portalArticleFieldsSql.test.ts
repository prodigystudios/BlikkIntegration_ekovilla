import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PORTAL_ARTICLE_CATEGORIES,
  PORTAL_CUSTOMER_NAME_MAX,
  PORTAL_NOTE_MAX,
  hasAtMostThreeDecimals,
} from '@/lib/domains/portal/articleFields';

/**
 * Portalfälten per artikel (20260928064437_portal_article_fields.sql). Reglerna bor i SQL som typsystemet inte når,
 * så testet läser filen:
 *   - bara crm.article.manage når tabellen, och sessionen får aldrig delete (redigeringen tar inte bort);
 *   - databasens regler och domänens (lib/domains/portal/articleFields.ts) är samma regler: kategorierna, längderna;
 *   - ifyllnaden är de 51 artiklarna portalen visar i dag, alla giltiga och publicerbara.
 * Beteendet (RLS med riktiga sessioner, reglerna på raden) prövas mot en databas med
 * supabase/checks/portal_article_fields.sql.
 */

const FILE = resolve(process.cwd(), 'supabase/migrations/20260928064437_portal_article_fields.sql');
const RAW = readFileSync(FILE, 'utf8');

// Kommentarerna bort: huvudet FÖRKLARAR reglerna.
const sql = RAW.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase();

const TABLE = 'public.crm_portal_article_fields';

/** Ifyllnadens rader: ('nr', 'kundnamn', 'kategori', andel, ordning). */
function seedRows() {
  const values = RAW.slice(RAW.indexOf('from (values'), RAW.indexOf(') as v('));
  return [...values.matchAll(/^\s*\('([^']+)',\s*'([^']*)',\s*'([^']*)',\s*([\d.]+),\s*(\d+)\)/gm)].map((m) => ({
    articleNumber: m[1],
    customerName: m[2],
    category: m[3],
    laborShare: Number(m[4]),
    sortOrder: Number(m[5]),
  }));
}

describe('portalfälten (SQL)', () => {
  it('RLS är på; anon får ingenting, authenticated select, insert och update, service_role allt', () => {
    expect(sql).toContain(`alter table ${TABLE} enable row level security;`);
    expect(sql).toContain(`revoke all on table ${TABLE} from anon, authenticated;`);
    expect(sql).toContain(`grant select, insert, update on table ${TABLE} to authenticated;`);
    expect(sql).toContain(`grant select, insert, update, delete on table ${TABLE} to service_role;`);
  });

  it('ingen grant till anon eller public, och ingen delete eller truncate till authenticated', () => {
    const grants = [...sql.matchAll(/grant ([^;]*?) on [^;]* to ([^;]+);/g)];
    expect(grants.length).toBeGreaterThan(0);
    for (const [, privileges, grantees] of grants) {
      expect(grantees).not.toMatch(/\b(anon|public)\b/);
      if (/\bauthenticated\b/.test(grantees)) expect(privileges).not.toMatch(/\b(delete|truncate|all)\b/);
    }
  });

  it('varje policy gäller authenticated och frågar efter crm.article.manage, och det finns ingen delete-policy', () => {
    const policies = [...sql.matchAll(/create policy (\S+) on public\.crm_portal_article_fields ([^;]*);/g)];
    expect(policies.map((p) => p[1]).sort()).toEqual([
      'crm_portal_article_fields_insert',
      'crm_portal_article_fields_select',
      'crm_portal_article_fields_update',
    ]);
    for (const [, name, body] of policies) {
      // Exakt authenticated: inte "authenticated, anon" och inte public.
      expect(body.match(/\bto (.+?) (?:using|with check)\b/)?.[1], name).toBe('authenticated');
      const keys = [...body.matchAll(/has_permission\('([^']*)'\)/g)].map((m) => m[1]);
      expect(keys.length, name).toBeGreaterThan(0);
      expect(new Set(keys), name).toEqual(new Set(['crm.article.manage']));
    }
    expect(sql).not.toMatch(/for (delete|all)\b/);
  });

  it('kategorierna i databasen är domänens, i samma ordning', () => {
    const check = sql.match(/category is null or category in \(([^)]*)\)/);
    expect(check).not.toBeNull();
    const inSql = [...check![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(inSql).toEqual([...PORTAL_ARTICLE_CATEGORIES]);
  });

  it('längderna i databasen är domänens', () => {
    expect(sql).toContain(`char_length(customer_name) <= ${PORTAL_CUSTOMER_NAME_MAX}`);
    expect(sql).toContain(`char_length(note) <= ${PORTAL_NOTE_MAX}`);
    expect(sql).toContain('char_length(article_number) between 1 and 50');
  });

  it('arbetsandelen lagras som portalens kolumn: numeric(4,3), 0–1', () => {
    expect(sql).toContain('labor_share numeric(4,3) not null default 0');
    expect(sql).toContain('check (labor_share between 0 and 1)');
  });

  it('en publicerad artikel kräver kundnamn och kategori', () => {
    expect(sql).toContain("check ( not publish or (customer_name <> '' and category is not null) )");
  });

  it('updated_at sätts av en trigger, updated_by följer en borttagen profil', () => {
    expect(sql).toContain(`before update on ${TABLE} for each row execute function public.set_updated_at();`);
    expect(sql).toContain('foreign key (updated_by) references public.profiles(id) on delete set null');
  });

  it('ifyllnaden skriver aldrig över det någon ändrat', () => {
    expect(sql).toContain('on conflict (article_number) do nothing;');
  });
});

describe('ifyllnaden: portalens 51 artiklar', () => {
  const rows = seedRows();

  it('51 rader med unika artikelnummer och unika platser, 10 … 510 i portalens ordning', () => {
    expect(rows).toHaveLength(51);
    expect(new Set(rows.map((r) => r.articleNumber)).size).toBe(51);
    expect(rows.map((r) => r.sortOrder)).toEqual(rows.map((_, i) => (i + 1) * 10));
  });

  it('varje rad är giltig och publicerbar: kundnamn, känd kategori, andel 0–1 med högst tre decimaler', () => {
    for (const r of rows) {
      expect(r.customerName.trim(), r.articleNumber).toBe(r.customerName);
      expect(r.customerName.length, r.articleNumber).toBeGreaterThan(0);
      expect(r.customerName.length, r.articleNumber).toBeLessThanOrEqual(PORTAL_CUSTOMER_NAME_MAX);
      expect(PORTAL_ARTICLE_CATEGORIES, r.articleNumber).toContain(r.category);
      expect(r.laborShare, r.articleNumber).toBeGreaterThanOrEqual(0);
      expect(r.laborShare, r.articleNumber).toBeLessThanOrEqual(1);
      expect(hasAtMostThreeDecimals(r.laborShare), r.articleNumber).toBe(true);
    }
  });

  it('alla publiceras', () => {
    expect(sql).toMatch(/select v\.article_number, v\.customer_name, v\.category, v\.labor_share, v\.sort_order, true from \(values/);
  });

  it('bara inblåst lösull har arbete (portalens antagande: 0,45 på vinden, 0,5 annars)', () => {
    const withLabor = rows.filter((r) => r.laborShare > 0);
    expect(withLabor).toHaveLength(14);
    for (const r of withLabor) expect(r.category, r.articleNumber).toBe('losull');
    expect(withLabor.filter((r) => r.laborShare === 0.45).map((r) => r.articleNumber)).toEqual(['2410509', '1095']);
  });

  it('inga astrala tecken i filen (de kapar `--` i SQL-editorn och i en del verktyg)', () => {
    expect([...RAW].filter((c) => c.codePointAt(0)! > 0xffff)).toEqual([]);
  });
});
