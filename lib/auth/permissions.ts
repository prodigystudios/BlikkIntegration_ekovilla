import { cache as reactCache } from 'react';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

// React's request-scoped cache() dedupes the RPC across every guard in one request. It's a
// server-only API; in non-server contexts (e.g. unit tests that import this module) it may be
// absent — fall back to identity so importing the module never throws. getEffectivePermissions
// isn't called in those contexts anyway.
const cache: typeof reactCache = typeof reactCache === 'function' ? reactCache : ((fn: any) => fn) as typeof reactCache;

// Permission-based access (RBAC), CRM + Fortnox scope. This is the TS half of the single
// source of truth defined in supabase/sql/20260608_permissions_model.sql: the same effective
// permissions that drive RLS (via has_permission()) drive the app guards here.
//
// PERMISSION_KEYS mirrors the SQL `permissions` catalog. Keep them in sync — the parity test
// (tests/auth/permissions.test.ts) guards the count, and PermissionKey is derived from this
// array so the compiler rejects typos at the call sites.

export const PERMISSION_KEYS = [
  // CRM resources (read + write)
  'crm.prospect.read', 'crm.prospect.write',
  'crm.call.read', 'crm.call.write',
  'crm.customer.read', 'crm.customer.write',
  'crm.contact.read', 'crm.contact.write',
  'crm.opportunity.read', 'crm.opportunity.write',
  'crm.offer.read', 'crm.offer.write',
  'crm.workorder.read', 'crm.workorder.write',
  'crm.task.read', 'crm.task.write',
  // CRM read-only surfaces
  'crm.report.read', 'crm.coach.read',
  // CRM admin-managed resources
  'crm.goal.read', 'crm.goal.manage',
  'crm.routingrule.read', 'crm.routingrule.manage',
  'crm.aiprospect.read', 'crm.aiprospect.manage',
  'crm.ringlist.manage', 'crm.article.manage', 'crm.unit.manage',
  // Fortnox actions
  'fortnox.offer.push', 'fortnox.workorder.push', 'fortnox.invoice.create',
  'fortnox.customer.sync', 'fortnox.read',
  // Coarse meta keys backing the legacy requireCrmUser/Writer/Admin guards 1:1
  'crm.access', 'crm.write', 'crm.admin',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

// Resolves the current user's effective permissions in ONE round-trip (the SQL function
// computes role bundle − revokes + grants). Wrapped in React cache() so every guard call in
// a single request shares the same RPC. Fails CLOSED (empty set) on any error — e.g. if the
// permission migration hasn't been applied yet — so access is never granted by accident.
export const getEffectivePermissions = cache(async (): Promise<Set<PermissionKey>> => {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await supabase.rpc('effective_permissions');
    if (error) {
      console.error('[permissions] effective_permissions RPC failed:', error.message);
      return new Set();
    }
    const keys = Array.isArray(data) ? data.map((row) => (typeof row === 'string' ? row : String(row))) : [];
    return new Set(keys as PermissionKey[]);
  } catch (e) {
    console.error('[permissions] effective_permissions threw:', (e as Error)?.message);
    return new Set();
  }
});

export function can(perms: Set<PermissionKey>, key: PermissionKey): boolean {
  return perms.has(key);
}
