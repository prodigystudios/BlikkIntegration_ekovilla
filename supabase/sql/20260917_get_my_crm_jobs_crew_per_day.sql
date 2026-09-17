-- Fältfeeden visar ett jobb för den som kör DEN DAGEN — inte för alla som någon gång kört ordern.
--
-- BUGGEN (live sedan fältcutovern 2026-08-10, PR #53)
-- get_my_crm_jobs släppte igenom ett riktigt jobbs segment på is_user_on_work_order: "är du på NÅGOT
-- segment av den här ordern". Den frågan är rätt för ÅTKOMST (den som körde fredagen ska kunna öppna
-- ordern, kommentera och rapportera säckar), men fel för SCHEMA. En besättning som legat på ett
-- tidigare segment fick därför med sig varje senare segment av samma order i /mina-jobb, startsidans
-- veckoschema och jobbväljaren i /tid — på andra bilar och andra veckor, med andra besättningar.
--
-- Belagt 2026-09-17 mot riktig data: order 120 låg på Upplandsväsby 1 fredag 11/9 (veckobesättning
-- 7–13/9) och fortsatte tisdag 15/9 + onsdag 16/9 med en annan besättning. Förra veckans besättning
-- såg tisdagen och onsdagen: is_user_on_segment = false, is_user_on_work_order = true. 14 segment,
-- 8 personer, i fönstret 14/9–17/10. I /tid väljs ett ensamt jobb automatiskt, så tid kunde hamna
-- på en order personen aldrig var bokad på.
--
-- FIXEN
-- 1. Besättningsgrenarna flyttas till EN primitiv som svarar för ett datumintervall inom segmentet:
--    is_user_on_segment_between. Veckobesättningen avgörs för veckan/veckorna i INTERVALLET, inte för
--    hela segmentet.
-- 2. is_user_on_segment anropar den med segmentets egna dagar — exakt samma svar som förut, så
--    is_user_on_work_order och de RLS-policyer den bär är oförändrade.
-- 3. get_my_crm_jobs frågar per rad (segment x dag) med dagen som intervall, för BÅDA sorterna.
--
-- Varför per dag och inte bara per segment: ett segment som går över en veckogräns (fredag–måndag)
-- kan ha olika besättning på var sida. Tavlan löser besättningen per renderad ISO-vecka
-- (app/crm/planering/WeekBoard.tsx, crewForTruckInRange), så måndagen hör till måndagens veckas
-- besättning. is_user_on_segment vidgar till båda veckorna och hade visat måndagen för fredagens
-- besättning också. Stora etapper läggs på flera bilar och veckor med olika besättningar — feeden
-- måste svara för dagen, annars åker fel lag till jobbet.
--
-- ⚠️ Kopiera ALDRIG grenarna till en andra funktion. Två definitioner av "vem kör bilen den veckan"
-- glider isär tyst: tavlan visar en person, feeden en annan, och ingen av dem ser fel ut på egen hand.
-- Därför bor grenarna nu i is_user_on_segment_between och ingen annanstans.
--
-- DEPLOY-ORDNING: valfri. Ingen kod ändras och ingen kolumn eller returtyp rörs — get_my_crm_jobs
-- byts med create or replace och samma signatur som i 20260908_ops_segments_field_visible.sql, så
-- funktionen finns hela tiden. Körs efter den filen. Idempotent.

-- ── 1. Primitiven ───────────────────────────────────────────────────────────
-- "Är p_uid besättning på segmentet under någon dag i [p_from, p_to]?"
--
-- Intervallet klipps först mot segmentets egna dagar och vidgas sedan till hela ISO-veckor. Klippet
-- gör att en anropare som skickar ett för brett intervall inte kan fråga om en vecka segmentet inte
-- ligger i. Ett intervall som inte överlappar segmentet alls svarar false, liksom null.
--
-- Vidgningen till hela veckor är oförändrad och har samma skäl som förut (20260810_crm_work_order_
-- crew_access.sql): en veckobesättningsrad kan täcka del av en vecka, och tavlan visar den på hela
-- veckans bilrad.
--
-- Gren 1 (uttryckligen tillagd på placeringen) gäller hela segmentet oavsett dag.
create or replace function public.is_user_on_segment_between(
  p_uid     uuid,
  p_segment uuid,
  p_from    date,
  p_to      date
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ops_segments s
    cross join lateral (
      select
        date_trunc('week', greatest(p_from, s.start_day))::date                     as week_start,
        (date_trunc('week', least(p_to, s.end_day)) + interval '6 days')::date      as week_end
    ) w
    where s.id = p_segment
      and p_uid is not null
      and p_from <= s.end_day
      and p_to   >= s.start_day
      and (
        -- 1) uttryckligen tillagd som besättning på just den här placeringen
        exists (
          select 1
          from public.ops_segment_crew c
          where c.segment_id = s.id
            and c.member_id = p_uid
        )
        -- 2) på bilens veckobesättning för veckan/veckorna intervallet ligger i
        or exists (
          select 1
          from public.ops_truck_crew tc
          where tc.truck_id = s.truck_id
            and tc.member_id = p_uid
            and tc.start_day <= w.week_end
            and tc.end_day   >= w.week_start
        )
        -- 3) på bilens standardbemanning — BARA när ingen veckobesättning överstyr de veckorna
        or (
          not exists (
            select 1
            from public.ops_truck_crew tc2
            where tc2.truck_id = s.truck_id
              and tc2.start_day <= w.week_end
              and tc2.end_day   >= w.week_start
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

-- Intern: anropas bara inifrån security definer-funktioner, som kör som ägaren. Ingen inloggad roll
-- behöver den, och en körbar variant med godtyckligt uid och datum vore ytterligare ett sätt att
-- sondera vem som är på vilket jobb vilken dag. (Supabase ger nya funktioner i public till anon och
-- authenticated via default privileges — därför räcker inte "from public".)
revoke all on function public.is_user_on_segment_between(uuid, uuid, date, date) from public, anon, authenticated;

-- ── 2. is_user_on_segment — samma svar, nu via primitiven ───────────────────
-- Hela segmentet som intervall: klippet blir en no-op och vidgningen blir exakt den gamla, så svaret
-- är detsamma för varje (person, segment). is_user_on_work_order anropar den här och bär fyra
-- RLS-policyer — create or replace, signaturen och rättigheterna står still.
create or replace function public.is_user_on_segment(p_uid uuid, p_segment uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ops_segments s
    where s.id = p_segment
      and public.is_user_on_segment_between(p_uid, s.id, s.start_day, s.end_day)
  );
$$;

-- ── 3. Feeden — besättning per dag, för båda sorterna ───────────────────────
-- Samma signatur och returkolumner som 20260908_ops_segments_field_visible.sql, därför create or
-- replace utan drop: funktionen försvinner aldrig under körningen.
create or replace function public.get_my_crm_jobs(start_date date default null, end_date date default null)
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
  customer_address      jsonb,
  -- Platshållarens egen titel/kund och vad som ska göras. null på riktiga arbetsordrar, och det är
  -- så anroparen skiljer sorterna åt — work_order_id är null på exakt samma rader.
  placeholder_title     text,
  work_description      text
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
    -- Platshållarens kund läggs INTE ihop med wo.client_name här. Sammanslagningen görs i
    -- TypeScript (lib/domains/planning/myJobs.ts), av samma skäl som adressen redan gör det:
    -- en visningsregel ska stå på ett ställe, och SQL är inte det stället.
    coalesce(wo.client_name, s.placeholder_customer) as customer,
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
    --
    -- En platshållare har ingen kund och därmed ingen adress: allt nedan blir null, och kortet
    -- visar ingen adressrad. Det är korrekt — adressen finns inte förrän ordern gör det.
    jsonb_build_object(
      'delivery_address',     wo.customer_snapshot ->> 'delivery_address',
      'delivery_postal_code', wo.customer_snapshot ->> 'delivery_postal_code',
      'delivery_city',        wo.customer_snapshot ->> 'delivery_city',
      'street_address',       wo.customer_snapshot ->> 'street_address',
      'postal_code',          wo.customer_snapshot ->> 'postal_code',
      'city',                 wo.customer_snapshot ->> 'city'
    ) as customer_address,
    s.placeholder_title,
    s.work_description
  from public.ops_segments s
  -- left join, inte inner: en flaggad platshållare ÄR ett fältjobb (service av maskiner, interna
  -- dagar). Vilka som släpps igenom avgörs i where-satsen, inte av joinen.
  left join public.crm_work_orders wo on wo.id = s.work_order_id
  join public.ops_trucks t on t.id = s.truck_id
  -- one row per day of the segment, same as user_my_jobs_v
  cross join lateral generate_series(s.start_day, s.end_day, interval '1 day') as gs(d)
  where (start_date is null or gs.d::date >= start_date)
    and (end_date   is null or gs.d::date <= end_date)
    -- A paused segment stays on the board (dimmed, badged "Pausad") because the planner still wants
    -- the slot — but it is not a job to drive to. Gäller båda sorterna.
    and not s.on_hold
    -- Same for a cancelled order whose segment nobody removed. Null-säker: en platshållare har
    -- ingen status och får inte falla på jämförelsen mot null.
    and (s.work_order_id is null or wo.status is distinct from 'cancelled')
    -- En platshållare syns bara när planeraren publicerat den. Ett riktigt jobb behöver ingen flagga.
    and (s.work_order_id is not null or s.field_visible)
    -- THE security boundary: security definer bypasses RLS on ops_*/crm_work_orders, so
    -- membership is what scopes the result.
    --
    -- ⚠️ PER SEGMENT OCH DAG — aldrig is_user_on_work_order här. Den svarar "får du öppna ordern"
    -- och är sann för alla som kört NÅGON dag av den; i feeden blev det att förra veckans lag fick
    -- nästa veckas dagar på en annan bil. Feeden är en delmängd av åtkomsten (på segmentet den dagen
    -- => på ordern), så varje rad här går fortfarande att öppna.
    and public.is_user_on_segment_between(auth.uid(), s.id, gs.d::date, gs.d::date);
$$;

revoke all on function public.get_my_crm_jobs(date, date) from public;
grant execute on function public.get_my_crm_jobs(date, date) to authenticated;

-- ── Verifiering ─────────────────────────────────────────────────────────────
-- 1. is_user_on_segment får INTE ha ändrat svar. Kör frågan FÖRE filen och spara utskriften, kör den
--    igen EFTER och jämför — listorna ska vara identiska. (Att jämföra funktionerna med varandra
--    efteråt bevisar ingenting: den ena anropar numera den andra.)
--
--   select s.id, s.start_day, p.full_name
--   from public.ops_segments s
--   cross join public.profiles p
--   where public.is_user_on_segment(p.id, s.id)
--   order by s.start_day, s.id, p.full_name;
--
-- 2. Vilka feeddagar som stängs — informativt, inte godkänt/underkänt. Listar (person, jobb, dag) där
--    personen kommer åt ordern men inte kör just den dagen: exakt de rader den gamla feeden visade
--    och den nya inte gör. Personerna kan fortfarande ÖPPNA ordern; det är avsiktligt. (Körs som
--    ägare i editorn, därför via funktionerna och inte via get_my_crm_jobs, som läser auth.uid().)
--
--   select p.full_name, wo.order_number, wo.fortnox_order_number, g.d::date as dag
--   from public.ops_segments s
--   join public.crm_work_orders wo on wo.id = s.work_order_id
--   cross join lateral generate_series(s.start_day, s.end_day, interval '1 day') g(d)
--   cross join public.profiles p
--   where g.d::date >= current_date
--     and not s.on_hold
--     and wo.status is distinct from 'cancelled'
--     and public.is_user_on_work_order(p.id, s.work_order_id)
--     and not public.is_user_on_segment_between(p.id, s.id, g.d::date, g.d::date)
--   order by p.full_name, dag;
--
-- 3. Som installatör i appen: /mina-jobb ska bara visa dagar där du står på bilens besättning i
--    planeringen den veckan (eller är tillagd på jobbkortet).
