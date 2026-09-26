-- Fast search_path på triggerfunktionerna i de delar vi behåller, och bort med tre döda funktioner.
--
-- Supabase advisor i prod (2026-09-26) flaggade 33 funktioner i public som function_search_path_mutable (WARN).
-- Utan en fast search_path slår funktionen upp namn i anroparens sökväg. Alla 33 är SECURITY INVOKER, så ingen kan
-- låna funktionens rättigheter den vägen. Det här är hygien, inte ett hål.
--
-- 19 hör till delar vi behåller: CRM, ops_* (nya planeringen och lagret), startsidan, dokument, anställdas
-- uppgifter och jobbtypsfärgerna. Alla är plpgsql-triggerfunktioner, och kropparna använder bara inbyggda funktioner
-- (now, round, coalesce, current_setting) och tabeller skrivna med public. framför. search_path = public ändrar
-- alltså inte vad någon av dem hittar. Samma värde som repots övriga funktioner har (SET search_path TO 'public').
-- En SQL-funktion hade slutat kunna byggas in i frågan av en SET-klausul; ingen av de 19 är SQL.
--
-- 3 är döda och tas bort i stället för att lagas: triggerfunktionerna för de borttagna tabellerna crm_opportunities
-- och crm_prospects, och is_readonly_user. Ingen trigger, policy, funktion eller kod använder dem (2026-09-26).
-- drop function utan cascade fäller migreringen om något ändå skulle bero på dem.
--
-- Kvar med flit, 11 st: gamla planeringen och gamla offertkalkylatorn, som städas bort. De står i efterkontrollen.
--
-- Ändrar inget beteende. Idempotent, kan köras om.

-- CRM
alter function public.set_crm_customers_updated_at() set search_path = public;
alter function public.set_timestamp_crm_quotes() set search_path = public;
alter function public.set_timestamp_crm_work_orders() set search_path = public;
alter function public.set_timestamp_crm_work_order_stages() set search_path = public;
alter function public.set_timestamp_crm_work_order_time_entries() set search_path = public;
alter function public.set_timestamp_crm_goals() set search_path = public;
alter function public.set_timestamp_crm_ai_prospect_suggestions() set search_path = public;
alter function public.set_timestamp_time_reference() set search_path = public;
alter function public.enforce_time_entry_owner() set search_path = public;
alter function public.set_crm_time_entry_hours() set search_path = public;

-- ops_* (nya planeringen och lagret)
alter function public.set_timestamp_ops_segments() set search_path = public;
alter function public.ops_material_orders_guard() set search_path = public;
alter function public.ops_material_orders_insert_guard() set search_path = public;
alter function public.ops_expected_deliveries_forward_only() set search_path = public;

-- Startsidan, dokument, anställda, uppgifter, jobbtypsfärger
alter function public.set_timestamp() set search_path = public;
alter function public.set_updated_at_timestamp() set search_path = public;
alter function public.set_employee_sensitive_details_updated_at() set search_path = public;
alter function public.set_timestamp_tasks() set search_path = public;
alter function public.set_updated_at() set search_path = public;

-- Döda
drop function if exists public.is_readonly_user();
drop function if exists public.set_crm_opportunities_updated_at();
drop function if exists public.set_timestamp_crm_prospects();

-- Efterkontroll, samma villkor som advisorn: en funktion i public utan search_path, som inte hör till en extension
-- (pg_trgm ligger i public). Efteråt får bara de kvarlämnade stå där. Listan prövas som en övre gräns, inte exakt:
-- städningen kan ha tagit bort några av dem före den här filen. En ny funktion utan search_path som dyker upp här
-- avbryter pushen i stället för att tyst bli advisor-varning nummer 34.
do $$
declare
  kept constant text[] := array[
    -- gamla planeringen
    'current_actor', 'is_konsult_user', 'json_diff', 'log_planning_activity',
    'set_timestamp_planning_meta', 'set_timestamp_planning_segment_reports', 'set_timestamp_planning_segments',
    'trg_planning_assignments_log', 'trg_planning_meta_log', 'trg_planning_segments_log',
    -- gamla offertkalkylatorn
    'set_timestamp_offert_calculations'
  ];
  mutable text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into mutable
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prokind in ('f', 'p')
    and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
    and p.proname <> all (kept);
  if mutable is not null then
    raise exception 'funktioner i public utan search_path: %', mutable;
  end if;

  if to_regprocedure('public.is_readonly_user()') is not null
     or to_regprocedure('public.set_crm_opportunities_updated_at()') is not null
     or to_regprocedure('public.set_timestamp_crm_prospects()') is not null then
    raise exception 'en av de döda funktionerna finns kvar';
  end if;
end $$;
