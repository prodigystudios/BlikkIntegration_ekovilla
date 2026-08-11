-- CRM-arbetsorderlistan under besättnings-RLS:en — MÄTNING, inga ändringar sparas.
--
-- Den enda punkten i fält/CRM-cutovern som ingen mätte innan go-live. `crm_work_orders_select_crew`
-- (20260810_crm_work_order_crew_access.sql) anropar `is_user_on_work_order(auth.uid(), id)` — ett
-- predikat som beror på RADEN och därför i värsta fall körs en gång per arbetsorder. Frågan filen
-- svarar på: kostar det något för kontoret, som läser hela listan?
--
-- VARFÖR DET ANTAGLIGEN ÄR BILLIGT — och varför det ändå måste mätas: policyerna är permissiva och
-- OR:as ihop. För en säljare/admin är `has_permission('crm.workorder.read')` sann, och en OR
-- kortsluter så fort en gren är sann — men PostgreSQL garanterar INTE i vilken ordning grenarna
-- utvärderas. Väljer planeraren besättningsgrenen först betalar kontoret full kostnad per rad.
-- Mätningen avgör vilket som faktiskt händer i er databas, med er datamängd.
--
-- VÄRST BELASTADE STÄLLET är inte listan utan chip-räknarna: getCrmWorkOrderFilterCounts kör SEX
-- `count(*)`-frågor per sidladdning (CRM_WORK_ORDER_BOARD_FILTERS), och en count har ingen LIMIT att
-- sluta tidigt på — varje rad måste igenom policyn. Därför mäts count_all separat och jämförs × 6.
--
-- KÖRS SOM EN TRANSAKTION SOM RULLAS TILLBAKA. Hjälpfunktionen skapas i pg_temp och existerar bara
-- under körningen; inga rader, policyer eller funktioner i public rörs. Kör hela filen på en gång.
--
-- Supabase SQL-editorn visar bara SISTA resultatet — därför samlas allt i en temptabell som sista
-- satsen läser. EXPLAIN-delen (avsnitt 2, längst ned) är avkommenterad och körs separat.
--
-- Kör mätningen när systemet används som vanligt. En helt kall databas ger missvisande siffror åt
-- båda håll: första körningen betalar disk-I/O, andra körningen läser allt ur cachen. Kör två
-- gånger och läs den andra.

begin;

-- ── Uppsamling ───────────────────────────────────────────────────────────────
create temp table probe_out (
  sort      int,
  persona   text,
  prob      text,
  rader     bigint,
  ms        numeric,
  bedomning text
);

-- ── Testpersoner ─────────────────────────────────────────────────────────────
-- Väljs ut medan vi fortfarande är privilegierade (efter rollbytet går profiles inte att läsa).
-- Byt ut selecten mot en hårdkodad uuid om du vill mäta en specifik person.
select set_config(
  'probe.office_uid',
  coalesce((select id::text from public.profiles where role::text in ('admin', 'sales') order by role::text, id limit 1), ''),
  true
);
-- En installatör som faktiskt står på en bil — annars mäter vi en tom besättningsgren.
select set_config(
  'probe.field_uid',
  coalesce(
    (select member_id::text from public.ops_truck_default_crew limit 1),
    (select member_id::text from public.ops_truck_crew limit 1),
    (select member_id::text from public.ops_segment_crew limit 1),
    ''
  ),
  true
);

-- ── Sonden ───────────────────────────────────────────────────────────────────
-- Byter roll till `authenticated` och sätter JWT-claims så auth.uid() svarar rätt, kör frågorna, och
-- återgår innan den returnerar. Utan rollbytet körs allt som tabellägare och RLS hoppas över helt —
-- då mäter vi ingenting. Rollen sätts med set_config(...,true) = SET LOCAL: den överlever inte
-- transaktionen även om något går sönder mitt i.
create function pg_temp.rls_probe(p_persona text, p_uid text)
returns table(persona text, prob text, rader bigint, ms numeric, bedomning text)
language plpgsql
as $fn$
declare
  t0 timestamptz;
  n  bigint;
  elapsed numeric;
begin
  if p_uid = '' then
    persona := p_persona; prob := '(ingen testperson hittad)'; rader := null; ms := null;
    bedomning := 'HOPPAD ÖVER'; return next; return;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);

  -- 1) Listsidan: exakt vad listCrmWorkOrdersWithFilters begär (sida 1, 100 rader).
  t0 := clock_timestamp();
  execute '
    select count(*) from (
      select * from public.crm_work_orders
      order by desired_installation_date asc nulls last, created_at desc
      limit 100
    ) t' into n;
  elapsed := round((extract(epoch from clock_timestamp() - t0) * 1000)::numeric, 1);
  persona := p_persona; prob := '1. listsida (100 rader)'; rader := n; ms := elapsed;
  bedomning := case when elapsed < 150 then 'OK' when elapsed < 500 then 'VARNING' else 'ÅTGÄRDA' end;
  return next;

  -- 2) En chip-räknare. Sidan kör SEX sådana, så tröskeln jämförs mot ms × 6.
  t0 := clock_timestamp();
  execute 'select count(*) from public.crm_work_orders' into n;
  elapsed := round((extract(epoch from clock_timestamp() - t0) * 1000)::numeric, 1);
  persona := p_persona; prob := '2. count_all (sidan kör 6 st → ms × 6)'; rader := n; ms := elapsed;
  bedomning := case when elapsed * 6 < 150 then 'OK' when elapsed * 6 < 500 then 'VARNING' else 'ÅTGÄRDA' end;
  return next;

  -- 3) Enskild order — fältvyns väg, den som måste vara snabb för besättningen.
  t0 := clock_timestamp();
  execute '
    select count(*) from (
      select * from public.crm_work_orders
      order by created_at desc limit 1
    ) t' into n;
  elapsed := round((extract(epoch from clock_timestamp() - t0) * 1000)::numeric, 1);
  persona := p_persona; prob := '3. senaste ordern (1 rad)'; rader := n; ms := elapsed;
  bedomning := case when elapsed < 50 then 'OK' when elapsed < 200 then 'VARNING' else 'ÅTGÄRDA' end;
  return next;

  -- 4) Taket: tvinga besättningsgrenen att köras för VARJE rad, utan OR att kortsluta på.
  --    Ligger den nära (1) betyder det att kontoret redan betalar full kostnad — då är det
  --    ordningen på OR-grenarna som räddar er idag, och det är inget att förlita sig på.
  t0 := clock_timestamp();
  execute format(
    'select count(*) from public.crm_work_orders where public.is_user_on_work_order(%L::uuid, id)', p_uid
  ) into n;
  elapsed := round((extract(epoch from clock_timestamp() - t0) * 1000)::numeric, 1);
  persona := p_persona; prob := '4. is_user_on_work_order per rad (tak)'; rader := n; ms := elapsed;
  bedomning := 'INFO';
  return next;

  perform set_config('role', 'none', true);
end;
$fn$;

-- ── Körning ──────────────────────────────────────────────────────────────────
-- Kontexten först, medan rollen fortfarande är privilegierad: annars räknas raderna genom RLS och
-- säger något helt annat än "så här många arbetsordrar finns det".
insert into probe_out
select 0, 'kontext', 'antal arbetsordrar', count(*), null, 'INFO' from public.crm_work_orders
union all
select 0, 'kontext', 'antal ops_segments', count(*), null, 'INFO' from public.ops_segments;

insert into probe_out
select 1, p.* from pg_temp.rls_probe('kontor (sälj/admin)', current_setting('probe.office_uid')) p;

insert into probe_out
select 2, p.* from pg_temp.rls_probe('fält (besättning)', current_setting('probe.field_uid')) p;

select persona, prob, rader, ms, bedomning from probe_out order by sort, prob;

rollback;

-- ─────────────────────────────────────────────────────────────────────────────
-- AVSNITT 2 — kör separat när en siffra ovan ser fel ut
--
-- Visar planen. Leta efter `Filter: is_user_on_work_order(...)` på crm_work_orders: står funktionen
-- kvar som radfilter körs den per rad, och `Rows Removed by Filter` visar hur många gånger.
--
--   begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<uuid-på-en-säljare>","role":"authenticated"}', true);
--   explain (analyze, buffers, verbose)
--     select * from public.crm_work_orders
--     order by desired_installation_date asc nulls last, created_at desc
--     limit 100;
--   rollback;
--
-- ─────────────────────────────────────────────────────────────────────────────
-- OM DET ÄR FÖR LÅNGSAMT — åtgärden, INTE applicerad
--
-- Indexen finns redan (ops_segments(work_order_id), ops_segment_crew(segment_id),
-- ops_truck_crew(truck_id, start_day, end_day), ops_truck_default_crew(truck_id)), så ett nytt index
-- löser ingenting. Problemet är i så fall att predikatet är per rad. Formulera om det till en mängd
-- PostgreSQL kan räkna ut EN gång per fråga (InitPlan) i stället för en gång per rad:
--
--   create or replace function public.my_crew_work_order_ids()
--   returns setof uuid language sql stable security definer set search_path = public as $$
--     select distinct s.work_order_id
--     from public.ops_segments s
--     where public.is_user_on_work_order(auth.uid(), s.work_order_id)
--   $$;
--   revoke all on function public.my_crew_work_order_ids() from public;
--   grant execute on function public.my_crew_work_order_ids() to authenticated;
--
--   drop policy if exists crm_work_orders_select_crew on public.crm_work_orders;
--   create policy crm_work_orders_select_crew on public.crm_work_orders for select to authenticated
--     using (id in (select public.my_crew_work_order_ids()));
--
-- Samma åtkomst, annan form. Kör om mätningen efteråt: bytet är bara värt något om siffrorna säger
-- det, och det gör åtkomstregeln ett steg svårare att läsa. Mät först.
