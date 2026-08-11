-- CRM-arbetsorderlistan under besättnings-RLS:en — MÄTNING.
--
-- KORT: alla andra läsregler på crm_work_orders ger SAMMA svar för varje rad ("har du
-- crm.workorder.read?") — databasen frågar en gång och är klar. Besättningsregeln ger OLIKA svar per
-- rad ("står du på det här jobbets besättning?") och gräver genom planeringstabellerna varje gång.
-- Det är den enda regeln i systemet som kostar per rad. Frågan här: märks det?
--
-- VARFÖR DEN BYTER ROLL. Som databasägare gäller RLS inte alls — mäter man därifrån mäter man en
-- fråga utan policy på och lär sig ingenting. `set role authenticated` + JWT-claims är det som gör
-- mätningen verklig. Rad "0. kontroll" i utdatan bevisar vilket som gällde: säger den FEL är resten
-- skräp.
--
-- ⚠️ VARFÖR ALLT LIGGER I EN FUNKTION — läs det här innan du "förenklar" filen:
-- Supabase SQL-editorn kan lägga varje sats på en EGEN uppkoppling. Då finns ingen delad session:
-- en temptabell från sats 1 är borta i sats 2 (det felet, `relation "probe_out" does not exist`,
-- är hur den här filen upptäcktes), `begin`/`rollback` gör ingenting, och — värre — ett
-- `set local role authenticated` i en sats når INTE nästa sats. Mätningen hade då körts som ägare,
-- utan RLS, och gett låga siffror som ser utmärkta ut. Ett tyst fel, inte ett felmeddelande.
-- Därför: rollbyte, mätning och avläsning sker inuti EN sats — funktionsanropet.
--
-- FARLIGT? Inget skrivs till någon tabell, utdatan är antal + millisekunder (ingen kunddata), och
-- rollbytet sätts med SET LOCAL inuti funktionen så det dör när satsen är klar. Det enda som lämnas
-- kvar är själva funktionen — därför steg 3. Den reella kostnaden är CPU: proben scannar tabellen
-- flera gånger och mätning 4 är långsam med flit. Kör den inte mitt i högtrafik.
--
-- Kör mätningen när systemet används som vanligt, och kör den TVÅ gånger — första körningen betalar
-- disk-I/O, andra läser ur cachen. Läs den andra.

-- ═══════════════════════════════════════════════════════════════════════════
-- STEG 1 — skapa probfunktionen. Kör den här filen som den är.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.crm_rls_probe()
returns table(persona text, prob text, rader bigint, ms numeric, bedomning text)
language plpgsql
volatile
security invoker
as $fn$
declare
  v_office uuid;
  v_field  uuid;
  rec      record;
  t0       timestamptz;
  n        bigint;
  elapsed  numeric;
  kor_som  text;
  uid_syns text;
  plan_json json;
begin
  -- ── Kontext ────────────────────────────────────────────────────────────────
  -- Körs som anroparen, alltså utan RLS. Med RLS hade de här räknats genom policyn och svarat på
  -- något helt annat än "så här många arbetsordrar finns det".
  persona := 'kontext'; ms := null; bedomning := 'INFO';

  select count(*) into n from public.crm_work_orders;
  prob := 'antal arbetsordrar'; rader := n; return next;

  select count(*) into n from public.ops_segments;
  prob := 'antal ops_segments'; rader := n; return next;

  -- Är RLS avslaget på tabellen finns ingen policy att mäta kostnaden för, och allt nedan är fritt
  -- fall. (Ägaren kringgår RLS ändå — därför rollbytet — men är den AV kringgår ALLA den.)
  prob := 'RLS på crm_work_orders'; rader := null;
  select case when c.relrowsecurity then 'PÅ' else 'AV — inget nedan betyder något' end
    into bedomning
    from pg_class c where c.oid = 'public.crm_work_orders'::regclass;
  return next;

  -- ── Testpersoner ───────────────────────────────────────────────────────────
  -- Väljs ut innan rollbytet: efteråt går profiles inte att läsa. Byt mot en hårdkodad uuid om du
  -- vill mäta en bestämd person.
  select p.id into v_office
    from public.profiles p
   where p.role::text in ('admin', 'sales')
   order by p.role::text, p.id
   limit 1;

  -- En installatör som faktiskt står på en bil — annars mäter vi en tom besättningsgren.
  v_field := coalesce(
    (select dc.member_id from public.ops_truck_default_crew dc limit 1),
    (select tc.member_id from public.ops_truck_crew tc limit 1),
    (select sc.member_id from public.ops_segment_crew sc limit 1)
  );

  for rec in
    select * from (values ('kontor (sälj/admin)', v_office), ('fält (besättning)', v_field)) as v(label, uid)
  loop
    persona := rec.label;

    if rec.uid is null then
      prob := '(ingen testperson hittad)'; rader := null; ms := null; bedomning := 'HOPPAD ÖVER';
      return next;
      continue;
    end if;

    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
                       json_build_object('sub', rec.uid::text, 'role', 'authenticated')::text, true);

    -- 0) Beviset att mätningen mäter något. Tar rollbytet inte körs allt nedan som tabellägare, och
    --    då gäller ingen policy: siffrorna blir strålande och betyder ingenting. En mätning man inte
    --    kan skilja från en no-op är ingen mätning — läs den här raden FÖRST.
    kor_som  := current_user::text;
    uid_syns := coalesce(auth.uid()::text, '(null)');
    prob := format('0. kontroll — kör som %s, auth.uid() = %s', kor_som, uid_syns);
    rader := null; ms := null;
    bedomning := case
      when kor_som = 'authenticated' and uid_syns = rec.uid::text then 'OK — RLS gäller'
      else 'FEL — allt nedan mäter en fråga utan policy'
    end;
    return next;

    -- Alla mätfrågor körs med EXECUTE, alltså dynamiskt. Statisk SQL i plpgsql cachar planen, och en
    -- plan gjord för en roll säger ingenting om nästa — vi vill planera om varje gång.

    -- 1) Listsidan: exakt vad listCrmWorkOrdersWithFilters begär (sida 1, 100 rader).
    t0 := clock_timestamp();
    execute '
      select count(*) from (
        select * from public.crm_work_orders
        order by desired_installation_date asc nulls last, created_at desc
        limit 100
      ) t' into n;
    elapsed := round((extract(epoch from clock_timestamp() - t0) * 1000)::numeric, 1);
    prob := '1. listsida (100 rader)'; rader := n; ms := elapsed;
    bedomning := case when elapsed < 150 then 'OK' when elapsed < 500 then 'VARNING' else 'ÅTGÄRDA' end;
    return next;

    -- 2) En chip-räknare. getCrmWorkOrderFilterCounts kör SEX sådana per sidladdning, och en count
    --    har ingen LIMIT att sluta tidigt på — varje rad måste igenom policyn. Värsta stället.
    t0 := clock_timestamp();
    execute 'select count(*) from public.crm_work_orders' into n;
    elapsed := round((extract(epoch from clock_timestamp() - t0) * 1000)::numeric, 1);
    prob := '2. count_all (sidan kör 6 st → ms × 6)'; rader := n; ms := elapsed;
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
    prob := '3. senaste ordern (1 rad)'; rader := n; ms := elapsed;
    bedomning := case when elapsed < 50 then 'OK' when elapsed < 200 then 'VARNING' else 'ÅTGÄRDA' end;
    return next;

    -- 4) Taket: tvinga besättningsgrenen att köras för VARJE rad, utan OR att kortsluta på.
    --    Ligger den nära (1) betyder det att kontoret redan betalar full kostnad.
    t0 := clock_timestamp();
    execute format(
      'select count(*) from public.crm_work_orders where public.is_user_on_work_order(%L::uuid, id)',
      rec.uid
    ) into n;
    elapsed := round((extract(epoch from clock_timestamp() - t0) * 1000)::numeric, 1);
    prob := '4. is_user_on_work_order per rad (tak)'; rader := n; ms := elapsed;
    bedomning := 'INFO';
    return next;

    -- 5) Svaret på själva frågan, direkt ur planen i stället för att gissa: står funktionen kvar som
    --    radfilter på crm_work_orders utvärderas den per rad. För KONTORET betyder JA att
    --    OR-kortslutningen inte räddar er och att siffrorna ovan är den kostnaden. För FÄLTET är JA
    --    förväntat — besättningsgrenen är deras enda väg in.
    execute '
      explain (analyze, format json)
      select * from public.crm_work_orders
      order by desired_installation_date asc nulls last, created_at desc
      limit 100' into plan_json;
    prob := '5. plan — besättningsfiltret kvar som radfilter?';
    rader := null;
    ms := round((plan_json->0->>'Execution Time')::numeric, 1);
    bedomning := case
      when plan_json::text like '%is_user_on_work_order%' then 'JA — utvärderas per rad'
      else 'NEJ — kortsluts av behörighetsgrenen'
    end;
    return next;

    perform set_config('role', 'none', true);
  end loop;
end;
$fn$;

-- Diagnostik, inte en app-funktion: den impersonerar och ska bara kunna köras av den som redan är
-- privilegierad. authenticated ska aldrig komma åt den.
revoke all on function public.crm_rls_probe() from public;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEG 2 — kör mätningen. Markera raden och kör den ENSAM (annars visar editorn
--          resultatet av nästa sats i stället).
-- ═══════════════════════════════════════════════════════════════════════════
--
--   select * from public.crm_rls_probe();
--
-- ═══════════════════════════════════════════════════════════════════════════
-- STEG 3 — städa när du är klar. Funktionen behöver inte ligga kvar.
-- ═══════════════════════════════════════════════════════════════════════════
--
--   drop function public.crm_rls_probe();
--
-- ═══════════════════════════════════════════════════════════════════════════
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
