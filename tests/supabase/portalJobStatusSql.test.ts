import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Markeringen för statusen tillbaka till portalen (fas 4b, 20260928134853_portal_job_status.sql).
 *
 * crm_work_orders_mark_portal_job måste vara security definer (sessionen som ändrar ordern får aldrig skriva i
 * crm_portal_jobs; som invoker hade markeringen uppdaterat 0 rader utan fel), med tomt search_path och utan EXECUTE för
 * någon roll. Den markerar på reserved_work_order_id, eftersom work_order_id nollas när ordern raderas. Sessionen får
 * läsa ett fåtal kolumner i crm_portal_jobs, aldrig synkens eller Fortnox-försökens. Testet läser den SISTA
 * definitionen i hela kedjan; beteendet prövas mot en databas med supabase/checks/portal_job_status.sql.
 */

const DIR = resolve(process.cwd(), 'supabase/migrations');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const normalize = (text: string) => text.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase();
const chain = FILES.map((file) => ({ file, sql: normalize(readFileSync(resolve(DIR, file), 'utf8')) }));
const all = chain.map((c) => c.sql).join('\n');
const FN = 'crm_work_orders_mark_portal_job';

function lastDefinition(name: string) {
  let found: { file: string; header: string; body: string } | null = null;
  const re = new RegExp(`create or replace function public\\.${name} ?\\(\\)(.*?)as (\\$[a-z_]*\\$)(.*?)\\2`, 'g');
  for (const { file, sql } of chain) for (const m of sql.matchAll(re)) found = { file, header: m[1], body: m[3] };
  return found;
}

describe('portalens status: markeringen (SQL)', () => {
  const fn = lastDefinition(FN);

  it('hittar funktionen i kedjan — annars är testet tomt', () => {
    expect(fn?.file).toBeDefined();
  });

  it('security definer med tomt search_path, och ingen roll kör den', () => {
    expect(fn?.header).toContain('security definer');
    expect(fn?.header).toContain("set search_path = ''");
    expect(all).toContain(`revoke all on function public.${FN}() from public, anon, authenticated, service_role;`);
    expect(all).not.toMatch(new RegExp(`grant [^;]*on function public\\.${FN}\\(`));
  });

  it('markerar på reserved_work_order_id (work_order_id nollas när ordern raderas), med clock_timestamp', () => {
    expect(fn?.body).toContain('update public.crm_portal_jobs j set sync_requested_at = pg_catalog.clock_timestamp() where j.reserved_work_order_id = wo;');
    expect(fn?.body).not.toMatch(/where j\.work_order_id/);
  });

  it('bara när status, datumen eller Fortnox-numret faktiskt ändrats, och vid radering', () => {
    expect(fn?.body).toContain(
      '(old.status, old.planned_start_day, old.planned_end_day, old.fortnox_order_number) is not distinct from (new.status, new.planned_start_day, new.planned_end_day, new.fortnox_order_number)',
    );
    expect(all).toContain(
      `create trigger ${FN} after delete or update of status, planned_start_day, planned_end_day, fortnox_order_number on public.crm_work_orders for each row execute function public.${FN}();`,
    );
  });

  it('migreringen låser arbetsordrarna före jobben, i ett do-block', () => {
    const mig = chain.find((c) => c.file.startsWith('20260928134853_'))?.sql ?? '';
    const lock = mig.indexOf('do $$ begin lock table public.crm_work_orders in share row exclusive mode; end $$;');
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(mig.indexOf('alter table public.crm_portal_jobs'));
    expect(mig).not.toMatch(/(^|; )lock table/);
  });

  it('sessionen får bara läsa brickans kolumner och quote_id i crm_portal_jobs, i hela kedjan', () => {
    const grants = [...all.matchAll(/grant ([^;]*?) on table public\.crm_portal_jobs to ([^;]+);/g)]
      .filter((m) => /\b(authenticated|anon|public)\b/.test(m[2]))
      .map((m) => m[1].trim());
    expect(grants).toEqual(['select (work_order_id, quote_number, store_name, received_at)', 'select (quote_id)']);
  });
});
