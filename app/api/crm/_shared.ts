import { requirePermission, requireSignedInUser } from '@/lib/auth/guards';
// Generic HTTP response helpers live in one place; re-exported here so the existing CRM route
// imports (`from '../_shared'`) keep working unchanged.
import { ok, routeError, validationError, invalidUuidParam, isNoRowsError } from '@/lib/api/responses';

export { ok, routeError, validationError, invalidUuidParam, isNoRowsError };

// requirePermission/requireSignedInUser moved to lib/auth/guards.ts so non-CRM surfaces (time &
// payroll, admin) can gate without importing out of this folder. Re-exported unchanged — every
// existing `from '../_shared'` import keeps working.
export { requirePermission, requireSignedInUser };

// Keep only the fields the client actually sent. Zod schemas inject defaults for absent
// fields; persisting those on a partial PATCH would overwrite untouched columns with
// empties. The schema still validates the full (defaulted) object — we just write the
// sent subset. Shared by quote + work-order PATCH routes.
export function pickProvidedFields<T extends Record<string, unknown>>(parsed: T, rawBody: unknown): Partial<T> {
  const sentKeys = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? Object.keys(rawBody as object) : [];
  return Object.fromEntries(Object.entries(parsed).filter(([key]) => sentKeys.includes(key))) as Partial<T>;
}

// Legacy coarse guards, now thin wrappers over the permission layer. The seed in
// 20260608_permissions_model.sql gives crm.access to sales/konsult/admin, crm.write to
// sales/admin and crm.admin to admin — reproducing the old role checks exactly, so the ~170
// call sites are unchanged. Migrate hot routes to explicit per-resource keys over time.
export function requireCrmUser() {
  return requirePermission('crm.access');
}

// CRM WRITE access (sales/admin). konsult is read-only. Used on every CRM mutation.
export function requireCrmWriter() {
  return requirePermission('crm.write');
}

export function requireCrmAdmin() {
  return requirePermission('crm.admin');
}
