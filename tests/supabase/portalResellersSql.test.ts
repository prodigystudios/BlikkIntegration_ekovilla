import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Butikernas migrering (20260928082554_portal_resellers.sql). Reglerna bor i SQL som typsystemet inte når, så testet
 * läser filen:
 *   - sessionen läser, och ändrar BARA säljaren respektive reserven (kolumngrant), aldrig lägger till eller tar bort;
 *   - kolumngranten står efter tabellens revoke all, annars tar revoken bort den;
 *   - policyerna frågar efter crm.portal.manage och binder updated_by till den inloggade;
 *   - inställningen har exakt en rad, och en borttagen användare lämnar ett tomt fält, inte ett fel.
 * Beteendet prövas mot en databas med supabase/checks/portal_resellers.sql.
 */

const RAW = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260928082554_portal_resellers.sql'), 'utf8');
const sql = RAW.replace(/--.*$/gm, '').replace(/\s+/g, ' ').toLowerCase();

const RESELLERS = 'public.crm_portal_resellers';
const SETTINGS = 'public.crm_portal_settings';

describe('butikernas migrering (SQL)', () => {
  it.each([
    [RESELLERS, 'seller_user_id, updated_by'],
    [SETTINGS, 'fallback_user_id, updated_by'],
  ])('%s: RLS, select för sessionen, update bara på (%s), allt för service_role', (table, columns) => {
    expect(sql).toContain(`alter table ${table} enable row level security;`);
    const revoke = sql.indexOf(`revoke all on table ${table} from anon, authenticated;`);
    const columnGrant = sql.indexOf(`grant update (${columns}) on table ${table} to authenticated;`);
    expect(revoke).toBeGreaterThan(-1);
    expect(columnGrant).toBeGreaterThan(revoke);
    expect(sql).toContain(`grant select on table ${table} to authenticated;`);
    expect(sql).toContain(`grant select, insert, update, delete on table ${table} to service_role;`);
  });

  it('inga andra grants till authenticated, och inga alls till anon eller public', () => {
    const grants = [...sql.matchAll(/grant ([^;]*?) on (?:table )?([^ ;]+) to ([^;]+);/g)];
    const toSession = grants.filter(([, , , grantees]) => /\bauthenticated\b/.test(grantees)).map(([, privileges, table]) => `${table}: ${privileges}`);
    expect(toSession.sort()).toEqual([
      `${RESELLERS}: select`,
      `${RESELLERS}: update (seller_user_id, updated_by)`,
      `${SETTINGS}: select`,
      `${SETTINGS}: update (fallback_user_id, updated_by)`,
    ]);
    for (const [, , table, grantees] of grants) expect(grantees, table).not.toMatch(/\b(anon|public)\b/);
  });

  it('policyerna: exakt authenticated, crm.portal.manage, och updated_by = den inloggade vid ändring', () => {
    const policies = [...sql.matchAll(/create policy (\S+) on (public\.[a-z_]+) ([^;]*);/g)];
    expect(policies.map((p) => p[1]).sort()).toEqual([
      'crm_portal_resellers_select',
      'crm_portal_resellers_update',
      'crm_portal_settings_select',
      'crm_portal_settings_update',
    ]);
    for (const [, name, , body] of policies) {
      expect(body.match(/\bto (.+?) (?:using|with check)\b/)?.[1], name).toBe('authenticated');
      expect(new Set([...body.matchAll(/has_permission\('([^']*)'\)/g)].map((m) => m[1])), name).toEqual(new Set(['crm.portal.manage']));
      if (name.endsWith('_update')) expect(body, name).toContain('updated_by = (select auth.uid())');
    }
  });

  it('inställningen: en enda rad, som finns från början', () => {
    expect(sql).toContain('id boolean primary key default true');
    expect(sql).toContain(`add constraint crm_portal_settings_id_check check (id);`);
    expect(sql).toContain('insert into public.crm_portal_settings (id) values (true) on conflict (id) do nothing;');
  });

  it('en borttagen användare eller kund lämnar ett tomt fält', () => {
    for (const fk of [
      'foreign key (customer_id) references public.crm_customers(id) on delete set null',
      'foreign key (seller_user_id) references public.profiles(id) on delete set null',
      'foreign key (fallback_user_id) references public.profiles(id) on delete set null',
    ]) {
      expect(sql).toContain(fk);
    }
  });

  it('inga astrala tecken i filen', () => {
    expect([...RAW].filter((c) => c.codePointAt(0)! > 0xffff)).toEqual([]);
  });
});
