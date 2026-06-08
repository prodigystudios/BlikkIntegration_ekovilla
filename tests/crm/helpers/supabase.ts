import { vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/route';
import { PERMISSION_KEYS, type PermissionKey } from '@/lib/auth/permissions';

/**
 * Builds a chainable Supabase query mock.
 *
 * Every method in the chain returns the same object (for fluent chaining).
 * The chain is also thenable so `await query` resolves to { data, error }.
 * `.single()` and `.maybeSingle()` return a real Promise to match Supabase v2 behaviour.
 */
export function makeQueryChain(result: { data: unknown; error: unknown }) {
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'or', 'ilike', 'like', 'filter', 'match',
    'order', 'limit', 'range',
  ] as const;

  const chain: Record<string, unknown> = {};

  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }

  // .single() / .maybeSingle() resolve to the result directly
  chain.single = vi.fn().mockResolvedValue(result);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);

  // Make the chain itself awaitable (for queries that don't end with .single())
  chain.then = (onfulfilled: (v: unknown) => unknown, onrejected: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onfulfilled, onrejected);

  return chain;
}

/**
 * Builds a minimal Supabase client mock where every `from()` call
 * returns the same query chain resolving to `result`.
 */
export function makeSupabaseMock(result: { data: unknown; error: unknown }) {
  const query = makeQueryChain(result);
  return {
    from: vi.fn().mockReturnValue(query),
    _query: query,
  };
}

// ---------------------------------------------------------------------------
// Auth stubs
// ---------------------------------------------------------------------------

export const salesUser: CurrentUser = { id: 'user-sales-1', role: 'sales' };
export const adminUser: CurrentUser = { id: 'user-admin-1', role: 'admin' };
export const memberUser: CurrentUser = { id: 'user-member-1', role: 'member' };
export const konsultUser: CurrentUser = { id: 'user-konsult-1', role: 'konsult' };

// Mirrors the role seed in supabase/sql/20260608_permissions_model.sql. Route guards now
// resolve effective permissions instead of reading the role directly, so route tests mock
// getEffectivePermissions with this to reproduce the same allow/deny outcomes per role.
const SALES_KEYS: PermissionKey[] = [
  'crm.prospect.read', 'crm.prospect.write', 'crm.call.read', 'crm.call.write',
  'crm.customer.read', 'crm.customer.write', 'crm.contact.read', 'crm.contact.write',
  'crm.opportunity.read', 'crm.opportunity.write', 'crm.offer.read', 'crm.offer.write',
  'crm.workorder.read', 'crm.workorder.write', 'crm.task.read', 'crm.task.write',
  'crm.report.read', 'crm.coach.read', 'crm.goal.read', 'crm.routingrule.read',
  'fortnox.offer.push', 'fortnox.workorder.push', 'fortnox.invoice.create', 'fortnox.customer.sync', 'fortnox.read',
  'crm.access', 'crm.write',
];
const KONSULT_KEYS: PermissionKey[] = [
  'crm.prospect.read', 'crm.call.read', 'crm.customer.read', 'crm.contact.read',
  'crm.opportunity.read', 'crm.offer.read', 'crm.workorder.read', 'crm.task.read',
  'crm.report.read', 'crm.coach.read', 'crm.goal.read', 'fortnox.read', 'crm.access',
];

export function effectivePermissionsForRole(role: string | undefined | null): Set<PermissionKey> {
  switch (role) {
    case 'admin': return new Set(PERMISSION_KEYS);
    case 'sales': return new Set(SALES_KEYS);
    case 'konsult': return new Set(KONSULT_KEYS);
    default: return new Set();
  }
}
