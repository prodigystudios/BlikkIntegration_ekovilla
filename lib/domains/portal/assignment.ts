import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveRoutingUser } from '@/lib/domains/crm/routingRules';
import { lookupCounty } from './county';

/**
 * Vem på Ekovilla som får ett jobb från återförsäljarportalen (RESELLER_PORTAL_CRM_PLAN.md fas 3a). Den första som
 * finns och kan skriva arbetsordrar (`crm.workorder.write`):
 *
 *   1. butikens säljare        satt per butik på portalsidan (`crm_portal_resellers.seller_user_id`)
 *   2. kundansvarig            på butikens kundkort (`crm_customers.account_manager_id`)
 *   3. säljaren för länet      där jobbet utförs (`crm_routing_rules`, länet ur postnummer och ort)
 *   4. reserven                satt på portalsidan (`crm_portal_settings.fallback_user_id`)
 *
 * Finns ingen blir det `none`, och jobbet tas inte emot än (William 2026-09-28): portalen får 503 och försöker igen.
 *
 * Stegen hämtas i tur och ordning och bara vid behov: länet slås upp hos Nominatim först när steg 1 och 2 inte gav
 * någon. Ordningen och kravet prövas i `resolvePortalAssignee`, som är ren mot sina `deps`.
 */

export const WORK_ORDER_WRITE_KEY = 'crm.workorder.write';

export type AssignmentSource = 'reseller_seller' | 'account_manager' | 'county' | 'fallback';

export const ASSIGNMENT_SOURCE_LABELS: Record<AssignmentSource, string> = {
  reseller_seller: 'butikens säljare',
  account_manager: 'kundansvarig',
  county: 'säljaren för länet',
  fallback: 'reserven',
};

/** En kandidat som fanns men inte kan skriva arbetsordrar, t.ex. en kundansvarig som bytt roll. */
export type SkippedCandidate = { source: AssignmentSource; userId: string };

export type PortalAssignment =
  | { kind: 'assigned'; userId: string; source: AssignmentSource; county: string | null; skipped: SkippedCandidate[] }
  | { kind: 'none'; county: string | null; skipped: SkippedCandidate[] };

export type AssignmentDeps = {
  resellerSeller: () => Promise<string | null>;
  accountManager: () => Promise<string | null>;
  county: () => Promise<string | null>;
  countyUser: (county: string) => Promise<string | null>;
  fallback: () => Promise<string | null>;
  canWrite: (userId: string) => Promise<boolean>;
};

export async function resolvePortalAssignee(deps: AssignmentDeps): Promise<PortalAssignment> {
  const skipped: SkippedCandidate[] = [];
  let county: string | null = null;

  const steps: [AssignmentSource, () => Promise<string | null>][] = [
    ['reseller_seller', deps.resellerSeller],
    ['account_manager', deps.accountManager],
    [
      'county',
      async () => {
        county = await deps.county();
        return county ? deps.countyUser(county) : null;
      },
    ],
    ['fallback', deps.fallback],
  ];

  for (const [source, candidate] of steps) {
    const userId = await candidate();
    if (!userId) continue;
    if (await deps.canWrite(userId)) return { kind: 'assigned', userId, source, county, skipped };
    skipped.push({ source, userId });
  }
  return { kind: 'none', county, skipped };
}

// --------------------------------------------------------------------------------------------------- behörigheten

export type PermissionOverride = { key: string; effect: 'grant' | 'revoke' };

/**
 * En användares nycklar: rollens knippe, plus egna tillägg, minus egna borttag. Samma regel som
 * `effective_permissions()` i databasen och adminsidans behörigheter (app/api/admin/permissions/users/[id]).
 * Ett borttag vinner alltid.
 */
export function effectivePermissionKeys(roleKeys: string[], overrides: PermissionOverride[]): Set<string> {
  const keys = new Set(roleKeys);
  for (const o of overrides) if (o.effect === 'grant') keys.add(o.key);
  for (const o of overrides) if (o.effect === 'revoke') keys.delete(o.key);
  return keys;
}

/**
 * Kan användaren skriva arbetsordrar? Med service-rollen: `user_permissions` är bara läsbar för sin egen rad, och
 * frågan gäller en annan användare (se "Reviewed elevations" i SUPABASE_CONVENTIONS.md). En profil som saknas kan
 * inte.
 */
export async function userCanWriteWorkOrders(admin: SupabaseClient, userId: string): Promise<boolean> {
  const profile = await admin.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (profile.error) throw new Error(`Profilen gick inte att läsa: ${profile.error.message}`);
  const role = (profile.data as { role?: string } | null)?.role;
  if (!role) return false;

  const [roleKeys, overrides] = await Promise.all([
    admin.from('role_permissions').select('permission_key').eq('role', role).eq('permission_key', WORK_ORDER_WRITE_KEY),
    admin.from('user_permissions').select('permission_key, effect').eq('user_id', userId).eq('permission_key', WORK_ORDER_WRITE_KEY),
  ]);
  if (roleKeys.error) throw new Error(`Rollens behörigheter gick inte att läsa: ${roleKeys.error.message}`);
  if (overrides.error) throw new Error(`Användarens behörigheter gick inte att läsa: ${overrides.error.message}`);

  return effectivePermissionKeys(
    ((roleKeys.data ?? []) as { permission_key: string }[]).map((r) => r.permission_key),
    ((overrides.data ?? []) as { permission_key: string; effect: 'grant' | 'revoke' }[]).map((r) => ({
      key: r.permission_key,
      effect: r.effect,
    })),
  ).has(WORK_ORDER_WRITE_KEY);
}

// -------------------------------------------------------------------------------------------------------- databasen

/**
 * Stegen mot databasen och Nominatim, för jobbets intag (fas 3b). Service-rollen: jobbet har ingen användare bakom
 * sig. Ett databasfel kastas (intaget svarar då 5xx och portalen försöker igen); länsuppslaget ger null vid fel.
 */
export function portalAssignmentDeps(
  admin: SupabaseClient,
  job: { resellerId: string; customerId: string | null; workplace: { postalCode: string; city: string } },
  options: { fetchImpl?: typeof fetch } = {},
): AssignmentDeps {
  const single = async (query: PromiseLike<{ data: unknown; error: { message: string } | null }>, column: string) => {
    const { data, error } = await query;
    if (error) throw new Error(`Fördelningen: ${error.message}`);
    const value = (data as Record<string, unknown> | null)?.[column];
    return typeof value === 'string' ? value : null;
  };
  return {
    resellerSeller: () =>
      single(admin.from('crm_portal_resellers').select('seller_user_id').eq('reseller_id', job.resellerId).maybeSingle(), 'seller_user_id'),
    accountManager: async () =>
      job.customerId
        ? single(admin.from('crm_customers').select('account_manager_id').eq('id', job.customerId).maybeSingle(), 'account_manager_id')
        : null,
    county: () => lookupCounty(job.workplace, { fetchImpl: options.fetchImpl }),
    countyUser: (county) => resolveRoutingUser(admin, county),
    fallback: () => single(admin.from('crm_portal_settings').select('fallback_user_id').eq('id', true).maybeSingle(), 'fallback_user_id'),
    canWrite: (userId) => userCanWriteWorkOrders(admin, userId),
  };
}
