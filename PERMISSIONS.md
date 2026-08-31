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

> `crm.opportunity.*` är **vilande** sedan 2026-06-24: affärsmöjligheter togs bort (ersatta av Säljtavlan) men nycklarna behålls i `PERMISSION_KEYS` + DB-seed så paritets-asserten (`20260608_permissions_parity_assert.sql`) inte bryts. Inga route-/RLS-checkar använder dem längre. Ta bort dem bara om seed, `PERMISSION_KEYS` och paritets-oraklet städas samtidigt.

**CRM read-only:** `crm.report.read`, `crm.coach.read`.

**CRM admin-managed:** `crm.goal.read` / `crm.goal.manage`, `crm.routingrule.read` /
`crm.routingrule.manage`, `crm.aiprospect.read` / `crm.aiprospect.manage`,
`crm.ringlist.manage`, `crm.article.manage`, `crm.unit.manage`.

**Fortnox:** `fortnox.offer.push`, `fortnox.workorder.push`, `fortnox.invoice.create`,
`fortnox.customer.sync`, `fortnox.read`.

**Meta** (back the legacy `requireCrmUser/Writer/Admin` guards 1:1): `crm.access` (read),
`crm.write` (write), `crm.admin`.

**Time & payroll** (fas 4, seeded in `20260811_time_permissions.sql`): `time.entry.write`,
`time.entry.read.all`, `time.approve`, `time.payroll.read`, `time.reference.manage`, `time.entry.write.all`.

> Deliberately **not** `crm.*`. Time is company-wide — every employee reports it, including roles
> with no CRM access at all. A time key inside the CRM namespace would inherit the `crm.access` /
> `crm.write` meta guards and quietly lock installers out of their own hours. A unit test asserts
> the namespace stays separate.

**Planning** (Wave 7, seeded in `20260611_planning_permissions.sql`): `planning.schedule.read` /
`planning.schedule.write`, `planning.truck.manage`, `planning.depot.manage`.

---

## Role seed

The seed reproduces the pre-migration role behavior exactly. (Parity is asserted by
`supabase/sql/20260608_permissions_parity_assert.sql` — every row must show `ok = true`.)

| | member | sales | konsult | ekonomi | admin |
| --- | :-: | :-: | :-: | :-: | :-: |
| `crm.*.read` (all resources) + `crm.report.read` + `crm.coach.read` + `crm.goal.read` | – | ✓ | ✓ | – | ✓ |
| `crm.*.write` (all resources) | – | ✓ | – | – | ✓ |
| `crm.routingrule.read` | – | ✓ | **–** | – | ✓ |
| `crm.aiprospect.*` + every `.manage` key | – | – | – | – | ✓ |
| `fortnox.offer.push` / `workorder.push` / `invoice.create` / `customer.sync` | – | ✓ | – | – | ✓ |
| `fortnox.read` | – | ✓ | ✓ | – | ✓ |
| meta `crm.access` | – | ✓ | ✓ | – | ✓ |
| meta `crm.write` | – | ✓ | – | – | ✓ |
| meta `crm.admin` | – | – | – | – | ✓ |
| `time.entry.write` | **✓** | **✓** | – | – | ✓ |
| `time.entry.read.all` / `time.approve` / `time.payroll.read` | – | – | – | **✓** | ✓ |
| `time.reference.manage` / `time.entry.write.all` | – | – | – | – | ✓ |

**Asymmetries to remember:** `crm.routingrule.read` excludes konsult (its RLS SELECT did too);
`crm.aiprospect.*` is admin-only; `member` gets no CRM keys (installers reach their own work
orders via the `assigned_to` ownership branch, not via a role/permission).

**`time.entry.write` is the first key `member` has ever held**, and the first that isn't about the
CRM at all — every employee reports their own time. `konsult` gets nothing here: they are external
and time is personal data. If a supervisor (who is a `member`) ever needs to approve, grant the
override rather than inventing a role — **both keys, not just `time.approve`**:

```sql
select public.set_user_permission('<uuid>', 'time.approve', 'grant');
select public.set_user_permission('<uuid>', 'time.entry.read.all', 'grant');
```

⚠️ The approval surface is two reads behind two different guards: the month overview goes through
`time_approval_overview` (`time.approve`), and expanding a person goes through
`/api/admin/time/entries` (`time.entry.read.all` — that is the key the RLS policies open other
people's rows on). With only the first, the list loads and every expanded person answers
"Forbidden". `/ekonomi` therefore requires both and redirects otherwise, rather than rendering a
half-working page.

### `ekonomi` — the payroll bureau (2026-08-31)

The external payroll clerk who checks and locks the month. Her only surface is `/ekonomi`; her menu
has exactly one row, `/` redirects her straight to it, and she writes nothing.

⚠️ **"Sees no customer" holds for everything the menu offers — but not for two URLs typed by hand,
and that gap is older than this role.** `planning_segments_select` /
`planning_project_meta_select` are `auth.role() = 'authenticated'`
(`20251002_planning_schedule.sql:51`), and neither `/plannering` nor `/archive` has a server-side
role gate — `/plannering` is a pure client page. Any signed-in account can therefore read the legacy
planning board (customer name, email, phone) and the self-check archive. **This is unchanged by the
`ekonomi` role: every `member` has the same access today.** It is listed here because it is the one
claim about this role that the code does not fully enforce, and because adding an external party
raises the stakes on a pre-existing gap. Closing it is its own decision — it also determines what
installers should see.

⚠️ **"Writes nothing" is enforced in two places that must agree.** A role added to only one of them
is still able to write through the other:

| Guard | Covers |
| --- | --- |
| `isReadonlyRole` in `lib/auth/route.ts` (via `forbidIfReadonly`) | The six routes that reach for `getSupabaseAdmin()` and so bypass RLS entirely: planning `truck-assignments` create/update/delete, `day-notes`, `consume-bags`, and `work-orders/lookup` |
| `public.is_konsult_user()` in SQL (`NOT …` in the write policies) | The direct client path to `planning_segments`, `planning_project_meta` and their neighbours. `/plannering` is a pure client page with **no server-side role gate**, so this predicate is the only thing standing there |

The SQL function's name is historical — read it as "may not write". It is owned by
`20260831_ekonomi_role_seed.sql`, which added `ekonomi`; re-running the older
`20260121_add_readonly_role_and_planning_write_guard.sql` after it silently drops her from the list.

**Why a role and not the documented per-user override.** That recipe assumes a role that already
fits, with one key added on top. Here none fit, and they disagreed on the two axes that mattered:

| | in her own approval list? | reaches the CRM? |
| --- | :-: | :-: |
| `member` | **yes** — `time_approval_overview` only filters out `konsult`, so she'd be a permanent 0-hour row in the "nothing reported" filter | no |
| `konsult` | no | **yes, all of it** — `toEffectiveRole` maps konsult→sales and `app/crm/layout.tsx` admits sales |
| `admin` | yes | yes, plus user management and the permission editor |

The role also carries the **menu** (`app/_lib/appNav.ts` gates on role), which an override cannot.

**Role and key answer different questions, deliberately.** `/ekonomi` gates on `time.approve`, not
on the role — so admin reaches it without switching roles, and a supervisor with the per-user grant
above reaches it too. The consequence: someone granted the key without the role reaches the page by
URL but gets no menu row. Same deliberate gap `/tid` has.

⚠️ **She is an external party reading personal data.** Every employee's clock times, absence reasons
(sick leave, VAB, parental leave) and expense **receipt images**. That is a data-processing-agreement
question with the bureau, and it belongs settled before the account is created. Create her account
in Supabase and set the role in Admin → Användare — `/auth/create-account` is open self-signup and
issues `member`.

---

## How the layers use it

### App layer (`lib/auth/permissions.ts` + `lib/auth/guards.ts`)

- `getEffectivePermissions()` calls `rpc('effective_permissions')`, **cached per request**
  (React `cache()`) so all guards in one request share one round-trip. **Fails closed** — on
  any error (e.g. migration not applied) it returns an empty set, so access is never granted
  by accident.
- `requirePermission(key)` → resolves the user, checks `can(perms, key)`, returns the standard
  `{ currentUser, response }` (401 / 403 / pass).
- The legacy guards are thin wrappers: `requireCrmUser → requirePermission('crm.access')`,
  `requireCrmWriter → 'crm.write'`, `requireCrmAdmin → 'crm.admin'`. Most routes still call
  these; the hot resource/Fortnox routes call `requirePermission` with an explicit key.
- `requirePermission` / `requireSignedInUser` live in **`lib/auth/guards.ts`**, not in
  `lib/auth/route.ts` beside `getCurrentUser`, and not in `app/api/crm/_shared.ts` where they
  were born. Non-CRM routes (time & payroll, admin) gate without importing out of the CRM
  folder; `_shared.ts` re-exports both so every existing CRM import is unchanged. **Keep the
  module boundary:** the guard must call `getCurrentUser` *across* modules, because the route
  tests mock `@/lib/auth/route` to simulate no-session/member/sales. `vi.mock` replaces a
  module's exports but cannot intercept a call a module makes to itself — merging the two files
  makes the session mock stop applying, and ~65 guard tests start asserting against a real
  lookup instead of the scenario they name.

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

### Crew access — the one path that is NOT permission-based ⚠️

`supabase/sql/20260810_crm_work_order_crew_access.sql` (field/CRM cutover).

Installers (`member`) have **no CRM permission keys, deliberately** — and that must stay true.
But they have to reach the work order they are scheduled on. That access is **derived from data,
not granted by a key**: `is_user_on_work_order(uid, work_order_id)` asks the planning crew tables
(`ops_segment_crew` / `ops_truck_crew` / `ops_truck_default_crew`, joined to the order through
`ops_segments.work_order_id`) whether this person is on this job.

| | |
| --- | --- |
| **Tables** | `crm_work_orders` (SELECT), `crm_work_order_time_entries` (SELECT + INSERT), `crm_work_order_comments` (SELECT + INSERT) |
| **Policies** | `*_crew`, **additive** — Postgres OR-combines permissive policies, so the existing `assigned_to` / `has_permission` policies are untouched and nobody loses access |
| **Resolution** | Weekly truck crew **overrides** the standing default crew, resolved per **ISO week** to match `crewForTruckInRange` in `app/crm/planering/WeekBoard.tsx` |
| **Helper** | `security definer` (the caller has no `planning.schedule.read`), `revoke from public`, `grant execute to authenticated` |

Two consequences worth remembering:

- **RLS is row-level and cannot narrow columns.** `crmWorkOrderSelect` carries
  `customer_snapshot.personal_number` and `rot_details.personal_number`, so a crew SELECT policy
  alone would hand personnummer to installers. The column-level line is drawn in
  `redactWorkOrderForField` (`lib/domains/crm/work-orders.ts`), applied in
  `GET /api/crm/work-orders/[id]` for `role === 'member'`. **Any new field-facing route on a CRM
  table must do the same.**
- **The time-entry policies are dormant on purpose.** The field view has no time tab while Blikk
  still owns payroll; the policies exist because they are correct and are what the CRM time
  migration needs.

`is_user_on_work_order` is callable by any authenticated user with an arbitrary uid, so an
employee can probe who is on which job. Accepted: employees-only, and the planning board already
shows crew to anyone with `planning.schedule.read`.

**What it costs (measured 2026-08-11, question closed).** A row-dependent predicate can be evaluated
once per row, which would have made the CRM work-order list — and especially the six `count(*)` chip
queries, which have no `LIMIT` to stop early — scale badly. It doesn't: the plan's filter evaluates
`assigned_to = auth.uid()` → `has_permission(...)` → `is_user_on_work_order(...)`, and for
sales/admin the middle arm is true, so the OR short-circuits and the crew function is **never called
on the office path**, at any table size. A `member` has no permission key, so their read does fall
through to the crew branch — correct, it's their only way in, and it is scoped to their own jobs.
Re-measure after PostgreSQL upgrades: arm order is not guaranteed. Probe and method:
`supabase/sql/20260811_crm_work_order_rls_perf_probe.sql`, `SUPABASE_CONVENTIONS.md` →
"Measuring what a policy costs".

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

**The same rule applies to every later key.** Adding a key to `PERMISSION_KEYS` and shipping the
route that guards on it before the row exists in the database means the guard denies everyone —
fail-closed is a safety property, not a grace period. Later additions, each SQL-first:

- `20260611_planning_permissions.sql` — planning (Wave 7)
- `20260811_time_permissions.sql` — time & payroll (fas 4)
- `20260831_ekonomi_role.sql` **then, as a separate run**, `20260831_ekonomi_role_seed.sql` — the
  payroll role. ⚠️ Two files is not a formatting choice: `role_permissions.role` is typed
  `public.user_role`, and PostgreSQL refuses to *use* an enum value in the same transaction that
  added it. Run them together and the seed fails.

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
- **Not all access is a permission key.** Crew access to work orders is derived from the planning
  tables (see above), so "member has no CRM keys" does *not* mean "member cannot read a work
  order". Grep for `is_user_on_work_order` before reasoning about who can see what.
- **`profiles` is self-read-only, and no permission key changes that.** `profiles_select_self`
  (`auth_roles_setup.sql:71`) is the *only* SELECT policy: `USING (auth.uid() = id)`. It predates
  this model and is unrelated to it — a leftover from a recursion bugfix, not a privacy decision.
  Two consequences that surprise people: a PostgREST embed such as `author:profiles(full_name)`
  silently returns `null` for every row but your own (it reads as a missing name, not as an error),
  and ~17 files therefore elevate to service-role just to resolve a colleague's name. **A granted
  permission key does not help here** — the policy never consults one. The rebuild plan, including
  why the fix is to move `profiles`' private columns rather than to add a directory view, is
  `PROFILES_DIRECTORY_PLAN.md`.
- **Signed in ≠ employee.** `/auth/create-account` is open self-signup and issues `role = 'member'`,
  the same role an installer has. Any guard that is only `requireSignedInUser` is therefore reachable
  by a stranger who finds the URL — `/api/crm/work-orders/mention-users` currently answers such a
  caller with the full staff list. Verify the Supabase sign-up setting before widening any read.

---

## File reference

| Area | Files |
| --- | --- |
| Model + resolver + seed | `supabase/sql/20260608_permissions_model.sql`, `…_parity_assert.sql` |
| RLS swaps | `supabase/sql/20260609_rls_permissions_crm_{core,quotes_workorders,admin}.sql`, `…_verify.sql` |
| Lockout guard | `supabase/sql/20260609_permissions_admin_lockout_guard.sql` |
| Crew access (non-key) | `supabase/sql/20260810_crm_work_order_crew_access.sql`, `redactWorkOrderForField` in `lib/domains/crm/work-orders.ts` |
| Policy cost probe | `supabase/sql/20260811_crm_work_order_rls_perf_probe.sql` (create → run → drop; measures under impersonation) |
| App layer | `lib/auth/permissions.ts` (catalog + resolver), `lib/auth/guards.ts` (`requirePermission`, `requireSignedInUser`), `app/api/crm/_shared.ts` (re-export + legacy CRM wrappers) |
| Time & payroll keys | `supabase/sql/20260811_time_permissions.sql` |
| Payroll role (`ekonomi`) | `supabase/sql/20260831_ekonomi_role.sql` + `…_seed.sql`, `app/ekonomi/page.tsx` (the `time.approve` gate), `app/_lib/appNav.ts` (the menu row) |
| Time approval (fas 4.4) | `supabase/sql/20260812_time_approvals.sql` — no new keys, but `time.approve` gains teeth: the transition RPC `set_time_period_status` and the `security definer` read model `time_approval_overview` both check it internally, and the write policies on `crm_time_entries` / `crm_time_compensations` gain `not is_time_locked(...)` |
| Admin UI | `app/admin/permissions/AdminPermissions.tsx`, `app/api/admin/permissions/**` |

## Related docs

- `ARCHITECTURE.md`, `API_CONVENTIONS.md`, `SUPABASE_CONVENTIONS.md`
