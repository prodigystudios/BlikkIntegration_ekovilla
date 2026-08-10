-- Field cutover fas 1b — "my jobs" for the NEW CRM-first planning.
--
-- The legacy feed (get_my_jobs → user_my_jobs_v → planning_segments, Blikk) stays exactly as it
-- is; this is its CRM-side twin. /mina-jobb calls both and merges them (lib/domains/planning/myJobs.ts),
-- so the old rows drain toward zero as planning moves into CRM, with no big-bang cutover.
--
-- Shape and security deliberately mirror get_my_jobs
-- (supabase/sql/20251129_update_get_my_jobs_use_assignments.sql): one row per (segment, day in
-- range), security definer, locked down to `authenticated`.
--
-- DEPLOY ORDER: run AFTER 20260810_crm_work_order_crew_access.sql (this calls
-- is_user_on_work_order). Run in the Supabase SQL editor. Idempotent.

-- Drop first: the return type changes if this file is ever revised, and CREATE OR REPLACE
-- cannot change a function's OUT columns.
drop function if exists public.get_my_crm_jobs(date, date);

create function public.get_my_crm_jobs(start_date date default null, end_date date default null)
returns table (
  segment_id            uuid,
  work_order_id         uuid,
  order_number          text,
  fortnox_order_number  text,
  project_name          text,
  customer              text,
  job_day               date,
  start_day             date,
  end_day               date,
  truck                 text,
  truck_color           text,
  job_type              text,
  status                text,
  work_address          jsonb,
  customer_address      jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id            as segment_id,
    s.work_order_id,
    wo.order_number,
    wo.fortnox_order_number,
    wo.project_name,
    wo.client_name  as customer,
    gs.d::date      as job_day,
    s.start_day,
    s.end_day,
    t.name          as truck,
    t.color         as truck_color,
    s.job_type,
    wo.status,
    wo.work_address,
    -- Address fields ONLY. customer_snapshot also carries personnummer and pricing details, which
    -- an installer has no business receiving — so the snapshot is narrowed here rather than in the
    -- client. Shape matches what resolveJobAddress (lib/domains/planning/display.ts) expects, so
    -- address precedence stays defined in exactly one place (TypeScript), not duplicated in SQL.
    jsonb_build_object(
      'delivery_address',     wo.customer_snapshot ->> 'delivery_address',
      'delivery_postal_code', wo.customer_snapshot ->> 'delivery_postal_code',
      'delivery_city',        wo.customer_snapshot ->> 'delivery_city',
      'street_address',       wo.customer_snapshot ->> 'street_address',
      'postal_code',          wo.customer_snapshot ->> 'postal_code',
      'city',                 wo.customer_snapshot ->> 'city'
    ) as customer_address
  from public.ops_segments s
  -- inner join drops placeholder cards (ops_segments.work_order_id is nullable since
  -- 20260613_ops_segments_placeholders) — a booked day with no real order is not a field job yet
  join public.crm_work_orders wo on wo.id = s.work_order_id
  join public.ops_trucks t on t.id = s.truck_id
  -- one row per day of the segment, same as user_my_jobs_v
  cross join lateral generate_series(s.start_day, s.end_day, interval '1 day') as gs(d)
  where (start_date is null or gs.d::date >= start_date)
    and (end_date   is null or gs.d::date <= end_date)
    -- THE security boundary: security definer bypasses RLS on ops_*/crm_work_orders, so
    -- membership is what scopes the result. Same helper the RLS policies use, so the feed and
    -- the work order it links to can never disagree about who is on a job.
    and public.is_user_on_work_order(auth.uid(), s.work_order_id);
$$;

revoke all on function public.get_my_crm_jobs(date, date) from public;
grant execute on function public.get_my_crm_jobs(date, date) to authenticated;

-- NOTE (v1 scope): sack counts are intentionally omitted. They are derived from the work order's
-- line_items jsonb, which is awkward in SQL and already computed on the client by
-- lib/domains/crm/materials.ts. Add later if the field view needs it up front.

-- ── Verification (run after applying) ────────────────────────────────────────
-- As an installer session, this should return only jobs they are crew on:
--   select * from public.get_my_crm_jobs(current_date, current_date + 30);
--
-- As an admin, sanity-check that a specific person resolves the way the board shows them:
--   select p.full_name, count(*)
--   from public.profiles p
--   join public.ops_segments s on public.is_user_on_work_order(p.id, s.work_order_id)
--   where s.work_order_id is not null
--   group by p.full_name order by 2 desc;
