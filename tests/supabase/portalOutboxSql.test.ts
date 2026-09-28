import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Portalens svarscache och utskickskö nås BARA av service_role (20260928053434_portal_outbox_idempotency.sql).
 *
 * Kön bär allt som skickas till butikerna, och svarscachen avgör vilka anrop som redan körts. En grant eller policy
 * som någon "kompletterar" tabellerna med hade låtit en inloggad session läsa eller skriva köns rader — eller köra
 * claim-funktionen och sno händelser ur kön. Regeln bor i SQL som typsystemet inte når, så testet läser filen.
 * Beteendet (vilka händelser som tas) prövas mot en databas med supabase/checks/portal_outbox.sql.
 */

const FILE = resolve(process.cwd(), 'supabase/migrations/20260928053434_portal_outbox_idempotency.sql');

// Kommentarerna bort: huvudet FÖRKLARAR varför grants saknas.
const sql = readFileSync(FILE, 'utf8')
  .replace(/--.*$/gm, '')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const TABLES = ['public.portal_idempotency_keys', 'public.portal_outbound_events'];
const FUNCTION = 'public.claim_portal_outbound_events(integer, interval)';

describe('portalens transporttabeller (SQL)', () => {
  it('RLS är på, och sessionerna får ingenting på tabellerna', () => {
    for (const table of TABLES) {
      expect(sql).toContain(`alter table ${table} enable row level security;`);
      expect(sql).toContain(`revoke all on table ${table} from anon, authenticated;`);
      expect(sql).toContain(`grant select, insert, update, delete on table ${table} to service_role;`);
    }
  });

  it('ingen grant och ingen policy för anon, authenticated eller public någonstans', () => {
    const grants = [...sql.matchAll(/grant [^;]* to ([^;]+);/g)].map((m) => m[1]);
    expect(grants.length).toBeGreaterThan(0);
    for (const grantees of grants) {
      expect(grantees).not.toMatch(/\b(anon|authenticated|public)\b/);
    }
    expect(sql).not.toMatch(/create policy/);
  });

  it('claim-funktionen körs bara av service_role, som invoker och med ett tomt search_path', () => {
    expect(sql).toContain(`revoke all on function ${FUNCTION} from public, anon, authenticated;`);
    expect(sql).toContain(`grant execute on function ${FUNCTION} to service_role;`);
    const body = sql.match(/create or replace function public\.claim_portal_outbound_events\((.*?)\$\$(.*?)\$\$;/);
    expect(body).not.toBeNull();
    expect(body?.[1]).toContain('security invoker');
    expect(body?.[1]).not.toContain('security definer');
    expect(body?.[1]).toContain("set search_path = ''");
    expect(body?.[2]).toContain('for update skip locked');
  });

  it('köordningen går på ett strikt stigande löpnummer, inte på created_at', () => {
    expect(sql).toContain('seq bigint generated always as identity');
    expect(sql).toContain('order by e.ordering_key, e.seq');
    expect(sql).toContain('order by h.seq');
  });

  it('en fastnad händelse tas om först efter fem minuter — längre än ett utskicks längsta körning', () => {
    expect(sql).toContain("p_stale_after interval default interval '5 minutes'");
  });

  it('svarscachen sparar aldrig ett tillfälligt svar (401, 408, 425, 429) eller ett 5xx', () => {
    expect(sql).toContain('response_status between 200 and 299');
    expect(sql).toContain('response_status between 400 and 499 and response_status not in (401, 408, 425, 429)');
    expect(sql).not.toContain('response_status between 200 and 499');
  });

  it('kön pekar bara på portalens egna routes', () => {
    expect(sql).toContain("check (path ~ '^/api/ekovilla/[a-za-z0-9_-]+(/[a-za-z0-9_-]+)*$')");
  });
});
