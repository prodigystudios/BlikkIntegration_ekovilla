import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Butiksbeställningarnas tabell (fas 8, 20260929065116_portal_store_orders.sql), som den står efter HELA kedjan.
 *
 * Det som vaktas här, i CI: vakten (statusen bara framåt, butikens innehåll och frakten bara på en mottagen, Fortnox-
 * numren en gång, markeringen för utskicket) sitter på tabellen och är ingens att köra; regeln för vem som hanterar är
 * invoker och kräver crm.workorder.write och ansvarig eller admin; sessionen läser med crm.access och skriver aldrig.
 * Beteendet prövas mot en databas med supabase/checks/portal_store_orders.sql.
 */

const DIR = resolve(process.cwd(), 'supabase/migrations');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const normalize = (text: string) => text.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase();
const chain = FILES.map((file) => ({ file, sql: normalize(readFileSync(resolve(DIR, file), 'utf8')) }));
const all = chain.map((c) => c.sql).join('\n');

function lastDefinition(name: string, args: string) {
  let found: { file: string; header: string; body: string } | null = null;
  const re = new RegExp(`create or replace function public\\.${name} ?\\(${args}\\)(.*?)as (\\$[a-z_]*\\$)(.*?)\\2`, 'g');
  for (const { file, sql } of chain) for (const m of sql.matchAll(re)) found = { file, header: m[1], body: m[3] };
  return found;
}

describe('butiksbeställningarna (SQL)', () => {
  const guard = lastDefinition('crm_store_orders_guard', '');
  const rule = lastDefinition('crm_store_order_can_manage', 'p_id uuid');

  it('hittar vakten och regeln i kedjan — annars är testet tomt', () => {
    expect(guard?.file).toBeDefined();
    expect(rule?.file).toBeDefined();
  });

  it('vakten: statusen bara framåt, och bara de här övergångarna', () => {
    const body = guard!.body;
    expect(body).toContain("(old.status = 'received' and new.status in ('withdrawn', 'confirmed', 'cancelled'))");
    expect(body).toContain("(old.status = 'confirmed' and new.status in ('delivered', 'cancelled'))");
    expect(body).toContain("(old.status = 'delivered' and new.status = 'invoiced')");
    expect(body).toContain("if new.status <> 'received' or new.store_version <> 1 then");
  });

  it('vakten: butikens innehåll (också namnet och ändringstiden) och frakten bara på en mottagen, versionen bara framåt, Fortnox-numren en gång', () => {
    const body = guard!.body;
    expect(body).toMatch(
      /new\.payload is distinct from old\.payload or new\.store_version is distinct from old\.store_version or new\.portal_updated_at is distinct from old\.portal_updated_at or new\.changed_at is distinct from old\.changed_at or new\.store_name is distinct from old\.store_name or new\.freight_mode is distinct from old\.freight_mode or new\.freight_price is distinct from old\.freight_price\) and not \(old\.status = 'received' and new\.status = 'received'\) then raise exception/,
    );
    expect(body).toContain('if new.store_version < old.store_version then raise exception');
    expect(body).toContain('old.fortnox_order_number is not null and new.fortnox_order_number is distinct from old.fortnox_order_number');
    expect(body).toContain('old.fortnox_invoice_number is not null and new.fortnox_invoice_number is distinct from old.fortnox_invoice_number');
    expect(body).toMatch(/new\.intake_payload is distinct from old\.intake_payload/);
    expect(body).toContain('new.sync_requested_at := now()');
  });

  it('vakten sitter på tabellen, före insert och update, och är ingens att köra', () => {
    expect(guard!.header).not.toContain('security definer');
    expect(all).toContain(
      'create trigger crm_store_orders_guard before insert or update on public.crm_store_orders for each row execute function public.crm_store_orders_guard();',
    );
    expect(all).toContain('revoke all on function public.crm_store_orders_guard() from public, anon, authenticated, service_role;');
    expect(all).not.toMatch(/grant [^;]*on function public\.crm_store_orders_guard\(/);
    expect(all).not.toMatch(/disable trigger crm_store_orders_guard/);
  });

  it('regeln: invoker, crm.workorder.write och den ansvarige eller admin; bara sessionen kör den', () => {
    expect(rule!.header).toContain('security invoker');
    expect(rule!.header).not.toContain('security definer');
    expect(rule!.body).toContain("(select public.has_permission('crm.workorder.write'))");
    expect(rule!.body).toContain("o.assigned_to = (select auth.uid()) or (select public.has_permission('crm.admin'))");
    expect(all).toContain('grant execute on function public.crm_store_order_can_manage(uuid) to authenticated;');
    expect(all).not.toMatch(/grant execute on function public\.crm_store_order_can_manage\(uuid\) to [^;]*anon/);
  });

  it('sessionen läser med crm.access och skriver aldrig; första kroppen och bokföringen är service-rollens', () => {
    expect(all).toMatch(/create policy crm_store_orders_select on public\.crm_store_orders for select to authenticated using \(\(select has_permission\('crm\.access'\)\)\);/);
    expect(all).not.toMatch(/create policy \S+ on public\.crm_store_orders for (insert|update|delete|all)/);
    // Varje grant på tabellen till sessionen: privilegierna utan kolumnlistan ("portal_updated_at" innehåller "update").
    const sessionGrants = [...all.matchAll(/grant ([^;]*?) on table public\.crm_store_orders to ([^;]*);/g)]
      .filter((m) => /\b(authenticated|anon|public)\b/.test(m[2]))
      .map((m) => m[1].replace(/\([^)]*\)/g, '').trim());
    expect(sessionGrants).toEqual(['select']);
    const grant = all.match(/grant select \(([^)]*)\) on table public\.crm_store_orders to authenticated;/);
    expect(grant).not.toBeNull();
    const columns = grant![1].split(',').map((c) => c.trim());
    for (const hidden of ['intake_payload', 'notified_key', 'notify_claimed_at', 'sync_state', 'sync_requested_at', 'fortnox_order_claimed_at']) {
      expect(columns).not.toContain(hidden);
    }
    expect(columns).toEqual(expect.arrayContaining(['id', 'status', 'payload', 'cancel_reason']));
  });
});
