-- ops-policyerna (nya planeringen och lagret) anropar auth.uid() och has_permission() EN gång per fråga i stället
-- för en gång per rad.
--
-- Del 3 av advisor-genomgången, domän 2 av 3: ops_* (16 tabeller). Samma omskrivning, kontroller och skäl som CRM i
-- 20260926142144_crm_policy_initplan.sql — se den och scripts/supabase/policy-initplan-rewrite.sql. Genererad så här
-- mot den lokala databasen (i paritet med prod):
--   docker exec -i supabase_db_BlikkIntegration_ekovilla psql -U postgres -X -q -At -v tables='^ops_' \
--     -f - < scripts/supabase/policy-initplan-rewrite.sql
--
-- planning_* rörs INTE: alla hör till eller delas med gamla /plannering och avgörs i legacy-städningen.
--
-- Ändrar INTE vem som ser eller skriver vad: `(select f())` är samma värde som `f()` när f saknar radargument och är
-- STABLE. Förkontrollen avbryter om någon policy i prod skiljer sig från den omskrivningen utgår från; efterkontrollen
-- bevisar att policyn med inslagningen borttagen är tecken för tecken originalet.
--
-- Idempotent, kan köras om.

-- pg_get_expr skriver ut schemanamn för allt som inte syns i sökvägen; kontrollerna nedan förutsätter den här.
set local search_path = public, extensions;

-- Varje policys original (md5 av texten med all inslagning borttagen), som för- och efterkontrollen jämför mot.
create temp table __initplan_expected (tbl text, pol text, md5_q text, md5_c text);
insert into __initplan_expected values
  ('ops_activity_events', 'ops_activity_events_insert', NULL, 'a5cbb059a70a6d1e712c4515b20d7a0d'),
  ('ops_activity_events', 'ops_activity_events_select', '591e023352c223f9ae4fc067ccf8c14a', NULL),
  ('ops_day_notes', 'ops_day_notes_delete', 'e255bf036a92d9eae0f61108830e88fe', NULL),
  ('ops_day_notes', 'ops_day_notes_insert', NULL, 'e8430dc37ae593310e5c3715294168ec'),
  ('ops_day_notes', 'ops_day_notes_select', '591e023352c223f9ae4fc067ccf8c14a', NULL),
  ('ops_day_notes', 'ops_day_notes_update', 'e255bf036a92d9eae0f61108830e88fe', 'e255bf036a92d9eae0f61108830e88fe'),
  ('ops_depot_deliveries', 'ops_depot_deliveries_delete', 'e255bf036a92d9eae0f61108830e88fe', NULL),
  ('ops_depot_deliveries', 'ops_depot_deliveries_insert', NULL, 'e8430dc37ae593310e5c3715294168ec'),
  ('ops_depot_deliveries', 'ops_depot_deliveries_select', '591e023352c223f9ae4fc067ccf8c14a', NULL),
  ('ops_depot_deliveries', 'ops_depot_deliveries_update', 'e255bf036a92d9eae0f61108830e88fe', 'e255bf036a92d9eae0f61108830e88fe'),
  ('ops_depot_stock_counts', 'ops_depot_stock_counts_insert', NULL, 'e61e81cb4176be4530689b59f8edb43b'),
  ('ops_depot_stock_counts', 'ops_depot_stock_counts_select', '591e023352c223f9ae4fc067ccf8c14a', NULL),
  ('ops_depots', 'ops_depots_delete', 'c12bc262f73b30e695596ca55cac3035', NULL),
  ('ops_depots', 'ops_depots_insert', NULL, 'c12bc262f73b30e695596ca55cac3035'),
  ('ops_depots', 'ops_depots_select', '591e023352c223f9ae4fc067ccf8c14a', NULL),
  ('ops_depots', 'ops_depots_update', 'c12bc262f73b30e695596ca55cac3035', 'c12bc262f73b30e695596ca55cac3035'),
  ('ops_expected_deliveries', 'ops_expected_deliveries_delete', 'c3d794d182bff88b6d432ed6fb4ea30b', NULL),
  ('ops_expected_deliveries', 'ops_expected_deliveries_insert', NULL, '4a550a9d8b75fb63f5b9507ad94b45a3'),
  ('ops_expected_deliveries', 'ops_expected_deliveries_select', '591e023352c223f9ae4fc067ccf8c14a', NULL),
  ('ops_expected_deliveries', 'ops_expected_deliveries_update', 'c12bc262f73b30e695596ca55cac3035', 'c12bc262f73b30e695596ca55cac3035'),
  ('ops_job_types', 'ops_job_types_delete', '29ca3788f165e2b237cbfdf11dc6525d', NULL),
  ('ops_job_types', 'ops_job_types_insert', NULL, '29ca3788f165e2b237cbfdf11dc6525d'),
  ('ops_job_types', 'ops_job_types_select', '591e023352c223f9ae4fc067ccf8c14a', NULL),
  ('ops_job_types', 'ops_job_types_update', '29ca3788f165e2b237cbfdf11dc6525d', '29ca3788f165e2b237cbfdf11dc6525d'),
  ('ops_material_orders', 'ops_material_orders_delete', 'b241ace76827717486852cd85d69f36a', NULL),
  ('ops_material_orders', 'ops_material_orders_insert', NULL, '19bc366c5e60f805df5ae8fef19a10a3'),
  ('ops_material_orders', 'ops_material_orders_select', 'c12bc262f73b30e695596ca55cac3035', NULL),
  ('ops_material_orders', 'ops_material_orders_update', 'd35ca78196ed6ecf5d496f5a58a40967', 'd35ca78196ed6ecf5d496f5a58a40967'),
  ('ops_material_suppliers', 'ops_material_suppliers_delete', 'c12bc262f73b30e695596ca55cac3035', NULL),
  ('ops_material_suppliers', 'ops_material_suppliers_insert', NULL, 'd6a86e90c5bf7a7a2eadb614a95924ef'),
  ('ops_material_suppliers', 'ops_material_suppliers_select', 'c12bc262f73b30e695596ca55cac3035', NULL),
  ('ops_material_suppliers', 'ops_material_suppliers_update', 'c12bc262f73b30e695596ca55cac3035', 'c12bc262f73b30e695596ca55cac3035'),
  ('ops_segment_crew', 'ops_segment_crew_delete', 'e255bf036a92d9eae0f61108830e88fe', NULL),
  ('ops_segment_crew', 'ops_segment_crew_insert', NULL, 'e8430dc37ae593310e5c3715294168ec'),
  ('ops_segment_crew', 'ops_segment_crew_select', '591e023352c223f9ae4fc067ccf8c14a', NULL),
  ('ops_segment_crew', 'ops_segment_crew_update', 'e255bf036a92d9eae0f61108830e88fe', 'e255bf036a92d9eae0f61108830e88fe'),
  ('ops_segment_reports', 'ops_segment_reports_delete', 'e255bf036a92d9eae0f61108830e88fe', NULL),
  ('ops_segment_reports', 'ops_segment_reports_delete_own_partial', 'eff619aa7710964e39a111ecb4c225ad', NULL),
  ('ops_segment_reports', 'ops_segment_reports_insert', NULL, 'e8430dc37ae593310e5c3715294168ec'),
  ('ops_segment_reports', 'ops_segment_reports_insert_crew', NULL, '7466d0a9d9822662218d3d386905f8e1'),
  ('ops_segment_reports', 'ops_segment_reports_select', '591e023352c223f9ae4fc067ccf8c14a', NULL),
  ('ops_segment_reports', 'ops_segment_reports_select_crew', '14318e2211b2bb6b5cc62740fe66f661', NULL),
  ('ops_segment_reports', 'ops_segment_reports_update', 'e255bf036a92d9eae0f61108830e88fe', 'e255bf036a92d9eae0f61108830e88fe'),
  ('ops_segments', 'ops_segments_delete', 'e255bf036a92d9eae0f61108830e88fe', NULL),
  ('ops_segments', 'ops_segments_insert', NULL, 'e8430dc37ae593310e5c3715294168ec'),
  ('ops_segments', 'ops_segments_select', '591e023352c223f9ae4fc067ccf8c14a', NULL),
  ('ops_segments', 'ops_segments_update', 'e255bf036a92d9eae0f61108830e88fe', 'e255bf036a92d9eae0f61108830e88fe'),
  ('ops_truck_crew', 'ops_truck_crew_delete', 'e255bf036a92d9eae0f61108830e88fe', NULL),
  ('ops_truck_crew', 'ops_truck_crew_insert', NULL, 'e8430dc37ae593310e5c3715294168ec'),
  ('ops_truck_crew', 'ops_truck_crew_select', '591e023352c223f9ae4fc067ccf8c14a', NULL),
  ('ops_truck_crew', 'ops_truck_crew_update', 'e255bf036a92d9eae0f61108830e88fe', 'e255bf036a92d9eae0f61108830e88fe'),
  ('ops_truck_default_crew', 'ops_truck_default_crew_delete', 'e255bf036a92d9eae0f61108830e88fe', NULL),
  ('ops_truck_default_crew', 'ops_truck_default_crew_insert', NULL, 'e8430dc37ae593310e5c3715294168ec'),
  ('ops_truck_default_crew', 'ops_truck_default_crew_select', '591e023352c223f9ae4fc067ccf8c14a', NULL),
  ('ops_truck_default_crew', 'ops_truck_default_crew_update', 'e255bf036a92d9eae0f61108830e88fe', 'e255bf036a92d9eae0f61108830e88fe'),
  ('ops_trucks', 'ops_trucks_delete', '29ca3788f165e2b237cbfdf11dc6525d', NULL),
  ('ops_trucks', 'ops_trucks_insert', NULL, '29ca3788f165e2b237cbfdf11dc6525d'),
  ('ops_trucks', 'ops_trucks_select', '591e023352c223f9ae4fc067ccf8c14a', NULL),
  ('ops_trucks', 'ops_trucks_update', '29ca3788f165e2b237cbfdf11dc6525d', '29ca3788f165e2b237cbfdf11dc6525d'),
  ('ops_work_order_confirmations', 'ops_wo_confirmations_delete', 'e255bf036a92d9eae0f61108830e88fe', NULL),
  ('ops_work_order_confirmations', 'ops_wo_confirmations_insert', NULL, 'e8430dc37ae593310e5c3715294168ec'),
  ('ops_work_order_confirmations', 'ops_wo_confirmations_select', '591e023352c223f9ae4fc067ccf8c14a', NULL),
  ('ops_work_order_confirmations', 'ops_wo_confirmations_update', 'e255bf036a92d9eae0f61108830e88fe', 'e255bf036a92d9eae0f61108830e88fe');

create function pg_temp.__initplan_unwrap(e text) returns text language sql immutable as $f$
  select regexp_replace(regexp_replace(e,
           '\( SELECT (auth\.([a-z_]+)\(\)) AS \2\)', '\1', 'g'),
           '\( SELECT (has_permission\(''[a-z0-9._]+''::text\)) AS has_permission\)', '\1', 'g')
$f$;

-- Förkontroll: policyerna ska vara exakt de som omskrivningen utgår från (med ev. inslagning borttagen).
do $pre$
declare
  r record;
begin
  perform set_config('search_path', 'public, extensions', true);
  for r in select e.*, p.policyname as found, p.qual, p.with_check
             from __initplan_expected e
             left join pg_policies p on p.schemaname = 'public' and p.tablename = e.tbl and p.policyname = e.pol loop
    if r.found is null then
      raise exception 'policy saknas: %.%', r.tbl, r.pol;
    end if;
    if md5(pg_temp.__initplan_unwrap(r.qual)) is distinct from r.md5_q
       or md5(pg_temp.__initplan_unwrap(r.with_check)) is distinct from r.md5_c then
      raise exception 'policy %.% skiljer sig från den omskrivningen utgår från — skriver inte över', r.tbl, r.pol;
    end if;
  end loop;
end $pre$;

alter policy ops_activity_events_insert on public.ops_activity_events
  with check (((actor_id = (select auth.uid())) AND (select has_permission('planning.schedule.write'::text))));

alter policy ops_activity_events_select on public.ops_activity_events
  using ((select has_permission('planning.schedule.read'::text)));

alter policy ops_day_notes_delete on public.ops_day_notes
  using ((select has_permission('planning.schedule.write'::text)));

alter policy ops_day_notes_insert on public.ops_day_notes
  with check (((created_by = (select auth.uid())) AND (select has_permission('planning.schedule.write'::text))));

alter policy ops_day_notes_select on public.ops_day_notes
  using ((select has_permission('planning.schedule.read'::text)));

alter policy ops_day_notes_update on public.ops_day_notes
  using ((select has_permission('planning.schedule.write'::text)))
  with check ((select has_permission('planning.schedule.write'::text)));

alter policy ops_depot_deliveries_delete on public.ops_depot_deliveries
  using ((select has_permission('planning.schedule.write'::text)));

alter policy ops_depot_deliveries_insert on public.ops_depot_deliveries
  with check (((created_by = (select auth.uid())) AND (select has_permission('planning.schedule.write'::text))));

alter policy ops_depot_deliveries_select on public.ops_depot_deliveries
  using ((select has_permission('planning.schedule.read'::text)));

alter policy ops_depot_deliveries_update on public.ops_depot_deliveries
  using ((select has_permission('planning.schedule.write'::text)))
  with check ((select has_permission('planning.schedule.write'::text)));

alter policy ops_depot_stock_counts_insert on public.ops_depot_stock_counts
  with check (((created_by = (select auth.uid())) AND (select has_permission('planning.depot.manage'::text)) AND (counted_on <= ((now() AT TIME ZONE 'Europe/Stockholm'::text))::date)));

alter policy ops_depot_stock_counts_select on public.ops_depot_stock_counts
  using ((select has_permission('planning.schedule.read'::text)));

alter policy ops_depots_delete on public.ops_depots
  using ((select has_permission('planning.depot.manage'::text)));

alter policy ops_depots_insert on public.ops_depots
  with check ((select has_permission('planning.depot.manage'::text)));

alter policy ops_depots_select on public.ops_depots
  using ((select has_permission('planning.schedule.read'::text)));

alter policy ops_depots_update on public.ops_depots
  using ((select has_permission('planning.depot.manage'::text)))
  with check ((select has_permission('planning.depot.manage'::text)));

alter policy ops_expected_deliveries_delete on public.ops_expected_deliveries
  using (((order_id IS NULL) AND (select has_permission('planning.depot.manage'::text))));

alter policy ops_expected_deliveries_insert on public.ops_expected_deliveries
  with check (((created_by = (select auth.uid())) AND (order_id IS NULL) AND (select has_permission('planning.depot.manage'::text))));

alter policy ops_expected_deliveries_select on public.ops_expected_deliveries
  using ((select has_permission('planning.schedule.read'::text)));

alter policy ops_expected_deliveries_update on public.ops_expected_deliveries
  using ((select has_permission('planning.depot.manage'::text)))
  with check ((select has_permission('planning.depot.manage'::text)));

alter policy ops_job_types_delete on public.ops_job_types
  using ((select has_permission('planning.truck.manage'::text)));

alter policy ops_job_types_insert on public.ops_job_types
  with check ((select has_permission('planning.truck.manage'::text)));

alter policy ops_job_types_select on public.ops_job_types
  using ((select has_permission('planning.schedule.read'::text)));

alter policy ops_job_types_update on public.ops_job_types
  using ((select has_permission('planning.truck.manage'::text)))
  with check ((select has_permission('planning.truck.manage'::text)));

alter policy ops_material_orders_delete on public.ops_material_orders
  using (((select has_permission('planning.depot.manage'::text)) AND (status = 'draft'::text)));

alter policy ops_material_orders_insert on public.ops_material_orders
  with check (((created_by = (select auth.uid())) AND (status = 'draft'::text) AND (select has_permission('planning.depot.manage'::text))));

alter policy ops_material_orders_select on public.ops_material_orders
  using ((select has_permission('planning.depot.manage'::text)));

alter policy ops_material_orders_update on public.ops_material_orders
  using (((select has_permission('planning.depot.manage'::text)) AND (status <> 'sent'::text)))
  with check (((select has_permission('planning.depot.manage'::text)) AND (status <> 'sent'::text)));

alter policy ops_material_suppliers_delete on public.ops_material_suppliers
  using ((select has_permission('planning.depot.manage'::text)));

alter policy ops_material_suppliers_insert on public.ops_material_suppliers
  with check (((created_by = (select auth.uid())) AND (select has_permission('planning.depot.manage'::text))));

alter policy ops_material_suppliers_select on public.ops_material_suppliers
  using ((select has_permission('planning.depot.manage'::text)));

alter policy ops_material_suppliers_update on public.ops_material_suppliers
  using ((select has_permission('planning.depot.manage'::text)))
  with check ((select has_permission('planning.depot.manage'::text)));

alter policy ops_segment_crew_delete on public.ops_segment_crew
  using ((select has_permission('planning.schedule.write'::text)));

alter policy ops_segment_crew_insert on public.ops_segment_crew
  with check (((created_by = (select auth.uid())) AND (select has_permission('planning.schedule.write'::text))));

alter policy ops_segment_crew_select on public.ops_segment_crew
  using ((select has_permission('planning.schedule.read'::text)));

alter policy ops_segment_crew_update on public.ops_segment_crew
  using ((select has_permission('planning.schedule.write'::text)))
  with check ((select has_permission('planning.schedule.write'::text)));

alter policy ops_segment_reports_delete on public.ops_segment_reports
  using ((select has_permission('planning.schedule.write'::text)));

alter policy ops_segment_reports_delete_own_partial on public.ops_segment_reports
  using (((kind = 'partial'::text) AND (created_by = (select auth.uid())) AND is_user_on_work_order((select auth.uid()), work_order_id)));

alter policy ops_segment_reports_insert on public.ops_segment_reports
  with check (((created_by = (select auth.uid())) AND (select has_permission('planning.schedule.write'::text))));

alter policy ops_segment_reports_insert_crew on public.ops_segment_reports
  with check (((created_by = (select auth.uid())) AND is_user_on_work_order((select auth.uid()), work_order_id)));

alter policy ops_segment_reports_select on public.ops_segment_reports
  using ((select has_permission('planning.schedule.read'::text)));

alter policy ops_segment_reports_select_crew on public.ops_segment_reports
  using (is_user_on_work_order((select auth.uid()), work_order_id));

alter policy ops_segment_reports_update on public.ops_segment_reports
  using ((select has_permission('planning.schedule.write'::text)))
  with check ((select has_permission('planning.schedule.write'::text)));

alter policy ops_segments_delete on public.ops_segments
  using ((select has_permission('planning.schedule.write'::text)));

alter policy ops_segments_insert on public.ops_segments
  with check (((created_by = (select auth.uid())) AND (select has_permission('planning.schedule.write'::text))));

alter policy ops_segments_select on public.ops_segments
  using ((select has_permission('planning.schedule.read'::text)));

alter policy ops_segments_update on public.ops_segments
  using ((select has_permission('planning.schedule.write'::text)))
  with check ((select has_permission('planning.schedule.write'::text)));

alter policy ops_truck_crew_delete on public.ops_truck_crew
  using ((select has_permission('planning.schedule.write'::text)));

alter policy ops_truck_crew_insert on public.ops_truck_crew
  with check (((created_by = (select auth.uid())) AND (select has_permission('planning.schedule.write'::text))));

alter policy ops_truck_crew_select on public.ops_truck_crew
  using ((select has_permission('planning.schedule.read'::text)));

alter policy ops_truck_crew_update on public.ops_truck_crew
  using ((select has_permission('planning.schedule.write'::text)))
  with check ((select has_permission('planning.schedule.write'::text)));

alter policy ops_truck_default_crew_delete on public.ops_truck_default_crew
  using ((select has_permission('planning.schedule.write'::text)));

alter policy ops_truck_default_crew_insert on public.ops_truck_default_crew
  with check (((created_by = (select auth.uid())) AND (select has_permission('planning.schedule.write'::text))));

alter policy ops_truck_default_crew_select on public.ops_truck_default_crew
  using ((select has_permission('planning.schedule.read'::text)));

alter policy ops_truck_default_crew_update on public.ops_truck_default_crew
  using ((select has_permission('planning.schedule.write'::text)))
  with check ((select has_permission('planning.schedule.write'::text)));

alter policy ops_trucks_delete on public.ops_trucks
  using ((select has_permission('planning.truck.manage'::text)));

alter policy ops_trucks_insert on public.ops_trucks
  with check ((select has_permission('planning.truck.manage'::text)));

alter policy ops_trucks_select on public.ops_trucks
  using ((select has_permission('planning.schedule.read'::text)));

alter policy ops_trucks_update on public.ops_trucks
  using ((select has_permission('planning.truck.manage'::text)))
  with check ((select has_permission('planning.truck.manage'::text)));

alter policy ops_wo_confirmations_delete on public.ops_work_order_confirmations
  using ((select has_permission('planning.schedule.write'::text)));

alter policy ops_wo_confirmations_insert on public.ops_work_order_confirmations
  with check (((created_by = (select auth.uid())) AND (select has_permission('planning.schedule.write'::text))));

alter policy ops_wo_confirmations_select on public.ops_work_order_confirmations
  using ((select has_permission('planning.schedule.read'::text)));

alter policy ops_wo_confirmations_update on public.ops_work_order_confirmations
  using ((select has_permission('planning.schedule.write'::text)))
  with check ((select has_permission('planning.schedule.write'::text)));

-- Efterkontroll: med inslagningen borttagen är varje policy identisk med originalet, och inga oinslagna anrop
-- finns kvar på de berörda tabellerna (alla anrop minus de inslagna ska vara noll).
do $post$
declare
  r record;
  bare int;
begin
  perform set_config('search_path', 'public, extensions', true);
  for r in select e.*, p.qual, p.with_check
             from __initplan_expected e
             join pg_policies p on p.schemaname = 'public' and p.tablename = e.tbl and p.policyname = e.pol loop
    if md5(pg_temp.__initplan_unwrap(r.qual)) is distinct from r.md5_q
       or md5(pg_temp.__initplan_unwrap(r.with_check)) is distinct from r.md5_c then
      raise exception 'policy %.% ändrades mer än inslagningen', r.tbl, r.pol;
    end if;
  end loop;

  select coalesce(sum(
           (select count(*) from regexp_matches(x.e, '(^|[^.a-z0-9_])(auth\.[a-z_]+\(\)|has_permission\()', 'g'))
         - (select count(*) from regexp_matches(x.e, '\( SELECT (auth\.[a-z_]+\(\)|has_permission\()', 'g'))
         ), 0) into bare
    from (select coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') as e
            from pg_policies p
           where p.schemaname = 'public' and p.tablename in (select tbl from __initplan_expected)) x;
  if bare <> 0 then
    raise exception '% oinslagna auth.*()/has_permission()-anrop kvar', bare;
  end if;
end $post$;

drop function pg_temp.__initplan_unwrap(text);
drop table __initplan_expected;
