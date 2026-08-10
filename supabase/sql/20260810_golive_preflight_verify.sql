-- Go-live preflight — READ ONLY. Safe to run in production; makes no changes.
--
-- Fas 0 in the field/CRM cutover plan. Everything in fas 1 (crew RLS + get_my_crm_jobs) is built on
-- top of the ops_* planning tables and the permissions model, so this answers the one question the
-- repo cannot: what is actually applied to production, and is there anything to test against.
--
-- ONE statement on purpose. The Supabase SQL editor only shows the LAST result set, so a file of
-- separate SELECTs silently hides everything but the final one. Everything is folded into a single
-- consolidated table instead: run it once, read one list.
--
-- Read the `status` column:
--   BLOCKERARE — fas 1 must not be deployed until fixed
--   VARNING    — deployable, but something will not work as intended
--   INFO       — context, no action
--   OK         — as expected
-- Rows are ordered worst-first.

with
-- ── Required tables ─────────────────────────────────────────────────────────
required_tables(tbl, note) as (
  values
    ('ops_trucks', 'ny planering'), ('ops_segments', 'ny planering'),
    ('ops_segment_crew', 'ny planering'), ('ops_truck_crew', 'ny planering'),
    ('ops_truck_default_crew', 'ny planering'), ('ops_depots', 'ny planering'),
    ('ops_depot_deliveries', 'ny planering'),
    ('crm_work_orders', 'arbetsorder'), ('crm_work_order_time_entries', 'arbetsorder'),
    ('crm_work_order_comments', 'arbetsorder'),
    ('permissions', 'behörigheter'), ('role_permissions', 'behörigheter'),
    ('planning_segments', 'gamla planeringen — får INTE tas bort än'),
    ('planning_trucks', 'gamla planeringen — får INTE tas bort än')
),
table_checks as (
  select
    1 as sort,
    'Tabell' as kategori,
    r.tbl as kontroll,
    case when to_regclass('public.' || r.tbl) is not null then 'OK' else 'BLOCKERARE' end as status,
    r.note as detalj
  from required_tables r
),

-- ── Required columns ────────────────────────────────────────────────────────
column_checks as (
  select 2, 'Kolumn', 'ops_segments.work_order_id nullable',
    case
      when not exists (select 1 from information_schema.columns where table_schema='public' and table_name='ops_segments' and column_name='work_order_id') then 'BLOCKERARE'
      when exists (select 1 from information_schema.columns where table_schema='public' and table_name='ops_segments' and column_name='work_order_id' and is_nullable='YES') then 'OK'
      else 'BLOCKERARE'
    end,
    'platshållarkort (20260613) — annars vägrar get_my_crm_jobs'
  union all
  select 2, 'Kolumn', 'ops_segments.job_type',
    case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='ops_segments' and column_name='job_type') then 'OK' else 'BLOCKERARE' end,
    '20260611_ops_segments_job_type'
  union all
  select 2, 'Kolumn', 'profiles.blikk_id',
    case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='blikk_id') then 'OK' else 'BLOCKERARE' end,
    'krävs för att spegla tid till Blikk'
  union all
  select 2, 'Kolumn', 'crm_work_orders.fortnox_order_number',
    case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='crm_work_orders' and column_name='fortnox_order_number') then 'OK' else 'BLOCKERARE' end,
    'egenkontrollens ordersök + jobbfeedens referens'
  union all
  select 2, 'Kolumn', 'crm_work_order_time_entries.blikk_time_report_id',
    case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='crm_work_order_time_entries' and column_name='blikk_time_report_id') then 'OK' else 'INFO' end,
    'INFO före deploy — läggs till av 20260810_crm_time_entries_blikk_mirror.sql'
),

-- ── Required functions ──────────────────────────────────────────────────────
fn(name) as (values ('has_permission'), ('get_my_jobs')),
function_checks as (
  select 3, 'Funktion', f.name,
    case when exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname = f.name
    ) then 'OK' else 'BLOCKERARE' end,
    'måste finnas innan fas 1'
  from fn f
  union all
  select 3, 'Funktion', 'is_user_on_work_order',
    case when exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='is_user_on_work_order'
    ) then 'OK' else 'INFO' end,
    'INFO före deploy (läggs till av fas 1a) — OK betyder att den redan körts'
),

-- ── Permissions ─────────────────────────────────────────────────────────────
permission_checks as (
  select 4, 'Behörighet', 'planning.*-nycklar',
    case when (select count(*) from public.permissions where key like 'planning.%') >= 4 then 'OK' else 'BLOCKERARE' end,
    'hittade ' || (select count(*) from public.permissions where key like 'planning.%')::text || ' av 4'
  union all
  select 4, 'Behörighet', 'member saknar CRM-nycklar',
    case when (select count(*) from public.role_permissions where role::text='member' and permission_key like 'crm.%') = 0 then 'OK' else 'VARNING' end,
    'installatörer ska nå arbetsordern via besättning, inte via CRM-behörighet'
),

-- ── Blikk user mapping (payroll mirror) ─────────────────────────────────────
blikk_mapping as (
  select 5, 'Blikk-koppling', 'installatörer utan blikk_id',
    case when count(*) = 0 then 'OK' else 'VARNING' end,
    case when count(*) = 0 then 'alla mappade'
         else count(*)::text || ' st: ' || string_agg(coalesce(full_name, id::text), ', ' order by full_name) ||
              ' — deras tid sparas i CRM men speglas ALDRIG till Blikk (lönen missar timmarna)'
    end
  from public.profiles
  where blikk_id is null and role::text in ('member', 'admin')
),

-- ── Crew rows that can never resolve to a person ────────────────────────────
-- Crew tables allow a freetext row (member_name without member_id). The board renders those fine,
-- but is_user_on_work_order matches on member_id — so a freetext-only crew member will never see
-- their job. This is the most likely reason for "fas 1 verkar inte göra något".
freetext_crew as (
  select 6, 'Besättning', 'besättningsrader utan member_id',
    case when total = 0 then 'OK' else 'VARNING' end,
    case when total = 0 then 'alla besättningsrader pekar på en riktig användare'
         else total::text || ' rader är bara fritext — de personerna kan aldrig se sitt jobb'
    end
  from (
    select
      (select count(*) from public.ops_segment_crew where member_id is null)
      + (select count(*) from public.ops_truck_crew where member_id is null)
      + (select count(*) from public.ops_truck_default_crew where member_id is null) as total
  ) t
),

-- ── Is there anything for fas 1 to actually show? ───────────────────────────
-- The feed asks for current_date .. +30 days. A scheduled job with no resolvable crew is invisible
-- to everyone, so counting jobs is not enough — count jobs someone will actually see.
schedulable as (
  select
    s.id,
    exists (select 1 from public.ops_segment_crew c where c.segment_id = s.id and c.member_id is not null)
      or exists (
        select 1 from public.ops_truck_crew tc
        where tc.truck_id = s.truck_id and tc.member_id is not null
          and tc.start_day <= s.end_day and tc.end_day >= s.start_day
      )
      or (
        not exists (
          select 1 from public.ops_truck_crew tc2
          where tc2.truck_id = s.truck_id and tc2.start_day <= s.end_day and tc2.end_day >= s.start_day
        )
        and exists (select 1 from public.ops_truck_default_crew dc where dc.truck_id = s.truck_id and dc.member_id is not null)
      ) as has_crew
  from public.ops_segments s
  where s.work_order_id is not null
    and s.end_day >= current_date
    and s.start_day <= current_date + 30
),
testability as (
  select 7, 'Testdata', 'CRM-jobb kommande 30 dagar',
    case when count(*) = 0 then 'VARNING' else 'INFO' end,
    count(*)::text || ' schemalagda jobb i fönstret som feeden frågar efter'
  from schedulable
  union all
  -- Not a blocker on its own. Some lanes carry no crew by design ("Leveranser" is a display lane
  -- for things that need shipping, not a vehicle with a team), and a delivery correctly stays out
  -- of the installers' feed. It only matters if lanes that SHOULD have crew are showing zero —
  -- which the fleet check below answers.
  select 7, 'Testdata', '…varav någon faktiskt ser',
    case when count(*) filter (where has_crew) = 0 then 'VARNING' else 'OK' end,
    count(*) filter (where has_crew)::text || ' av ' || count(*)::text ||
    ' har besättning som går att matcha mot en användare. Är detta 0 visar /mina-jobb inga CRM-jobb'
    || ' — kontrollera mot bilarna nedan om det är väntat (bara leveranser schemalagda) eller ett glapp.'
  from schedulable
),

-- ── Fleet readiness ─────────────────────────────────────────────────────────
-- Which lanes will actually produce a visible job. Answers the question the count above cannot:
-- is "nobody sees anything" because only deliveries are booked, or because a real truck lost its
-- crew? Lanes with no crew at all are listed by name so they can be eyeballed.
fleet as (
  select
    t.name,
    (select count(*) from public.ops_truck_default_crew dc where dc.truck_id = t.id and dc.member_id is not null)
    + (select count(*) from public.ops_truck_crew tc where tc.truck_id = t.id and tc.member_id is not null
         and tc.end_day >= current_date and tc.start_day <= current_date + 30) as crew_count
  from public.ops_trucks t
  where t.active
),
fleet_checks as (
  select 8, 'Bilar', 'aktiva bilar med besättning',
    case when count(*) filter (where crew_count > 0) = 0 then 'BLOCKERARE' else 'INFO' end,
    count(*) filter (where crew_count > 0)::text || ' av ' || count(*)::text || ' aktiva banor har besättning'
    || case when count(*) filter (where crew_count = 0) > 0
         then '. Utan besättning: ' || (select string_agg(name, ', ' order by name) from fleet where crew_count = 0)
              || ' (leveransbanor väntas ligga här)'
         else '' end
  from fleet
),

all_checks as (
  select * from table_checks
  union all select * from column_checks
  union all select * from function_checks
  union all select * from permission_checks
  union all select * from blikk_mapping
  union all select * from freetext_crew
  union all select * from testability
  union all select * from fleet_checks
)
select
  status,
  kategori,
  kontroll,
  detalj
from all_checks
order by
  case status when 'BLOCKERARE' then 0 when 'VARNING' then 1 when 'INFO' then 2 else 3 end,
  sort,
  kontroll;

-- ── Detaljfrågor att köra separat vid behov ─────────────────────────────────
--
-- Vilka jobb är schemalagda, och med vilken besättning?
--   select s.start_day, s.end_day, t.name as truck, wo.order_number, wo.project_name,
--          (select count(*) from public.ops_segment_crew c where c.segment_id = s.id and c.member_id is not null) as segment_crew,
--          (select count(*) from public.ops_truck_crew tc where tc.truck_id = s.truck_id and tc.member_id is not null
--             and tc.start_day <= s.end_day and tc.end_day >= s.start_day) as week_crew,
--          (select count(*) from public.ops_truck_default_crew dc where dc.truck_id = s.truck_id and dc.member_id is not null) as default_crew
--   from public.ops_segments s
--   join public.ops_trucks t on t.id = s.truck_id
--   left join public.crm_work_orders wo on wo.id = s.work_order_id
--   where s.work_order_id is not null
--   order by s.start_day desc limit 20;
--
-- Nuvarande RLS på fältvyns tabeller (före-bilden; fas 1a lägger till, tar aldrig bort):
--   select tablename, policyname, cmd, qual, with_check
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('crm_work_orders', 'crm_work_order_time_entries', 'crm_work_order_comments')
--   order by tablename, cmd, policyname;
--
-- Efter fas 1a — ser en viss person rätt jobb?
--   select p.full_name, public.is_user_on_work_order(p.id, '<work_order_id>') as on_job
--   from public.profiles p order by on_job desc, p.full_name;
