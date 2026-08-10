-- Field cutover fas 1a — let a scheduled crew member reach their own work order.
--
-- THE PROBLEM
-- The installer field view (app/arbetsorder/[id]) is fully built, but unreachable in practice.
-- crm_work_orders SELECT is `assigned_to = auth.uid() OR has_permission('crm.workorder.read')`,
-- and the member role has no CRM permission keys by design (20260608_permissions_model.sql).
-- So an installer who was put on a truck in /crm/planering gets zero rows — a 404 — and cannot
-- log time or comment either. Everything the office plans in CRM is invisible in the field.
--
-- THE FIX
-- Derive "is this person on this job" from the planning crew tables that already exist
-- (ops_segment_crew / ops_truck_crew / ops_truck_default_crew, joined to the work order through
-- ops_segments.work_order_id). No new mapping table is needed. Access is granted through ADDITIVE
-- policies: PostgreSQL OR-combines permissive policies, so nothing that works today changes.
-- Members still get NO CRM permission keys — this is a narrow, data-derived grant on their own job.
--
-- DEPLOY ORDER: run this BEFORE the fas 1 app code (fail-closed — without it the new "Mina jobb"
-- CRM rows would render but 404 on open). Run in the Supabase SQL editor. Idempotent.
--
-- Table-level grants are already in place for all three tables (20260530064347 + 20260629), so
-- this file only adds the row-level predicates.

-- ── Helper: is this user crew on this work order? ────────────────────────────
-- security definer because the caller (a member) has no planning.schedule.read and therefore
-- cannot read the ops_* crew tables under their own RLS. Kept `stable` so PostgreSQL can reuse
-- the result per (uid, work_order) within a statement when it appears in a row-level predicate.
--
-- Crew resolution mirrors the planning board exactly (crewForTruckInRange in
-- app/crm/planering/WeekBoard.tsx): a weekly crew on the truck OVERRIDES the standing default
-- crew for that period. Getting this backwards would show a job to someone who was replaced
-- for the week, so the default-crew branch is explicitly gated on "no weekly crew exists".
create or replace function public.is_user_on_work_order(p_uid uuid, p_wo uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ops_segments s
    where s.work_order_id = p_wo
      and p_uid is not null
      and (
        -- 1) explicitly added as crew on this segment
        exists (
          select 1
          from public.ops_segment_crew c
          where c.segment_id = s.id
            and c.member_id = p_uid
        )
        -- 2) on the truck's weekly crew, overlapping the segment's days
        or exists (
          select 1
          from public.ops_truck_crew tc
          where tc.truck_id = s.truck_id
            and tc.member_id = p_uid
            and tc.start_day <= s.end_day
            and tc.end_day   >= s.start_day
        )
        -- 3) on the truck's standing crew — ONLY when no weekly crew overrides that truck for
        --    the segment's period (weekly wins, same as the board)
        or (
          not exists (
            select 1
            from public.ops_truck_crew tc2
            where tc2.truck_id = s.truck_id
              and tc2.start_day <= s.end_day
              and tc2.end_day   >= s.start_day
          )
          and exists (
            select 1
            from public.ops_truck_default_crew dc
            where dc.truck_id = s.truck_id
              and dc.member_id = p_uid
          )
        )
      )
  );
$$;

revoke all on function public.is_user_on_work_order(uuid, uuid) from public;
grant execute on function public.is_user_on_work_order(uuid, uuid) to authenticated;

-- ── crm_work_orders: read your own job ───────────────────────────────────────
-- Read only. Editing the order stays with CRM roles (crm.workorder.write) — an installer can
-- open the field view but cannot change the order itself.
drop policy if exists crm_work_orders_select_crew on public.crm_work_orders;
create policy crm_work_orders_select_crew
  on public.crm_work_orders
  for select
  to authenticated
  using (public.is_user_on_work_order(auth.uid(), id));

-- ── crm_work_order_time_entries: see the job's time, log your own ────────────
-- SELECT covers the whole crew's entries on that job (the time tab renders the team's log, and
-- they are out there together anyway); INSERT is still self-only.
--
-- DORMANT BY DESIGN: the installer field view has NO time tab during the cutover. Blikk is still
-- the payroll system of record — a person reads the hours out of it before each payroll run — and
-- CRM cannot hand hours over yet (no absence/internal time, no travel allowance, no export). Time
-- logged in CRM would vanish from payroll, so all time keeps going through /tidrapport → Blikk
-- until fas 4 moves it across in one step. These policies are kept because they are correct and
-- are exactly what fas 4 needs; nothing in the field UI reaches them today.
drop policy if exists crm_wo_time_entries_select_crew on public.crm_work_order_time_entries;
create policy crm_wo_time_entries_select_crew
  on public.crm_work_order_time_entries
  for select
  to authenticated
  using (public.is_user_on_work_order(auth.uid(), work_order_id));

drop policy if exists crm_wo_time_entries_insert_crew on public.crm_work_order_time_entries;
create policy crm_wo_time_entries_insert_crew
  on public.crm_work_order_time_entries
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_user_on_work_order(auth.uid(), work_order_id)
  );

-- UPDATE/DELETE need no new policy: crm_wo_time_entries_update_own / _delete_own (20260606)
-- are already scoped to `user_id = auth.uid()` with no role predicate, so a crew member can
-- correct or remove their own entry as soon as they can create it.

-- ── crm_work_order_comments: read the thread, write to it ────────────────────
-- @-mention notifications for the field audience link to /arbetsorder/<id>
-- (lib/domains/notifications/payload.ts), which mounts this same thread — so without these the
-- notification lands on a page the recipient cannot read.
drop policy if exists crm_wo_comments_select_crew on public.crm_work_order_comments;
create policy crm_wo_comments_select_crew
  on public.crm_work_order_comments
  for select
  to authenticated
  using (public.is_user_on_work_order(auth.uid(), work_order_id));

drop policy if exists crm_wo_comments_insert_crew on public.crm_work_order_comments;
create policy crm_wo_comments_insert_crew
  on public.crm_work_order_comments
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.is_user_on_work_order(auth.uid(), work_order_id)
  );

-- UPDATE/DELETE likewise already covered by crm_wo_comments_update_own / _delete_own (20260606,
-- with the missing UPDATE grant fixed in 20260629).

-- ── Verification (run after applying) ────────────────────────────────────────
-- Expectation: the four *_crew policies below exist alongside — not instead of — the existing
-- assigned_to/permission policies.
--
--   select tablename, policyname, cmd
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('crm_work_orders', 'crm_work_order_time_entries', 'crm_work_order_comments')
--   order by tablename, cmd, policyname;
--
-- Spot-check the helper against a real scheduled job (should return true for crew, false for others):
--
--   select p.full_name, public.is_user_on_work_order(p.id, '<work_order_id>') as on_job
--   from public.profiles p
--   order by on_job desc, p.full_name;
