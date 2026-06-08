-- Permission-based access control (RBAC) — model, resolver and seed.
--
-- Phase 1 of the role→permission migration (CRM + Fortnox scope). This file is ADDITIVE:
-- it introduces the permission tables, the resolver function used by both the app layer and
-- RLS, the admin setter functions, the permission catalog and a role seed that EXACTLY
-- reproduces today's role behavior. Nothing existing is changed here — no current policy or
-- route consumes these until later phases. Roles (profiles.role) stay the role pointer;
-- they now seed a permission bundle that individual users can extend/override.
--
-- Source of truth: a user's EFFECTIVE permissions = (role bundle) minus user 'revoke'
-- overrides plus user 'grant' overrides. Read by has_permission() in RLS and by the TS
-- can()/requirePermission() helpers — so a grant flows end-to-end into the database.
--
-- NOTE (deliberate omission): crm_work_order_time_entries and crm_work_order_comments are
-- purely ownership-based (no role check in RLS) and get NO permission key — their policies
-- stay untouched in the RLS phase.
--
-- Run in the Supabase SQL editor. Idempotent.

-- ── 1. Tables ────────────────────────────────────────────────────────────────

-- Catalog of all known permission keys (resource.action, e.g. 'crm.offer.write').
create table if not exists public.permissions (
  key         text primary key,
  description text not null default '',
  created_at  timestamptz not null default now()
);

-- Role → permission bundle (the seed sets below).
create table if not exists public.role_permissions (
  role           public.user_role not null,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role, permission_key)
);
create index if not exists role_permissions_role_idx on public.role_permissions(role);

-- Per-user override on top of the role bundle. effect='grant' adds, effect='revoke' removes
-- (revoke wins). One row per (user, key) so contradictory pairs are impossible.
create table if not exists public.user_permissions (
  user_id        uuid not null references auth.users(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  effect         text not null check (effect in ('grant','revoke')),
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  primary key (user_id, permission_key)
);
create index if not exists user_permissions_user_idx on public.user_permissions(user_id);

-- ── 2. RLS on the permission tables themselves ──────────────────────────────
-- Catalog + role bundles are non-secret and readable by all authenticated users; per-user
-- overrides are self-read only (mirrors profiles_select_self). No write policies exist —
-- all writes go through the SECURITY DEFINER setter functions below. The resolver functions
-- are SECURITY DEFINER too, so they bypass these policies entirely (no recursion).

alter table public.permissions      enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permissions enable row level security;

grant select on public.permissions      to authenticated;
grant select on public.role_permissions to authenticated;
grant select on public.user_permissions to authenticated;

drop policy if exists permissions_select_all on public.permissions;
create policy permissions_select_all on public.permissions
  for select to authenticated using (true);

drop policy if exists role_permissions_select_all on public.role_permissions;
create policy role_permissions_select_all on public.role_permissions
  for select to authenticated using (true);

drop policy if exists user_permissions_select_self on public.user_permissions;
create policy user_permissions_select_self on public.user_permissions
  for select to authenticated using (user_id = auth.uid());

-- ── 3. Resolver (single source of truth) ────────────────────────────────────
-- has_permission() is the predicate used inside RLS. STABLE + a constant key + constant
-- auth.uid() ⇒ Postgres evaluates it ~once per query (not per row); every internal lookup
-- is a PK point lookup. SECURITY DEFINER bypasses RLS on the three tables above → no
-- recursion (same pattern as set_user_role/handle_new_user).
create or replace function public.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- an explicit revoke always wins
    not exists (
      select 1 from public.user_permissions up
      where up.user_id = auth.uid() and up.permission_key = p_key and up.effect = 'revoke'
    )
    and (
      -- granted by the user's role bundle
      exists (
        select 1
        from public.profiles pr
        join public.role_permissions rp on rp.role = pr.role
        where pr.id = auth.uid() and rp.permission_key = p_key
      )
      -- or granted explicitly to the user
      or exists (
        select 1 from public.user_permissions up
        where up.user_id = auth.uid() and up.permission_key = p_key and up.effect = 'grant'
      )
    );
$$;
revoke all on function public.has_permission(text) from public;
grant execute on function public.has_permission(text) to authenticated;

-- One-shot effective-permission list for the app layer (one RPC per request).
create or replace function public.effective_permissions()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select rp.permission_key
  from public.profiles pr
  join public.role_permissions rp on rp.role = pr.role
  where pr.id = auth.uid()
  union
  select up.permission_key from public.user_permissions up
  where up.user_id = auth.uid() and up.effect = 'grant'
  except
  select up.permission_key from public.user_permissions up
  where up.user_id = auth.uid() and up.effect = 'revoke';
$$;
revoke all on function public.effective_permissions() from public;
grant execute on function public.effective_permissions() to authenticated;

-- ── 4. Admin setter functions (only path that writes the tables) ────────────
create or replace function public.set_role_permission(p_role public.user_role, p_key text, p_present boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.permissions where key = p_key) then
    raise exception 'unknown permission %', p_key;
  end if;
  if p_present then
    insert into public.role_permissions(role, permission_key) values (p_role, p_key)
    on conflict do nothing;
  else
    delete from public.role_permissions where role = p_role and permission_key = p_key;
  end if;
end;$$;
revoke all on function public.set_role_permission(public.user_role, text, boolean) from public;
grant execute on function public.set_role_permission(public.user_role, text, boolean) to authenticated;

-- p_effect: 'grant' | 'revoke' to set an override, NULL to clear it (fall back to the role).
create or replace function public.set_user_permission(p_user uuid, p_key text, p_effect text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'not authorized';
  end if;
  if not exists (select 1 from public.permissions where key = p_key) then
    raise exception 'unknown permission %', p_key;
  end if;
  if p_effect is null then
    delete from public.user_permissions where user_id = p_user and permission_key = p_key;
  elsif p_effect in ('grant','revoke') then
    insert into public.user_permissions(user_id, permission_key, effect, created_by)
    values (p_user, p_key, p_effect, auth.uid())
    on conflict (user_id, permission_key) do update
      set effect = excluded.effect, created_by = excluded.created_by;
  else
    raise exception 'invalid effect %', p_effect;
  end if;
end;$$;
revoke all on function public.set_user_permission(uuid, text, text) from public;
grant execute on function public.set_user_permission(uuid, text, text) to authenticated;

-- ── 5. Permission catalog (CRM + Fortnox scope) ─────────────────────────────
insert into public.permissions (key, description) values
  -- CRM resources (read + write)
  ('crm.prospect.read',     'CRM: view prospects'),
  ('crm.prospect.write',    'CRM: create/edit prospects'),
  ('crm.call.read',         'CRM: view calls'),
  ('crm.call.write',        'CRM: log/edit calls'),
  ('crm.customer.read',     'CRM: view customers'),
  ('crm.customer.write',    'CRM: create/edit customers'),
  ('crm.contact.read',      'CRM: view customer contacts'),
  ('crm.contact.write',     'CRM: create/edit customer contacts'),
  ('crm.opportunity.read',  'CRM: view opportunities'),
  ('crm.opportunity.write', 'CRM: create/edit opportunities'),
  ('crm.offer.read',        'CRM: view quotes/offers'),
  ('crm.offer.write',       'CRM: create/edit quotes/offers'),
  ('crm.workorder.read',    'CRM: view work orders'),
  ('crm.workorder.write',   'CRM: create/edit work orders'),
  ('crm.task.read',         'CRM: view tasks'),
  ('crm.task.write',        'CRM: create/edit tasks'),
  -- CRM read-only surfaces
  ('crm.report.read',       'CRM: view reporting'),
  ('crm.coach.read',        'CRM: use the AI coach'),
  -- CRM admin-managed resources
  ('crm.goal.read',         'CRM: view goals'),
  ('crm.goal.manage',       'CRM: set goals (admin)'),
  ('crm.routingrule.read',  'CRM: view lead-routing rules'),
  ('crm.routingrule.manage','CRM: manage lead-routing rules (admin)'),
  ('crm.aiprospect.read',   'CRM: view AI prospect suggestions (admin)'),
  ('crm.aiprospect.manage', 'CRM: review AI prospect suggestions (admin)'),
  ('crm.ringlist.manage',   'CRM: import/assign ring lists (admin)'),
  ('crm.article.manage',    'CRM: manage Fortnox articles (admin)'),
  ('crm.unit.manage',       'CRM: manage Fortnox units (admin)'),
  -- Fortnox bookkeeping actions
  ('fortnox.offer.push',     'Fortnox: push offers'),
  ('fortnox.workorder.push', 'Fortnox: push work orders/orders'),
  ('fortnox.invoice.create', 'Fortnox: create draft invoices'),
  ('fortnox.customer.sync',  'Fortnox: sync customers'),
  ('fortnox.read',           'Fortnox: read documents (PDF/email, registers)'),
  -- Coarse meta keys (back the existing requireCrmUser/Writer/Admin guards 1:1)
  ('crm.access', 'CRM: read access (any CRM role)'),
  ('crm.write',  'CRM: write access (sales/admin)'),
  ('crm.admin',  'CRM: admin access')
on conflict (key) do nothing;

-- ── 6. Role seed (reproduces today's behavior EXACTLY) ──────────────────────
-- admin → every key in the catalog.
insert into public.role_permissions (role, permission_key)
select 'admin'::public.user_role, key from public.permissions
on conflict do nothing;

-- sales → all reads + all writes + reports/coach + goal.read + routingrule.read + all
-- Fortnox actions + meta access/write. NOT: any .manage, aiprospect.*, crm.admin.
insert into public.role_permissions (role, permission_key) values
  ('sales','crm.prospect.read'),   ('sales','crm.prospect.write'),
  ('sales','crm.call.read'),       ('sales','crm.call.write'),
  ('sales','crm.customer.read'),   ('sales','crm.customer.write'),
  ('sales','crm.contact.read'),    ('sales','crm.contact.write'),
  ('sales','crm.opportunity.read'),('sales','crm.opportunity.write'),
  ('sales','crm.offer.read'),      ('sales','crm.offer.write'),
  ('sales','crm.workorder.read'),  ('sales','crm.workorder.write'),
  ('sales','crm.task.read'),       ('sales','crm.task.write'),
  ('sales','crm.report.read'),     ('sales','crm.coach.read'),
  ('sales','crm.goal.read'),       ('sales','crm.routingrule.read'),
  ('sales','fortnox.offer.push'),  ('sales','fortnox.workorder.push'),
  ('sales','fortnox.invoice.create'),('sales','fortnox.customer.sync'),
  ('sales','fortnox.read'),
  ('sales','crm.access'),          ('sales','crm.write')
on conflict do nothing;

-- konsult → read-only CRM. NOT: routingrule.read (RLS excludes konsult), aiprospect.read,
-- any write, any .manage, crm.write, crm.admin.
insert into public.role_permissions (role, permission_key) values
  ('konsult','crm.prospect.read'),
  ('konsult','crm.call.read'),
  ('konsult','crm.customer.read'),
  ('konsult','crm.contact.read'),
  ('konsult','crm.opportunity.read'),
  ('konsult','crm.offer.read'),
  ('konsult','crm.workorder.read'),
  ('konsult','crm.task.read'),
  ('konsult','crm.report.read'),
  ('konsult','crm.coach.read'),
  ('konsult','crm.goal.read'),
  ('konsult','fortnox.read'),
  ('konsult','crm.access')
on conflict do nothing;

-- member → no CRM/Fortnox keys (installer; today requireCrmUser rejects member, and their
-- work-order access is ownership-based via assigned_to, which stays untouched).

-- Done.
