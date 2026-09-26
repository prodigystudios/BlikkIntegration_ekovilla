import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERMISSION_KEYS } from '@/lib/auth/permissions';
import { APP_NAV_ITEMS, type AppNavItem } from '@/app/_lib/appNav';

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

function sqlCatalog(): Set<string> {
  const keys = new Set<string>();
  const seed = readFileSync('supabase/seed/reference.sql', 'utf8');
  const line = seed.split('\n').find((l) => l.startsWith('insert into public.permissions '));
  const json = line?.match(/jsonb_populate_recordset\(null::public\.permissions, '(.*)'::jsonb\)/)?.[1];
  for (const row of JSON.parse((json ?? '[]').replace(/''/g, "'")) as { key: string }[]) keys.add(row.key);
  for (const file of migrationFiles) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/--.*$/gm, '');
    for (const block of sql.matchAll(/insert into public\.permissions\s*\([^)]*\)\s*values([\s\S]*?);/gi)) {
      for (const m of block[1].matchAll(/\(\s*'([a-z0-9_.]+)'\s*,/g)) keys.add(m[1]);
    }
  }
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
 * 🧨 Regeln är `roles ∪ {konsult om sales}`: menyn gör konsult till sales INNAN den filtrerar, så
 * 'konsult' står inte i en enda `roles`-lista. En rad utan `roles` är "alla anställda" (member, sales,
 * admin — ekonomi ser den inte, EXPLICIT_ONLY_ROLES) och ger därmed också konsult.
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

const ALL_EMPLOYEES = ['admin', 'member', 'sales'];

function navRow(href: string): AppNavItem {
  const all = APP_NAV_ITEMS.flatMap((item) => [item, ...(item.children ?? [])]);
  const row = all.find((item) => item.href === href);
  if (!row) throw new Error(`ingen menyrad för ${href}`);
  return row;
}

function expectedSeed(href: string): string[] {
  const roles: string[] = navRow(href).roles ?? ALL_EMPLOYEES;
  return [...new Set([...roles, ...(roles.includes('sales') ? ['konsult'] : [])])].sort();
}

function migrationSeed(): Map<string, string[]> {
  const seed = new Map<string, string[]>();
  for (const file of migrationFiles) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8').replace(/--.*$/gm, '');
    for (const block of sql.matchAll(/insert into public\.role_permissions\s*\([^)]*\)\s*values([\s\S]*?);/gi)) {
      for (const m of block[1].matchAll(/\(\s*'([a-z]+)'\s*,\s*'([a-z0-9_.]+)'\s*\)/g)) {
        seed.set(m[2], [...(seed.get(m[2]) ?? []), m[1]].sort());
      }
    }
  }
  return seed;
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
