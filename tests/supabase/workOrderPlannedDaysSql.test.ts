import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Planerat datum på arbetsordern (fas 4a, 20260928122049_work_order_planned_days.sql) skrivs bara av databasen.
 *
 * Tre funktioner bär regeln, och var och en har en egenskap som inget typsystem ser:
 *   - ops_segments_sync_planned_days: security definer (säljaren som flyttar en kollegas kort får inte ändra ordern
 *     under RLS; som invoker hade UPDATE:n träffat 0 rader utan fel), tomt search_path, ingen EXECUTE för någon roll,
 *     och låset "for no key update" innan datumen räknas (utan det skriver två samtidiga flyttar ett gammalt värde;
 *     med "for update" låser två nya kort varandra, eftersom FK-kontrollen håller FOR KEY SHARE).
 *   - crm_work_orders_guard_planned_days: invoker, annars är current_user alltid ägaren och vakten släpper allt.
 *   - set_timestamp_crm_work_orders: lämnar updated_at när BARA datumen ändrats, och behåller sitt search_path.
 *
 * Testet läser den SISTA definitionen av varje funktion i hela kedjan, så att en senare migrering som skriver om en
 * av dem inte i tysthet tappar egenskapen. Beteendet prövas mot en databas med
 * supabase/checks/work_order_planned_days.sql.
 */

const DIR = resolve(process.cwd(), 'supabase/migrations');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

const normalize = (text: string) => text.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase();
const chain = FILES.map((file) => ({ file, sql: normalize(readFileSync(resolve(DIR, file), 'utf8')) }));
const all = chain.map((c) => c.sql).join('\n');

function lastDefinition(name: string): { file: string; header: string; body: string } | null {
  let found: { file: string; header: string; body: string } | null = null;
  const re = new RegExp(`create or replace function public\\.${name} ?\\(\\)(.*?)as (\\$[a-z_]*\\$)(.*?)\\2`, 'g');
  for (const { file, sql } of chain) {
    for (const m of sql.matchAll(re)) found = { file, header: m[1], body: m[3] };
  }
  return found;
}

describe('planerat datum: schemats regel (SQL)', () => {
  const sync = lastDefinition('ops_segments_sync_planned_days');
  const guard = lastDefinition('crm_work_orders_guard_planned_days');
  const stamp = lastDefinition('set_timestamp_crm_work_orders');

  it('hittar alla tre funktionerna i kedjan — annars är testet tomt', () => {
    expect(sync?.file).toBeDefined();
    expect(guard?.file).toBeDefined();
    expect(stamp?.file).toBeDefined();
  });

  it('synken är security definer med tomt search_path', () => {
    expect(sync?.header).toContain('security definer');
    expect(sync?.header).toContain("set search_path = ''");
  });

  it('synken låser ordern med "for no key update" innan den räknar, och räknar inte pausade kort', () => {
    expect(sync?.body).toMatch(/perform 1 from public\.crm_work_orders w where w\.id = wo for no key update;/);
    expect(sync?.body).not.toMatch(/for update;/);
    expect(sync?.body.indexOf('for no key update')).toBeLessThan(sync?.body.indexOf('select min(s.start_day), max(s.end_day)') ?? -1);
    expect(sync?.body).toContain('and not s.on_hold');
  });

  it('synken skriver bara när datumen faktiskt ändras', () => {
    expect(sync?.body).toContain(
      'and (w.planned_start_day is distinct from first_day or w.planned_end_day is distinct from last_day)',
    );
  });

  it('vakten är invoker med tomt search_path', () => {
    expect(guard?.header).toContain('security invoker');
    expect(guard?.header).not.toContain('security definer');
    expect(guard?.header).toContain("set search_path = ''");
    expect(guard?.body).toContain("errcode = 'insufficient_privilege'");
  });

  it('tidsstämpeln behåller search_path = public och sin undantagsregel', () => {
    expect(stamp?.header).toContain('set search_path = public');
    expect(stamp?.body).toContain('new.updated_at = old.updated_at');
    expect(stamp?.body).toContain('new.updated_at = now()');
  });

  it('ingen roll kör synken eller vakten, och ingen grant ger tillbaka EXECUTE', () => {
    for (const fn of ['ops_segments_sync_planned_days', 'crm_work_orders_guard_planned_days']) {
      expect(all).toContain(`revoke all on function public.${fn}() from public, anon, authenticated, service_role;`);
      expect(all).not.toMatch(new RegExp(`grant [^;]*on function public\\.${fn}\\(`));
    }
  });

  it('triggrarna: efter insert, delete och flytt/paus på korten; före insert och update på ordern', () => {
    expect(all).toContain(
      'create trigger ops_segments_sync_planned_days after insert or delete or update of work_order_id, start_day, end_day, on_hold on public.ops_segments for each row execute function public.ops_segments_sync_planned_days();',
    );
    expect(all).toContain(
      'create trigger crm_work_orders_guard_planned_days before insert or update on public.crm_work_orders for each row execute function public.crm_work_orders_guard_planned_days();',
    );
  });
});
