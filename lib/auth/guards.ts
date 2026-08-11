import { getCurrentUser } from './route';
import { can, getEffectivePermissions, type PermissionKey } from './permissions';
import { routeError } from '@/lib/api/responses';

// Route guards shared by every API surface. Born in app/api/crm/_shared.ts and moved here in
// fas 4 so non-CRM routes — time & payroll, admin — can gate without importing out of the CRM
// route folder. _shared.ts re-exports both, so the ~170 existing CRM call sites are unchanged.
//
// WHY ITS OWN MODULE, not lib/auth/route.ts: `getCurrentUser` must be called ACROSS a module
// boundary. The route tests (tests/crm/*.route.test.ts and friends) mock '@/lib/auth/route' to
// simulate "no session" / "member" / "sales"; vi.mock replaces a module's exports but cannot
// touch a call one module makes to itself. Put these guards in route.ts and the call becomes
// internal, the session mock stops applying, and ~65 guard tests silently start asserting
// against a real lookup instead. Keep the boundary.

// Permission-based gate. Resolves the user, then checks the effective permission set (role
// bundle ± per-user overrides) from the DB. Returns the { currentUser, response } shape every
// guard in the app uses. This is the single primitive the CRM role guards wrap, and the one new
// routes should call directly (e.g. requirePermission('time.approve')).
export async function requirePermission(key: PermissionKey) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return { currentUser: null, response: routeError(401, 'unauthorized', 'Unauthorized') };
  }

  const perms = await getEffectivePermissions();
  if (!can(perms, key)) {
    return { currentUser: null, response: routeError(403, 'forbidden', 'Forbidden') };
  }

  return { currentUser, response: null };
}

export async function requireSignedInUser() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return { currentUser: null, response: routeError(401, 'unauthorized', 'Unauthorized') };
  }

  return { currentUser, response: null };
}
