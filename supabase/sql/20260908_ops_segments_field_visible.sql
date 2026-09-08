-- Platshållare som entreprenaden kan se — "Synlig för entreprenad" + arbetsbeskrivning.
--
-- BAKGRUND
-- En platshållare (ops_segments utan work_order_id, se 20260613_ops_segments_placeholders.sql) är
-- idag rent kontorsintern: get_my_crm_jobs inner-joinar crm_work_orders och tappar därför varje
-- platshållare. Det är rätt för en bokad dag som väntar på sin order — men fel för det säljarna
-- faktiskt vill boka: service av maskiner, interna dagar, arbeten som aldrig får en arbetsorder.
-- Grabbarna behöver se dem, och de behöver veta vad de ska göra.
--
-- Därför: en flagga planeraren slår på medvetet, och ett fritextfält som följer med ut i fältet.
--
-- DEPLOY-ORDNING: SQL FÖRST, sedan koden.
-- Körs efter 20260613_ops_segments_placeholders.sql och 20260810_get_my_crm_jobs.sql. Idempotent.
--
-- 🧨 Kod före SQL slår ut HELA planeringstavlan, inte bara det nya. `SEGMENT_SELECT`
-- (lib/domains/planning/schedule.ts) namnger field_visible och work_description, och PostgREST
-- svarar 42703 "column does not exist" på en kolumn som inte finns — alltså failar `listSegments`,
-- och /crm/planering laddar noll segment. Inget går att placera, flytta eller ens se.
--
-- (Att flaggan defaultar till false gör bara RPC-ändringen ofarlig: den släpper igenom noll rader
-- tills någon slår på den i UI:t. Det är ett argument för att SQL:en kan köras i god tid FÖRE
-- driftsättningen — inte för att ordningen skulle vara fri.)

-- ── 1. Kolumnerna ───────────────────────────────────────────────────────────
-- field_visible ligger på ops_segments och inte på en platshållartabell för att en platshållare ÄR
-- ett segment — samma rad flyttas, pausas och raderas som vilken placering som helst.
--
-- Ingen CHECK som binder flaggan till platshållare. Ett riktigt jobb syns redan för sin besättning
-- via arbetsordern (is_user_on_work_order), så flaggan är meningslös där i dag — men en spärr som
-- säger "aldrig på ett riktigt jobb" hade låst framtiden i onödan. Det är get_my_crm_jobs som
-- avgör vad flaggan betyder, och den läser den bara på platshållarrader.
alter table public.ops_segments add column if not exists field_visible    boolean not null default false;
alter table public.ops_segments add column if not exists work_description text;

comment on column public.ops_segments.field_visible is
  'Platshållare: syns i entreprenadens feed (/mina-jobb + startsidans veckoschema) för bilens besättning. Läses bara på rader utan work_order_id.';
comment on column public.ops_segments.work_description is
  'Platshållare: vad som ska göras, skrivet av planeraren och läst av besättningen i fält.';

-- ── 2. Besättning per SEGMENT ───────────────────────────────────────────────
-- is_user_on_work_order (20260810_crm_work_order_crew_access.sql) svarar på "är den här personen på
-- det här jobbet" genom att gå via arbetsordern. En platshållare har ingen arbetsorder, så frågan
-- måste kunna ställas om ett enskilt segment.
--
-- Primitiven bryts därför ut hit, och den gamla funktionen anropar den. Alternativet — att kopiera
-- de tre grenarna till en ny funktion — hade gett två definitioner av "vem kör bilen den veckan"
-- som glider isär vid första ändringen, och den sortens divergens är tyst: boarden visar en person,
-- feeden en annan, och ingen av dem ser fel ut på egen hand.
--
-- Grenarna är oförändrade, inklusive vecko-vidgningen: veckobesättning slår standardbemanning, och
-- segmentets dagar vidgas till hela ISO-veckor innan överlappstestet (samma sak som boardens
-- crewForTruckInRange gör). Skälen står kvar i originalfilen.
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
    cross join lateral (
      select
        date_trunc('week', s.start_day)::date                      as week_start,
        (date_trunc('week', s.end_day) + interval '6 days')::date  as week_end
    ) w
    where s.id = p_segment
      and p_uid is not null
      and (
        -- 1) uttryckligen tillagd som besättning på just den här placeringen
        exists (
          select 1
          from public.ops_segment_crew c
          where c.segment_id = s.id
            and c.member_id = p_uid
        )
        -- 2) på bilens veckobesättning för veckan/veckorna jobbet ligger i
        or exists (
          select 1
          from public.ops_truck_crew tc
          where tc.truck_id = s.truck_id
            and tc.member_id = p_uid
            and tc.start_day <= w.week_end
            and tc.end_day   >= w.week_start
        )
        -- 3) på bilens standardbemanning — BARA när ingen veckobesättning överstyr den veckan
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

revoke all on function public.is_user_on_segment(uuid, uuid) from public;
grant execute on function public.is_user_on_segment(uuid, uuid) to authenticated;

-- Samma svar som förut, nu uttryckt genom primitiven: på jobbet om du är på NÅGOT av dess segment.
-- Den vidare regeln är avsiktlig och bevaras — den som körde måndagens segment kommer åt hela
-- arbetsordern, inte bara sin egen dag.
--
-- create or replace, inte drop: funktionen bär fyra RLS-policyer på crm_work_orders,
-- crm_work_order_comments och tidraderna. Signaturen måste stå still.
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
      and public.is_user_on_segment(p_uid, s.id)
  );
$$;

-- ── 3. Feeden släpper igenom flaggade platshållare ──────────────────────────
-- Drop först: returtypen får två nya kolumner, och create or replace kan inte ändra OUT-kolumner.
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
    -- the slot — but it is not a job to drive to. Without this the crew reads it as an ordinary
    -- booking under tomorrow's heading and shows up to a job that was called off. Gäller båda
    -- sorterna: en pausad platshållare ska försvinna ur feeden precis som ett pausat jobb.
    and not s.on_hold
    -- Same for a cancelled order whose segment nobody removed. Null-säker sedan joinen blev left:
    -- en platshållare har ingen status och får inte falla på jämförelsen mot null.
    and (s.work_order_id is null or wo.status is distinct from 'cancelled')
    -- THE security boundary: security definer bypasses RLS on ops_*/crm_work_orders, so
    -- membership is what scopes the result.
    and case
          when s.work_order_id is not null
            -- Oförändrat för riktiga jobb: samma helper RLS-policyerna använder, så feeden och
            -- arbetsordern den länkar till aldrig kan tycka olika om vem som är på jobbet.
            then public.is_user_on_work_order(auth.uid(), s.work_order_id)
          -- Platshållare: två villkor, båda krävs. Flaggan är planerarens medvetna beslut att
          -- publicera raden; besättningen avgör FÖR VEM. Utan det andra ledet hade en service på
          -- Bil 2 i Sandviken landat hos Borlänge-grabbarna.
          else s.field_visible and public.is_user_on_segment(auth.uid(), s.id)
        end;
$$;

revoke all on function public.get_my_crm_jobs(date, date) from public;
grant execute on function public.get_my_crm_jobs(date, date) to authenticated;

-- NOTE (v1 scope): sack counts are intentionally omitted. They are derived from the work order's
-- line_items jsonb, which is awkward in SQL and already computed on the client by
-- lib/domains/crm/materials.ts. Add later if the field view needs it up front.

-- ── Verifiering (kör efter) ─────────────────────────────────────────────────
-- 1. Kolumnerna finns och defaultar rätt — noll rader ska vara synliga innan någon slagit på något:
--
--   select count(*) filter (where field_visible) as synliga,
--          count(*) filter (where work_order_id is null) as platshallare
--   from public.ops_segments;
--
-- 2. Utbrytningen får inte ha ändrat vem som är på ett riktigt jobb. Kör den HÄR frågan FÖRE
--    migreringen och spara utskriften, kör den igen efteråt och jämför — listorna ska vara
--    identiska. (Att jämföra de två funktionerna med varandra efteråt bevisar ingenting: den ena
--    anropar numera den andra, så de kan bara vara överens.)
--
--   select wo.order_number, p.full_name
--   from public.crm_work_orders wo
--   cross join public.profiles p
--   where public.is_user_on_work_order(p.id, wo.id)
--   order by wo.order_number, p.full_name;
--
-- 3. Som installatör: en flaggad platshållare på din bil ska dyka upp, en oflaggad ska inte.
--
--   select segment_id, placeholder_title, work_description, job_day
--   from public.get_my_crm_jobs(current_date, current_date + 30)
--   where work_order_id is null;
