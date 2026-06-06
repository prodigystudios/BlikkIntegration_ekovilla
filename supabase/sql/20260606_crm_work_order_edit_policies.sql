-- Owner-scoped UPDATE/DELETE policies for work order time entries and comments.
--
-- These tables already had INSERT/SELECT policies (logging and listing work), but
-- lacked UPDATE/DELETE policies — so the session-scoped client silently matched zero
-- rows when editing/removing, surfacing as "hittades inte eller tillhör en annan
-- användare". A person may edit/delete only their own rows; ownership is also enforced
-- in the API layer (eq user_id / created_by).
--
-- NOTE: the base tables were created outside this repo (dashboard). This migration
-- starts documenting their access rules here; it is idempotent and safe to re-run.

-- ── Time entries ──────────────────────────────────────────────────────────────
alter table public.crm_work_order_time_entries enable row level security;

drop policy if exists "crm_wo_time_entries_update_own" on public.crm_work_order_time_entries;
create policy "crm_wo_time_entries_update_own"
  on public.crm_work_order_time_entries
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "crm_wo_time_entries_delete_own" on public.crm_work_order_time_entries;
create policy "crm_wo_time_entries_delete_own"
  on public.crm_work_order_time_entries
  for delete
  using (user_id = auth.uid());

-- ── Comments ──────────────────────────────────────────────────────────────────
alter table public.crm_work_order_comments enable row level security;

drop policy if exists "crm_wo_comments_update_own" on public.crm_work_order_comments;
create policy "crm_wo_comments_update_own"
  on public.crm_work_order_comments
  for update
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists "crm_wo_comments_delete_own" on public.crm_work_order_comments;
create policy "crm_wo_comments_delete_own"
  on public.crm_work_order_comments
  for delete
  using (created_by = auth.uid());
