import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pricelistIdempotencyKey } from '@/lib/domains/portal/pricelist';

/**
 * Prislistans migrering (20260928072725_portal_pricelist_publications.sql). Reglerna bor i SQL som typsystemet inte
 * når, så testet läser filen:
 *   - crm.portal.manage finns och bara admin har den;
 *   - publiceringarna är historik: sessionen får select och insert, aldrig update eller delete;
 *   - kön får en LÄSpolicy, och sessionen får aldrig skriva i den (över hela kedjan av migreringar);
 *   - nyckelns form i databasen är den koden bygger.
 */

const FILE = resolve(process.cwd(), 'supabase/migrations/20260928072725_portal_pricelist_publications.sql');
const RAW = readFileSync(FILE, 'utf8');
const sql = RAW.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase();

const PUB = 'public.crm_portal_pricelist_publications';
const QUEUE = 'public.portal_outbound_events';

describe('prislistans migrering (SQL)', () => {
  it('nyckeln crm.portal.manage, bara till admin', () => {
    expect(sql).toMatch(/insert into public\.permissions \(key, description\) values \('crm\.portal\.manage',/);
    const roles = sql.match(/insert into public\.role_permissions \(role, permission_key\) values ([^;]*?) on conflict/)?.[1] ?? '';
    expect([...roles.matchAll(/\('([a-z]+)', '([a-z.]+)'\)/g)].map((m) => `${m[1]}:${m[2]}`)).toEqual(['admin:crm.portal.manage']);
  });

  it('publiceringarna: RLS, select och insert för sessionen, allt för service_role, inget för anon', () => {
    expect(sql).toContain(`alter table ${PUB} enable row level security;`);
    expect(sql).toContain(`revoke all on table ${PUB} from anon, authenticated;`);
    expect(sql).toContain(`grant select, insert on table ${PUB} to authenticated;`);
    expect(sql).toContain(`grant select, insert, update, delete on table ${PUB} to service_role;`);
  });

  it('ingen grant till anon eller public, och authenticated får aldrig update, delete, truncate eller all', () => {
    const grants = [...sql.matchAll(/grant ([^;]*?) on (?:table )?([^ ;]+) to ([^;]+);/g)];
    expect(grants.length).toBeGreaterThan(0);
    for (const [, privileges, table, grantees] of grants) {
      expect(grantees, table).not.toMatch(/\b(anon|public)\b/);
      if (/\bauthenticated\b/.test(grantees)) expect(privileges, table).not.toMatch(/\b(update|delete|truncate|all)\b/);
    }
  });

  it('varje policy: exakt authenticated, och bara crm.portal.manage', () => {
    const policies = [...sql.matchAll(/create policy (\S+) on (public\.[a-z_]+) ([^;]*);/g)];
    expect(policies.map((p) => `${p[2]}.${p[1]}`).sort()).toEqual([
      'public.crm_portal_article_fields.crm_portal_article_fields_select_portal',
      'public.crm_portal_pricelist_publications.crm_portal_pricelist_publications_insert',
      'public.crm_portal_pricelist_publications.crm_portal_pricelist_publications_select',
      'public.portal_outbound_events.portal_outbound_events_select_portal',
    ]);
    for (const [, name, , body] of policies) {
      expect(body.match(/\bto (.+?) (?:using|with check)\b/)?.[1], name).toBe('authenticated');
      const keys = [...body.matchAll(/has_permission\('([^']*)'\)/g)].map((m) => m[1]);
      expect(keys.length, name).toBeGreaterThan(0);
      expect(new Set(keys), name).toEqual(new Set(['crm.portal.manage']));
    }
  });

  it('läspolicyerna är bara select: ingen policy för insert, update eller delete på kön eller portalfälten', () => {
    for (const table of [QUEUE, 'public.crm_portal_article_fields']) {
      const onTable = [...sql.matchAll(new RegExp(`create policy \\S+ on ${table.replace('.', '\\.')} ([^;]*);`, 'g'))];
      for (const [, body] of onTable) expect(body).toMatch(/^for select to /);
    }
  });

  it('en tom lista kan inte sparas', () => {
    expect(sql).toContain('check (article_count > 0)');
  });

  it('nyckelns form i databasen är den koden bygger', () => {
    const check = RAW.match(/idempotency_key ~ '([^']+)' and right\(idempotency_key, 64\) = content_hash/);
    expect(check).not.toBeNull();
    const hash = 'f'.repeat(64);
    const key = pricelistIdempotencyKey('2026-10-01', hash);
    expect(new RegExp(check![1]).test(key)).toBe(true);
    expect(key.slice(-64)).toBe(hash);
    expect(sql).toContain("content_hash ~ '^[0-9a-f]{64}$'");
  });

  it('inga astrala tecken i filen', () => {
    expect([...RAW].filter((c) => c.codePointAt(0)! > 0xffff)).toEqual([]);
  });
});

/**
 * Kön skrivs bara av service_role (fas 1b). Den här migreringen ger sessionen LÄSrätt; ingen migrering, nu eller
 * senare, får ge den mer. Läser hela kedjan i filnamnsordning.
 */
describe('kön över alla migreringar', () => {
  const statements = readdirSync('supabase/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .flatMap((f) =>
      readFileSync(join('supabase/migrations', f), 'utf8')
        .replace(/--.*$/gm, '')
        .replace(/\s+/g, ' ')
        .toLowerCase()
        .split(';')
        .map((s) => s.trim()),
    );

  it('authenticated och anon får aldrig skriva i kön, eller köra claim-funktionen', () => {
    const grants = statements.filter((s) => /^grant .* on (?:table )?public\.portal_outbound_events to /.test(s));
    expect(grants.length).toBeGreaterThan(0);
    for (const g of grants) {
      const [, privileges, grantees] = g.match(/^grant (.*?) on (?:table )?public\.portal_outbound_events to (.*)$/)!;
      if (/\b(authenticated|anon|public)\b/.test(grantees)) expect(privileges, g).toBe('select');
      if (/\b(anon|public)\b/.test(grantees)) throw new Error(`anon/public får läsa kön: ${g}`);
    }
    const claimGrants = statements.filter((s) => /^grant .* on function public\.claim_portal_outbound_events/.test(s));
    for (const g of claimGrants) expect(g, g).toMatch(/ to service_role$/);
  });
});
