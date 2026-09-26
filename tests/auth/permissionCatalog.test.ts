import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERMISSION_KEYS } from '@/lib/auth/permissions';
import { getVisibleAppNavItems } from '@/app/_lib/appNav';
import { toEffectiveRole, type UserRole } from '@/lib/roles';

/**
 * Katalogen finns på två ställen: SQL-tabellen `permissions` och PERMISSION_KEYS i koden. De måste vara
 * SAMMA mängd. En nyckel som bara finns i koden 403:ar alla (getEffectivePermissions failar closed); en
 * som bara finns i SQL går inte att använda i en grind utan att kompilatorn protesterar.
 *
 * SQL-sidan läses som `db reset` bygger den: prods katalog ur supabase/seed/reference.sql plus varje
 * `insert into public.permissions` i supabase/migrations.
 */

const MIGRATIONS = 'supabase/migrations';
const migrationFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();

/**
 * En migrering, normaliserad för mönstren nedan: utan hela kommentarsrader, DO-block och
 * funktionskroppar, med citerade identifierare avcitade (`"public"."permissions"` — så skriver
 * pull/diff) och gemener i nyckelorden. Strängvärden rörs inte.
 */
function migrationSql(file: string): string {
  return readFileSync(join(MIGRATIONS, file), 'utf8')
    .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, '')
    .replace(/^\s*--.*$/gm, '')
    .replace(/"(\w+)"/g, '$1')
    .replace(/\b(INSERT INTO|DELETE FROM|VALUES|WHERE|AND|IN)\b/g, (w) => w.toLowerCase());
}

function sqlCatalog(): Set<string> {
  // Samma ordning som `db reset`: migreringarna först, sedan seeden (som bara kan lägga till).
  const keys = new Set<string>();
  for (const file of migrationFiles) {
    const sql = migrationSql(file);
    for (const block of sql.matchAll(/insert into public\.permissions\s*\([^)]*\)\s*values([\s\S]*?)(?:on conflict|;)/g)) {
      for (const m of block[1].matchAll(/\(\s*'([a-z0-9_.]+)'\s*,/g)) keys.add(m[1]);
    }
    for (const m of sql.matchAll(/delete from public\.permissions\s+where\s+key\s*(?:=\s*'([a-z0-9_.]+)'|in\s*\(([^)]*)\))/g)) {
      for (const k of m[1] ? [m[1]] : [...m[2].matchAll(/'([a-z0-9_.]+)'/g)].map((x) => x[1])) keys.delete(k);
    }
  }
  const seed = readFileSync('supabase/seed/reference.sql', 'utf8');
  const line = seed.split('\n').find((l) => l.startsWith('insert into public.permissions '));
  const json = line?.match(/jsonb_populate_recordset\(null::public\.permissions, '(.*)'::jsonb\)/)?.[1];
  for (const row of JSON.parse((json ?? '[]').replace(/''/g, "'")) as { key: string }[]) keys.add(row.key);
  return keys;
}

describe('behörighetskatalogen', () => {
  it('läser faktiskt SQL-katalogen — annars är testet tomt', () => {
    const keys = sqlCatalog();
    expect(keys.has('crm.access')).toBe(true); // ur seeden
    expect(keys.has('app.access')).toBe(true); // ur en migrering
  });

  it('SQL och koden har exakt samma nycklar', () => {
    expect([...sqlCatalog()].sort()).toEqual([...PERMISSION_KEYS].sort());
  });
});

/**
 * Appnycklarnas seed ska vara EXAKT menyns rollmängd i dag — det är vad som gör att steget från
 * rollgatad till nyckelgatad meny inte flyttar en enda rad för någon.
 *
 * Rollmängden räknas fram med den RIKTIGA menylogiken, som sidomenyn anropar den:
 * getVisibleAppNavItems(toEffectiveRole(roll)). Då följer konsult→sales, EXPLICIT_ONLY_ROLES (ekonomi)
 * och grupperna med av sig själva. 🧨 Seedar man radens `roles` ordagrant tappar konsult allt som sales
 * ser — strängen 'konsult' står inte i en enda `roles`-lista.
 */
const APP_KEY_ROWS: Record<string, string[]> = {
  'app.access': ['/dokument-information', '/felanmalan'],
  'app.contacts.read': ['/kontakt-lista'],
  'app.news.read': ['/nyheter'],
  'app.material.read': ['/material-kvalitet'],
  'app.documents.read': ['/mina-dokument'],
  'app.archive.read': ['/archive'],
  'app.jobs.read': ['/mina-jobb'],
  'app.egenkontroll.write': ['/egenkontroll'],
  'app.clothing.order': ['/bestallning-klader'],
};

const ROLES: UserRole[] = ['member', 'sales', 'admin', 'konsult', 'ekonomi'];

function visibleHrefs(role: UserRole): Set<string> {
  const items = getVisibleAppNavItems(toEffectiveRole(role));
  return new Set(items.flatMap((item) => [item.href, ...(item.children ?? []).map((c) => c.href)]));
}

function expectedSeed(href: string): string[] {
  const roles = ROLES.filter((role) => visibleHrefs(role).has(href));
  if (roles.length === 0) throw new Error(`ingen roll ser ${href} — fel adress i APP_KEY_ROWS?`);
  return roles.sort();
}

function migrationSeed(): Map<string, string[]> {
  const seed = new Map<string, Set<string>>();
  for (const file of migrationFiles) {
    const sql = migrationSql(file);
    for (const block of sql.matchAll(/insert into public\.role_permissions\s*\([^)]*\)\s*values([\s\S]*?)(?:on conflict|;)/g)) {
      for (const m of block[1].matchAll(/\(\s*'([a-z]+)'\s*,\s*'([a-z0-9_.]+)'\s*\)/g)) {
        seed.set(m[2], (seed.get(m[2]) ?? new Set()).add(m[1]));
      }
    }
    for (const m of sql.matchAll(/delete from public\.role_permissions\s+where\s+([^;]*)/g)) {
      const role = m[1].match(/role\s*=\s*'([a-z]+)'/)?.[1];
      const key = m[1].match(/permission_key\s*=\s*'([a-z0-9_.]+)'/)?.[1];
      if (!role && !key) continue;
      for (const [k, roles] of seed) {
        if (key && k !== key) continue;
        if (role) roles.delete(role);
        else roles.clear();
      }
    }
  }
  return new Map([...seed].map(([k, roles]) => [k, [...roles].sort()]));
}

describe('appnycklarnas seed = menyns rollmängd i dag', () => {
  const seed = migrationSeed();

  it.each(Object.entries(APP_KEY_ROWS))('%s', (key, hrefs) => {
    for (const href of hrefs) expect(seed.get(key), `${key} mot raden ${href}`).toEqual(expectedSeed(href));
  });

  it('täcker varje app.*-nyckel i koden', () => {
    const appKeys = PERMISSION_KEYS.filter((k) => k.startsWith('app.'));
    expect(Object.keys(APP_KEY_ROWS).sort()).toEqual([...appKeys].sort());
  });

  it('ger aldrig lönebyrån (ekonomi) en appnyckel', () => {
    for (const key of Object.keys(APP_KEY_ROWS)) expect(seed.get(key) ?? []).not.toContain('ekonomi');
  });

  // /crm/installningar och /crm/installningar/kalkyl kräver i dag role = 'admin'.
  it('crm.settings.manage är bara admin', () => {
    expect(seed.get('crm.settings.manage')).toEqual(['admin']);
  });
});
