# Permissions (RBAC)

Permission-based access control for the CRM + Fortnox surface. Roles are no longer checked
directly; instead a role is a *named bundle* of granular permissions, and access decisions —
in both the app layer and the database (RLS) — read the **same** effective-permission source.
That means changing who can do what (e.g. "let konsult write offers") is a **data change**,
not a code change across dozens of files.

> Scope today: **CRM + Fortnox**. The rest of the app (planning, documents, admin, contacts,
> news, dashboard) is still role-based and untouched — it will migrate the same way later
> (see [Migration status](#migration-status)).

---

## Core idea

A user's **effective permissions** = their role's bundle, **minus** per-user `revoke`
overrides, **plus** per-user `grant` overrides (revoke wins). This one set is consumed by:

- **The app layer** — `requirePermission('crm.offer.write')` in route handlers (via `can()`).
- **The database** — `has_permission('crm.offer.write')` inside RLS policies.

```
                       ┌─────────────────────────────┐
   role_permissions ──▶│  effective permissions       │◀── user_permissions
   (role → keys)       │  = role bundle − revoke +    │    (per-user grant/revoke)
                       │    grant                     │
                       └──────────────┬──────────────┘
                                      │ (single source of truth)
                  ┌───────────────────┴────────────────────┐
                  ▼                                         ▼
         TS: can() / requirePermission()          SQL: has_permission()  ← used in RLS
         (route guards, app/api/**)               (row-level security on the tables)
```

Because both layers read the same source, a granted permission flows **end-to-end** into the
database write. Because the role **seed reproduces today's behavior exactly**, the migration
was behavior-preserving and verifiable.

---

## Data model

`supabase/sql/20260608_permissions_model.sql` (additive; nothing existing changed).

| Object | Purpose |
| --- | --- |
| `permissions(key, description)` | Catalog of every known permission key. |
| `role_permissions(role, permission_key)` | A role's bundle (the seed). |
| `user_permissions(user_id, permission_key, effect)` | Per-user override, `effect` ∈ `grant`/`revoke` (one row per user+key; revoke wins). |
| `has_permission(p_key text) → boolean` | The RLS predicate. `STABLE` + `SECURITY DEFINER` → evaluated ~once per query and bypasses RLS on the three tables (no recursion). Logic: `NOT revoke AND (role bundle OR grant)`. |
| `effective_permissions() → setof text` | One-shot list for the app layer (one RPC per request). |
| `set_role_permission(role, key, present)` | Admin-only setter for a role bundle entry (`SECURITY DEFINER`, checks `auth.uid()` is admin). |
| `set_user_permission(user, key, effect)` | Admin-only setter for a per-user override (`effect=null` clears it). |

RLS on the three tables: `permissions` / `role_permissions` are readable by all authenticated
users; `user_permissions` is **self-read only**. No write policies exist — writes go only
through the `SECURITY DEFINER` setters. (The resolver functions are `SECURITY DEFINER`, so they
bypass these policies and there is no recursion — same pattern as the existing `set_user_role`.)

---

## Permission catalog

Keys are `resource.action` (plus three coarse meta keys). `lib/auth/permissions.ts` mirrors
this list as `PERMISSION_KEYS` (and derives the `PermissionKey` type from it, so typos are
caught at compile time).

**CRM resources** (each has `.read` + `.write`): `crm.prospect`, `crm.call`, `crm.customer`,
`crm.contact`, `crm.opportunity`, `crm.offer` (= quotes), `crm.workorder`, `crm.task`.

**CRM read-only:** `crm.report.read`, `crm.coach.read`.

**CRM admin-managed:** `crm.goal.read` / `crm.goal.manage`, `crm.routingrule.read` /
`crm.routingrule.manage`, `crm.aiprospect.read` / `crm.aiprospect.manage`,
`crm.ringlist.manage`, `crm.article.manage`, `crm.unit.manage`.

**Fortnox:** `fortnox.offer.push`, `fortnox.workorder.push`, `fortnox.invoice.create`,
`fortnox.customer.sync`, `fortnox.read`.

**Meta** (back the legacy `requireCrmUser/Writer/Admin` guards 1:1): `crm.access` (read),
`crm.write` (write), `crm.admin`.

---

## Role seed

The seed reproduces the pre-migration role behavior exactly. (Parity is asserted by
`supabase/sql/20260608_permissions_parity_assert.sql` — every row must show `ok = true`.)

| | member | sales | konsult | admin |
| --- | :-: | :-: | :-: | :-: |
| `crm.*.read` (all resources) + `crm.report.read` + `crm.coach.read` + `crm.goal.read` | – | ✓ | ✓ | ✓ |
| `crm.*.write` (all resources) | – | ✓ | – | ✓ |
| `crm.routingrule.read` | – | ✓ | **–** | ✓ |
| `crm.aiprospect.*` + every `.manage` key | – | – | – | ✓ |
| `fortnox.offer.push` / `workorder.push` / `invoice.create` / `customer.sync` | – | ✓ | – | ✓ |
| `fortnox.read` | – | ✓ | ✓ | ✓ |
| meta `crm.access` | – | ✓ | ✓ | ✓ |
| meta `crm.write` | – | ✓ | – | ✓ |
| meta `crm.admin` | – | – | – | ✓ |

**Asymmetries to remember:** `crm.routingrule.read` excludes konsult (its RLS SELECT did too);
`crm.aiprospect.*` is admin-only; `member` gets no CRM keys (installers reach their own work
orders via the `assigned_to` ownership branch, not via a role/permission).

---

## How the layers use it

### App layer (`lib/auth/permissions.ts` + `app/api/crm/_shared.ts`)

- `getEffectivePermissions()` calls `rpc('effective_permissions')`, **cached per request**
  (React `cache()`) so all guards in one request share one round-trip. **Fails closed** — on
  any error (e.g. migration not applied) it returns an empty set, so access is never granted
  by accident.
- `requirePermission(key)` → resolves the user, checks `can(perms, key)`, returns the standard
  `{ currentUser, response }` (401 / 403 / pass).
- The legacy guards are thin wrappers: `requireCrmUser → requirePermission('crm.access')`,
  `requireCrmWriter → 'crm.write'`, `requireCrmAdmin → 'crm.admin'`. Most routes still call
  these; the hot resource/Fortnox routes call `requirePermission` with an explicit key.

### Database (RLS)

Role predicates were swapped to `has_permission(...)` while the **ownership branches were
preserved** (`supabase/sql/20260609_rls_permissions_crm_*.sql`). The mapping rule (each key's
seed equals the role set the old predicate admitted, so behavior is identical):

| Old RLS predicate | New |
| --- | --- |
| `role = 'admin'` (see-all / manage / update-any / delete-any) | `has_permission('crm.admin')` |
| `role in ('sales','admin')` (write-self insert) | `has_permission('crm.<res>.write')` |
| `role = any('sales','admin','konsult')` (blanket read — quotes/work orders only) | `has_permission('crm.<res>.read')` |
| routing/goals/ai-prospect admin branches | the resource's `.read` / `.manage` key |
| `auth.uid() = assigned_to` / `user_id` / customer-ownership joins | **unchanged** |

---

## Managing permissions (admin UI)

**Admin → Behörigheter** (`app/admin/permissions/AdminPermissions.tsx`):

- **Rollbehörigheter** — pick a role, toggle its permission checkboxes. (The admin role is not
  editable here.)
- **Per användare** — pick a user; for each key set **Ärv** (no override) / **Ge** (grant) /
  **Neka** (revoke).

Backed by `app/api/admin/permissions/` (admin-gated). The `SECURITY DEFINER` setters are
called via the **session** client so `auth.uid()` is the calling admin; a user's overrides are
read via the service-role client (because `user_permissions` is self-read).

---

## Recipes

### Grant a user a specific permission

UI: Admin → Behörigheter → Per användare → pick the user → set the key to **Ge**. Or SQL:

```sql
select public.set_user_permission('<user-uuid>', 'crm.offer.write', 'grant'); -- or 'revoke', or null to clear
select public.set_role_permission('konsult', 'crm.offer.write', true);        -- whole role; false removes
```

For this to take effect end-to-end, the relevant route must guard on that key (see next) — RLS
already honors it.

### Add a new permission key

1. Add the key + description to the `permissions` insert in a new dated migration (or extend
   the catalog) **and** to `PERMISSION_KEYS` in `lib/auth/permissions.ts` (keep them in sync —
   the unit test guards the count).
2. Seed it onto the roles that should have it (`role_permissions`), and update the parity
   assert / `tests/auth/permissions.test.ts` if needed.
3. Use it: in a route via `requirePermission('<key>')`, and/or in an RLS policy via
   `has_permission('<key>')`.

### Guard a route with a granular key

```ts
const crmUser = await requirePermission('crm.offer.write');
if (crmUser.response || !crmUser.currentUser) return crmUser.response;
```

(`requirePermission` is re-exported from the relevant `_lib.ts` modules.) **Rule:** the key you
guard with should align with the table the route writes, so the route check and RLS agree.

### Migrate an RLS policy (for the later non-CRM phases)

Replace each `EXISTS(select 1 from public.profiles p where p.id = auth.uid() and p.role …)`
with `public.has_permission('<key>')` where the key's seed equals the roles that predicate
admitted. **Leave every ownership branch untouched.** Never widen. Read the *latest* policy
file per table (grep `on public.<table>` across **both** `supabase/sql/` and
`supabase/migrations/`, sort by date) — the filename does not tell you which table it edits.

---

## Deploy ordering ⚠️

`getEffectivePermissions` **fails closed**, so the SQL must be applied **before** the app code
is deployed (otherwise the RPC is missing and all CRM access 403s). Run, in order:

1. `20260608_permissions_model.sql`
2. `20260608_permissions_parity_assert.sql` — verify every row `ok = true`
3. `20260609_rls_permissions_crm_core.sql`
4. `20260609_rls_permissions_crm_quotes_workorders.sql`
5. `20260609_rls_permissions_crm_admin.sql`
6. `20260609_rls_permissions_verify.sql` — verify no row has `still_references_role = true`
7. `20260609_permissions_admin_lockout_guard.sql`

Then deploy the code.

---

## Admin lockout guard

`20260609_permissions_admin_lockout_guard.sql` prevents an admin from stripping their own admin
access: removing `crm.admin` from the admin role, or revoking `crm.admin` on an admin user,
both raise an exception (and the UI disables the latter). Recovery from a pre-existing lockout
is a manual delete of the offending `role_permissions` / `user_permissions` row.

---

## Migration status

| Phase | What | Status |
| --- | --- | --- |
| 1 | Model, resolver, seed, parity assert | ✅ |
| 2 | TS layer + guard wrappers + tests | ✅ |
| 3 | RLS swap (CRM/Fortnox tables) | ✅ |
| 4 | Granular route keys (resource writes + Fortnox actions) | ✅ |
| 5 | Admin UI + lockout guard | ✅ |
| 6 | The rest of the app (planning, documents, admin, contacts, news) | ⏳ later |

**Left on the `crm.write` meta key intentionally:** the prospects routes (they write
`crm_customers` — `crm_prospects` was removed), the tasks routes (their table isn't RLS-migrated
yet), and coach. Swap them to granular keys once those are reconciled.

---

## Gotchas

- **Meta vs resource key:** in routes still on a meta key, a per-user grant of a *resource* key
  (e.g. konsult `crm.offer.write`) is honored by RLS but the route's `crm.write` check still
  blocks it. Swap that route to the resource key (Phase 4 did this for the main ones).
- **`crm_prospects` is gone** (`20260604_crm_remove_legacy_prospects.sql`) — prospects are
  `crm_customers` with `customer_stage = 'prospect'`; `crm_calls`/`crm_quotes` join
  `crm_customers` via `prospect_id`.
- **Keep the catalog in sync** between the SQL `permissions` table and `PERMISSION_KEYS`.

---

## File reference

| Area | Files |
| --- | --- |
| Model + resolver + seed | `supabase/sql/20260608_permissions_model.sql`, `…_parity_assert.sql` |
| RLS swaps | `supabase/sql/20260609_rls_permissions_crm_{core,quotes_workorders,admin}.sql`, `…_verify.sql` |
| Lockout guard | `supabase/sql/20260609_permissions_admin_lockout_guard.sql` |
| App layer | `lib/auth/permissions.ts`, `app/api/crm/_shared.ts` (`requirePermission` + guard wrappers) |
| Admin UI | `app/admin/permissions/AdminPermissions.tsx`, `app/api/admin/permissions/**` |

## Related docs

- `ARCHITECTURE.md`, `API_CONVENTIONS.md`, `SUPABASE_CONVENTIONS.md`
