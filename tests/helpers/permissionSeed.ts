import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Behörigheterna som `db reset` bygger dem: migreringarna i filnamnsordning, sedan prods seed
// (supabase/seed/reference.sql, som bara kan lägga till). Delas av katalog- och menytesterna.

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

export function sqlCatalog(): Set<string> {
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


export function migrationSeed(): Map<string, string[]> {
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


/** Prods rollrader ur seeden. */
function referenceRoleRows(): { role: string; permission_key: string }[] {
  const seed = readFileSync('supabase/seed/reference.sql', 'utf8');
  const line = seed.split('\n').find((l) => l.startsWith('insert into public.role_permissions '));
  const json = line?.match(/jsonb_populate_recordset\(null::public\.role_permissions, '(.*)'::jsonb\)/)?.[1];
  return JSON.parse((json ?? '[]').replace(/''/g, "'"));
}

/** Nycklarna en roll har efter `db reset` (rollens knippe — utan per-användarundantag). */
export function keysForRole(role: string): Set<string> {
  const keys = new Set<string>();
  for (const [key, roles] of migrationSeed()) if (roles.includes(role)) keys.add(key);
  for (const row of referenceRoleRows()) if (row.role === role) keys.add(row.permission_key);
  return keys;
}
