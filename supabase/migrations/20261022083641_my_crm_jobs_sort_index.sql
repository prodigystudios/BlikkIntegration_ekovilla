-- Startsidans arbetsschema: get_my_crm_jobs bär placeringens sort_index.
--
-- VARFÖR
-- Planeraren väljer vilket jobb som görs först när flera ligger på samma bil samma dag ("Ordning på dagen").
-- Montörernas schema på startsidan hämtade ordningen för de gamla Blikk-raderna (planning_segments.sort_index)
-- men aldrig för CRM-jobben: feeden saknade kolumnen, och kortens "1/2" räknades på ordernumret. Planerarens val
-- nådde alltså aldrig dem som kör jobben. Montörerna läser inte ops_segments själva (RLS kräver
-- planning.schedule.read), så kolumnen måste komma genom feeden.
--
-- VAD
-- En kolumn till, sist: s.sort_index. Kroppen är i övrigt baslinjens, ord för ord — besättningsvillkoret per
-- segment och dag står kvar (tests/planning/myCrmJobsFeedSql.test.ts vaktar det).
--
-- DROP + CREATE: returtypen ändras, och det kan CREATE OR REPLACE inte göra. Båda i samma transaktion, så ingen
-- anropare ser funktionen saknas. drop+create ger en funktion utan grants: EXECUTE åt authenticated, som är den
-- som anropar (startsidan, /mina-jobb, /tid). anon fick det tidigare via baslinjen men har inget att hämta —
-- utan auth.uid() matchar ingen besättning. service_role får allt via default privileges.
--
-- Additiv för anroparna: den gamla koden läser kolumnerna på namn och ser inte den nya. Kan gå till prod före
-- koden.

set lock_timeout = '5s';

drop function if exists public.get_my_crm_jobs(date, date);

create function public.get_my_crm_jobs (
  start_date date DEFAULT NULL::date,
  end_date   date DEFAULT NULL::date
)
  RETURNS TABLE (
    segment_id           uuid,
    work_order_id        uuid,
    order_number         text,
    fortnox_order_number text,
    project_name         text,
    customer             text,
    job_day              date,
    start_day            date,
    end_day              date,
    truck                text,
    truck_color          text,
    job_type             text,
    status               text,
    work_address         jsonb,
    customer_address     jsonb,
    placeholder_title    text,
    work_description     text,
    sort_index           integer
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
    s.work_description,
    -- Planerarens ordning på dagen. Talet är bara meningsfullt mot andra placeringar på samma bil
    -- samma dag, i jämförelsen sort_index → start_day → id (compareBoardOrder, order.ts).
    s.sort_index
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
$function$;

revoke all on function public.get_my_crm_jobs(date, date) from public;
revoke all on function public.get_my_crm_jobs(date, date) from anon;
grant execute on function public.get_my_crm_jobs(date, date) to authenticated;
