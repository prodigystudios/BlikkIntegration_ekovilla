import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Behörighetsläget som i PROD: prods ögonblicksbild (supabase/seed/reference.sql, exporterad ur prod)
 * först, sedan varje migrering i filnamnsordning — insert OCH delete. Migreringar från före exporten
 * är redan med i bilden; att spela dem igen är ofarligt (inserts är idempotenta, en delete av något
 * som redan är borta gör ingenting). Migreringar efter exporten läggs på. Så blir en nyckel som dras
 * tillbaka i en migrering också borta här, fast den står kvar i en äldre export.
 *
 * (`db reset` lokalt kör i motsatt ordning — migreringarna, sedan seeden — och kan därför ha kvar en
 * tillbakadragen rad tills nästa export. Det som ska stämma mot koden är prod.)
 *
 * Läses och parsas EN gång per testkörning. Delas av katalog- och menytesterna.
 */

const MIGRATIONS = 'supabase/migrations';

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

function referenceRows<T>(table: 'permissions' | 'role_permissions'): T[] {
  const seed = readFileSync('supabase/seed/reference.sql', 'utf8');
  const line = seed.split('\n').find((l) => l.startsWith(`insert into public.${table} `));
  const json = line?.match(new RegExp(`jsonb_populate_recordset\\(null::public\\.${table}, '(.*)'::jsonb\\)`))?.[1];
  return JSON.parse((json ?? '[]').replace(/''/g, "'"));
}

type PermissionState = { catalog: Set<string>; roleKeys: Map<string, Set<string>> };

function build(): PermissionState {
  const catalog = new Set(referenceRows<{ key: string }>('permissions').map((r) => r.key));
  const roleKeys = new Map<string, Set<string>>();
  const grant = (role: string, key: string) => roleKeys.set(role, (roleKeys.get(role) ?? new Set()).add(key));
  for (const r of referenceRows<{ role: string; permission_key: string }>('role_permissions')) grant(r.role, r.permission_key);

  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = migrationSql(file);
    for (const block of sql.matchAll(/insert into public\.permissions\s*\([^)]*\)\s*values([\s\S]*?)(?:on conflict|;)/g)) {
      for (const m of block[1].matchAll(/\(\s*'([a-z0-9_.]+)'\s*,/g)) catalog.add(m[1]);
    }
    for (const m of sql.matchAll(/delete from public\.permissions\s+where\s+key\s*(?:=\s*'([a-z0-9_.]+)'|in\s*\(([^)]*)\))/g)) {
      const keys = m[1] ? [m[1]] : [...m[2].matchAll(/'([a-z0-9_.]+)'/g)].map((x) => x[1]);
      for (const key of keys) {
        catalog.delete(key);
        for (const held of roleKeys.values()) held.delete(key); // FK on delete cascade
      }
    }
    for (const block of sql.matchAll(/insert into public\.role_permissions\s*\([^)]*\)\s*values([\s\S]*?)(?:on conflict|;)/g)) {
      for (const m of block[1].matchAll(/\(\s*'([a-z]+)'\s*,\s*'([a-z0-9_.]+)'\s*\)/g)) grant(m[1], m[2]);
    }
    for (const m of sql.matchAll(/delete from public\.role_permissions\s+where\s+([^;]*)/g)) {
      const role = m[1].match(/role\s*=\s*'([a-z]+)'/)?.[1];
      const key = m[1].match(/permission_key\s*=\s*'([a-z0-9_.]+)'/)?.[1];
      if (!role && !key) continue;
      for (const [r, held] of roleKeys) {
        if (role && r !== role) continue;
        if (key) held.delete(key);
        else held.clear();
      }
    }
  }
  return { catalog, roleKeys };
}

let cached: PermissionState | undefined;
function state(): PermissionState {
  return (cached ??= build());
}

/** Nyckelkatalogen i prod. */
export function sqlCatalog(): Set<string> {
  return new Set(state().catalog);
}

/** Nycklarna en roll har i prod (rollens knippe — utan per-användarundantag). */
export function keysForRole(role: string): Set<string> {
  return new Set(state().roleKeys.get(role) ?? []);
}

/** Rollerna som har en nyckel i prod, sorterade. */
export function rolesWithKey(key: string): string[] {
  return [...state().roleKeys].filter(([, held]) => held.has(key)).map(([role]) => role).sort();
}
