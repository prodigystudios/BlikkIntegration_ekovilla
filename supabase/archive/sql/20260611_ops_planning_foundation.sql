-- Wave 7 — new CRM-first planning: scheduling foundation (slice 1 walking skeleton).
--
-- Fresh scheduling schema, fully independent of the old planning_* tables (which stay live on
-- Blikk until cutover). Jobs scheduled here ARE CRM work orders: ops_segments.work_order_id →
-- crm_work_orders.id. The "is it scheduled" state lives here, NEVER on the work order, so the
-- CRM stays the source of the job and planning owns the schedule.
--
-- RLS + indexes from day one (deliberately designing away the old planning_truck_assignments
-- RLS gap rather than inheriting it).
--
-- DEPLOY ORDER: run AFTER 20260611_planning_permissions.sql (RLS predicates call
-- has_permission('planning.*')). Run in the Supabase SQL editor. Idempotent.

-- ── ops_trucks ───────────────────────────────────────────────────────────────
create table if not exists public.ops_trucks (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.ops_trucks enable row level security;
grant select, insert, update, delete on public.ops_trucks to authenticated;

drop policy if exists ops_trucks_select on public.ops_trucks;
create policy ops_trucks_select on public.ops_trucks
  for select to authenticated
  using (public.has_permission('planning.schedule.read'));

drop policy if exists ops_trucks_insert on public.ops_trucks;
create policy ops_trucks_insert on public.ops_trucks
  for insert to authenticated
  with check (public.has_permission('planning.truck.manage'));

drop policy if exists ops_trucks_update on public.ops_trucks;
create policy ops_trucks_update on public.ops_trucks
  for update to authenticated
  using (public.has_permission('planning.truck.manage'))
  with check (public.has_permission('planning.truck.manage'));

drop policy if exists ops_trucks_delete on public.ops_trucks;
create policy ops_trucks_delete on public.ops_trucks
  for delete to authenticated
  using (public.has_permission('planning.truck.manage'));

-- ── ops_segments ─────────────────────────────────────────────────────────────
-- One scheduled placement of a CRM work order on a truck across a day-range. A work order can
-- have several segments (multi-day / multi-truck) — coverage is computed from these rows.
create table if not exists public.ops_segments (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.crm_work_orders(id) on delete cascade,
  truck_id      uuid not null references public.ops_trucks(id) on delete restrict,
  start_day     date not null,
  end_day       date not null,
  sort_index    integer not null default 0,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ops_segments_day_range_check check (end_day >= start_day)
);

create index if not exists ops_segments_truck_range_idx on public.ops_segments (truck_id, start_day, end_day);
create index if not exists ops_segments_work_order_idx  on public.ops_segments (work_order_id);

alter table public.ops_segments enable row level security;
grant select, insert, update, delete on public.ops_segments to authenticated;

drop policy if exists ops_segments_select on public.ops_segments;
create policy ops_segments_select on public.ops_segments
  for select to authenticated
  using (public.has_permission('planning.schedule.read'));

drop policy if exists ops_segments_insert on public.ops_segments;
create policy ops_segments_insert on public.ops_segments
  for insert to authenticated
  with check (created_by = auth.uid() and public.has_permission('planning.schedule.write'));

drop policy if exists ops_segments_update on public.ops_segments;
create policy ops_segments_update on public.ops_segments
  for update to authenticated
  using (public.has_permission('planning.schedule.write'))
  with check (public.has_permission('planning.schedule.write'));

drop policy if exists ops_segments_delete on public.ops_segments;
create policy ops_segments_delete on public.ops_segments
  for delete to authenticated
  using (public.has_permission('planning.schedule.write'));

create or replace function public.set_timestamp_ops_segments()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists set_timestamp_ops_segments on public.ops_segments;
create trigger set_timestamp_ops_segments
before update on public.ops_segments
for each row execute procedure public.set_timestamp_ops_segments();

-- ── seed a few trucks for the skeleton (only when the table is empty) ─────────
insert into public.ops_trucks (name, color)
select v.name, v.color
from (values ('Bil 1', '#2563eb'), ('Bil 2', '#16a34a'), ('Bil 3', '#d97706')) as v(name, color)
where not exists (select 1 from public.ops_trucks);
