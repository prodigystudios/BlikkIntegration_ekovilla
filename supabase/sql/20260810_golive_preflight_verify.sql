-- Go-live preflight — READ ONLY. Safe to run in production; makes no changes.
--
-- Fas 0 in the field/CRM cutover plan. Everything in fas 1 (crew RLS + get_my_crm_jobs) is built on
-- top of the ops_* planning tables and the permissions model, so this answers the one question we
-- cannot answer from the repo: which of supabase/sql/* has actually been applied to production.
--
-- Run each section in the Supabase SQL editor. Every section states its expectation; anything that
-- deviates is a blocker for fas 1.

-- ── 1. Required tables ───────────────────────────────────────────────────────
-- Expectation: present = true for ALL rows.
with required(tbl) as (
  values
    -- new CRM-first planning (Wave 7)
    ('ops_trucks'), ('ops_segments'), ('ops_segment_crew'), ('ops_truck_crew'),
    ('ops_truck_default_crew'), ('ops_job_types'), ('ops_day_notes'),
    ('ops_depots'), ('ops_depot_deliveries'), ('ops_segment_reports'),
    ('ops_work_order_confirmations'), ('ops_activity_events'),
    -- CRM work orders + the field-view write targets
    ('crm_work_orders'), ('crm_work_order_time_entries'), ('crm_work_order_comments'),
    ('crm_work_order_invoices'),
    -- permissions model
    ('permissions'), ('role_permissions'), ('user_permissions'),
    -- legacy planning (still live during the drain — must NOT be dropped yet)
    ('planning_segments'), ('planning_trucks'), ('planning_project_meta')
)
select
  r.tbl,
  (to_regclass('public.' || r.tbl) is not null) as present
from required r
order by present, r.tbl;

-- ── 2. Columns fas 1 depends on ──────────────────────────────────────────────
-- Expectation:
--   ops_segments.work_order_id     → is_nullable = 'YES'  (placeholder cards, 20260613)
--   ops_segments.job_type          → present     (20260611_ops_segments_job_type)
--   ops_segments.placeholder_title → present     (20260613_ops_segments_placeholders)
--   ops_truck_crew.start_day/end_day, ops_truck_default_crew.role → present
--   profiles.blikk_id              → present     (needed to mirror time to Blikk)
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'ops_segments'            and column_name in ('work_order_id', 'truck_id', 'job_type', 'placeholder_title', 'start_day', 'end_day'))
    or (table_name = 'ops_segment_crew'     and column_name in ('segment_id', 'member_id'))
    or (table_name = 'ops_truck_crew'       and column_name in ('truck_id', 'member_id', 'start_day', 'end_day'))
    or (table_name = 'ops_truck_default_crew' and column_name in ('truck_id', 'member_id', 'role'))
    or (table_name = 'crm_work_orders'      and column_name in ('order_number', 'project_name', 'client_name', 'status', 'work_address', 'assigned_to'))
    or (table_name = 'profiles'             and column_name in ('blikk_id', 'role', 'full_name'))
  )
order by table_name, column_name;

-- ── 3. Required functions ────────────────────────────────────────────────────
-- Expectation: present = true for all. is_user_on_work_order is EXPECTED MISSING here —
-- it is what fas 1a adds; this row is the "before" baseline.
with required(fn) as (
  values ('has_permission'), ('get_my_jobs'), ('is_user_on_work_order')
)
select
  r.fn,
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = r.fn
  ) as present
from required r
order by r.fn;

-- ── 4. Planning permission keys + role grants ────────────────────────────────
-- Expectation: the four planning.* keys exist; admin has all four, sales has read+write,
-- konsult has read only, member has NONE (installers get access via fas 1a crew policies,
-- never via CRM permissions).
select p.key, coalesce(string_agg(rp.role, ', ' order by rp.role), '(no roles)') as granted_to
from public.permissions p
left join public.role_permissions rp on rp.permission_key = p.key
where p.key like 'planning.%' or p.key like 'crm.workorder.%'
group by p.key
order by p.key;

-- ── 5. Installer → Blikk mapping ─────────────────────────────────────────────
-- Expectation: missing_blikk_id = 0 for active installers. Anyone listed here will have their
-- CRM time entry saved but NOT mirrored to Blikk (fas 1e), so payroll would miss those hours.
select
  role,
  count(*)                                        as total,
  count(*) filter (where blikk_id is null)        as missing_blikk_id
from public.profiles
group by role
order by role;

select id, full_name, role
from public.profiles
where blikk_id is null and role in ('member', 'admin')
order by full_name;

-- ── 6. Current RLS on the field-view tables (the fas 1a "before" picture) ────
-- Expectation: crm_work_orders SELECT is assigned_to-or-permission only, and neither
-- time_entries nor comments has a crew-based policy. Fas 1a adds those, additively —
-- nothing listed here should disappear afterwards.
select tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('crm_work_orders', 'crm_work_order_time_entries', 'crm_work_order_comments')
order by tablename, cmd, policyname;

-- ── 7. Is there anything to test against? ────────────────────────────────────
-- Expectation: at least one scheduled CRM job with crew, otherwise fas 1 cannot be verified
-- end-to-end. If crew_members = 0 everywhere, assign a crew in /crm/planering first.
select
  s.id                as segment_id,
  s.start_day,
  s.end_day,
  t.name              as truck,
  wo.order_number,
  wo.project_name,
  (select count(*) from public.ops_segment_crew c where c.segment_id = s.id)                                     as segment_crew,
  (select count(*) from public.ops_truck_crew tc where tc.truck_id = s.truck_id
     and tc.start_day <= s.end_day and tc.end_day >= s.start_day)                                                as week_crew,
  (select count(*) from public.ops_truck_default_crew dc where dc.truck_id = s.truck_id)                         as default_crew
from public.ops_segments s
join public.ops_trucks t on t.id = s.truck_id
left join public.crm_work_orders wo on wo.id = s.work_order_id
where s.work_order_id is not null
order by s.start_day desc
limit 20;
