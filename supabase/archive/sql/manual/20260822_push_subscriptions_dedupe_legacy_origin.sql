-- Städning av push-prenumerationer som blev kvar på den gamla domänen.
--
-- ============================================================================
--  KOR INTE DEN HAR FILEN FORRAN blikk-integration-ekovilla.vercel.app AR AVSTANGD.
-- ============================================================================
--
-- Varfor: en PushSubscription-endpoint bor hos FCM/Apple, inte hos oss. Den slutar inte fungera
-- for att vi bytt doman. Sa lange den gamla adressen svarar levererar de gamla raderna notiser
-- till den gamla PWA-installationen, och den installationen ar allt en del anvandare har.
-- Raderar vi raderna nu tystnar deras notiser utan att nagon far veta det, och utan att de kan
-- sla pa dem igen fran en app de inte vet ar "fel".
--
-- Den automatiska rensningen i lib/domains/notifications/delivery.ts (raderar pa 404/410) nar
-- aldrig de har raderna, just for att endpointen fortfarande ar giltig. Darfor maste stadningen
-- goras for hand, en gang, efter nedstangningen.
--
-- Forutsatter att supabase/sql/20260822_push_subscriptions_origin.sql ar kord och att appen har
-- deployats med origin-stamplingen i app/api/push/subscription/route.ts.
--
--
-- VAD `origin is null` FAKTISKT BETYDER
-- ------------------------------------
-- Inte "gammal doman". Det betyder "raden har inte POST:ats om sedan origin-kolumnen kom", alltsa
-- en enhet som inte oppnat appen sedan deployen. Den kan lika garna vara en fullt levande dator pa
-- NYA domanen som agaren bara inte anvant pa ett tag.
--
-- Darfor finns tva raderingar nedan, i stigande risk:
--
--   DEL 2  - rader stamplade med den GAMLA domanen. Otvetydiga. Rekommenderad.
--   DEL 3  - rader utan origin. Tvetydiga. Kraver extra villkor och ett medvetet beslut.
--
-- En tidigare version av den har filen raderade rader utan origin sa fort samma anvandare hade en
-- nyare stamplad rad. Det hade tagit sallan anvanda andra-enheter - en saljare vars telefon
-- stamplats men vars dator legat orord - och tystat dem permanent utan signal. Villkoret i DEL 3
-- ar skarpt for att inte gora det.


-- ---------------------------------------------------------------------------
-- DEL 1 - omfattning. Kor den har forst och las utfallet innan du gar vidare.
-- ---------------------------------------------------------------------------

select
  count(*) filter (where origin is null)
    as okand_origin_rows,
  count(*) filter (where origin = 'https://blikk-integration-ekovilla.vercel.app')
    as gammal_doman_rows,
  count(*) filter (where origin = 'https://app.ekovilla.se')
    as ny_doman_rows,
  count(*) filter (
    where origin is not null
      and origin not in ('https://app.ekovilla.se', 'https://blikk-integration-ekovilla.vercel.app')
  ) as ovrigt_origin_rows,
  count(distinct user_id) filter (where origin is null)
    as okand_origin_users,
  count(distinct user_id) filter (where origin = 'https://blikk-integration-ekovilla.vercel.app')
    as gammal_doman_users,
  count(distinct user_id) filter (where origin = 'https://app.ekovilla.se')
    as ny_doman_users,
  (
    select count(*)
    from (
      select user_id
      from public.dashboard_push_subscriptions
      group by user_id
      having bool_or(origin is null)
         and bool_or(origin = 'https://app.ekovilla.se')
    ) bada
  ) as users_med_okand_och_ny,
  count(*) as total_rows
from public.dashboard_push_subscriptions;


-- ---------------------------------------------------------------------------
-- DEL 2 - rader stamplade med den GAMLA domanen. Rekommenderad radering.
-- ---------------------------------------------------------------------------
--
-- Otvetydiga: raden har POST:ats om FRAN den gamla adressen efter att stamplingen deployats, sa
-- enheten korde bevisligen den gamla installationen. Nar den adressen ar avstangd pekar dess
-- service worker pa en doman som inte svarar - notisen visas men klicket leder ingenstans.

-- 2a - torrkorning.
select
  id, user_id, user_agent, created_at, last_success_at, origin
from public.dashboard_push_subscriptions
where origin = 'https://blikk-integration-ekovilla.vercel.app'
order by user_id, created_at;

-- 2b - raderingen.
delete from public.dashboard_push_subscriptions
where origin = 'https://blikk-integration-ekovilla.vercel.app';


-- ---------------------------------------------------------------------------
-- DEL 3 - rader utan origin. VALFRI, och bara efter ett medvetet beslut.
-- ---------------------------------------------------------------------------
--
-- Tre villkor maste halla samtidigt, och de ar med for att inte tysta en levande enhet:
--
--   1. Anvandaren har redan en stamplad rad pa nya domanen  -> hen blir inte helt utan notiser.
--   2. Raden har inte levererat en enda notis sedan stamplingen deployades -> inga tecken pa liv.
--   3. Raden skapades fore deployen -> den kan omojligt vara en ny prenumeration.
--
-- BYT UT DATUMET nedan mot nar appen faktiskt deployades med origin-stamplingen, pa BADA stallena.
-- Lat helst nagra veckor ga forst, sa att enheter som anvands sallan hinner stampla sig sjalva.

-- 3a - torrkorning. Granska listan rad for rad; user_agent avslojar vilken enhet det ar.
select
  legacy.id,
  legacy.user_id,
  legacy.user_agent,
  legacy.created_at,
  legacy.last_success_at,
  legacy.last_failure_at
from public.dashboard_push_subscriptions as legacy
where legacy.origin is null
  and legacy.created_at < timestamptz '2026-08-22'           -- <- deploydatum
  and (legacy.last_success_at is null
       or legacy.last_success_at < timestamptz '2026-08-22')  -- <- deploydatum
  and exists (
    select 1
    from public.dashboard_push_subscriptions as fresh
    where fresh.user_id = legacy.user_id
      and fresh.origin = 'https://app.ekovilla.se'
  )
order by legacy.user_id, legacy.created_at;

-- 3b - raderingen. Kor bara nar 3a visar det du forvantar dig.
delete from public.dashboard_push_subscriptions as legacy
where legacy.origin is null
  and legacy.created_at < timestamptz '2026-08-22'           -- <- deploydatum
  and (legacy.last_success_at is null
       or legacy.last_success_at < timestamptz '2026-08-22')  -- <- deploydatum
  and exists (
    select 1
    from public.dashboard_push_subscriptions as fresh
    where fresh.user_id = legacy.user_id
      and fresh.origin = 'https://app.ekovilla.se'
  );


-- ---------------------------------------------------------------------------
-- DEL 4 - kontroll efterat.
-- ---------------------------------------------------------------------------

select
  count(*) filter (where origin is null)                                          as okand_origin_kvar,
  count(*) filter (where origin = 'https://blikk-integration-ekovilla.vercel.app') as gammal_doman_kvar,
  count(*) filter (where origin = 'https://app.ekovilla.se')                       as ny_doman_rows,
  count(distinct user_id)                                                          as users_med_notiser,
  count(*)                                                                         as total_rows
from public.dashboard_push_subscriptions;


-- ---------------------------------------------------------------------------
-- BILAGA - predikatet mot fixtures. Ofarlig: ror ingen tabell, laser ingen data.
-- ---------------------------------------------------------------------------
--
-- Kor den har for att se att villkoret i DEL 3b gor det du tror INNAN du kor det skarpt.
-- Forvantat utfall: kolumnen `ok` ska vara true pa samtliga rader.
--
-- Not om fixturen "tva anvandare som delar endpoint": det gar inte att konstruera. Kolumnen ar
-- `endpoint text not null unique` i schemat, alltsa unik over HELA tabellen och inte per anvandare.
-- Tva anvandare kan darfor aldrig dela en endpoint, och en endpoint kan aldrig heller finnas pa
-- bade gammalt och nytt origin samtidigt - push-endpoints ar per service worker-registrering,
-- och registreringen ar origin-scopad.

with fixtures (user_id, origin, created_at, last_success_at, note, expected_deleted) as (
  values
    -- A: bara okand rad, ingen ersattare. Raderas inte - da hade anvandaren blivit helt utan.
    ('a', null::text, timestamptz '2026-01-01', null::timestamptz,
     'bara okand, ingen ny rad', false),

    -- B: bara ny rad. Inte null, utanfor villkoret helt.
    ('b', 'https://app.ekovilla.se', timestamptz '2026-08-25', null::timestamptz,
     'bara ny', false),

    -- C: okand + ny rad, och den okanda visar inga tecken pa liv. Enda fallet som raderas.
    ('c', null::text, timestamptz '2026-01-01', timestamptz '2026-02-01',
     'okand, dod sedan deployen', true),
    ('c', 'https://app.ekovilla.se', timestamptz '2026-08-25', null::timestamptz,
     'ersattaren', false),

    -- D: okand + ny rad, MEN den okanda har levererat efter deployen. Levande andra-enhet.
    --    Det har ar fallet den tidigare versionen av scriptet hade tystat.
    ('d', null::text, timestamptz '2026-01-01', timestamptz '2026-09-01',
     'okand men levande', false),
    ('d', 'https://app.ekovilla.se', timestamptz '2026-08-25', null::timestamptz,
     'ny rad pa annan enhet', false),

    -- E: okand rad SKAPAD efter deployen. Kan inte vara en gammal rad.
    ('e', null::text, timestamptz '2026-09-01', null::timestamptz,
     'okand men nyare an deployen', false),
    ('e', 'https://app.ekovilla.se', timestamptz '2026-08-25', null::timestamptz,
     'ny rad', false),

    -- F: okand + aktiv rad pa GAMLA domanen, ingen rad pa den nya. DEL 2 tar den gamla, inte den har.
    ('f', null::text, timestamptz '2026-01-01', null::timestamptz,
     'okand utan ny rad', false),
    ('f', 'https://blikk-integration-ekovilla.vercel.app', timestamptz '2026-08-25', null::timestamptz,
     'aktiv pa gamla domanen', false)
),
applied as (
  select
    f.user_id,
    f.note,
    f.expected_deleted,
    -- Samma villkor som DEL 3b.
    (
      f.origin is null
      and f.created_at < timestamptz '2026-08-22'
      and (f.last_success_at is null or f.last_success_at < timestamptz '2026-08-22')
      and exists (
        select 1
        from fixtures as fresh
        where fresh.user_id = f.user_id
          and fresh.origin = 'https://app.ekovilla.se'
      )
    ) as would_delete
  from fixtures as f
)
select
  user_id,
  note,
  expected_deleted,
  would_delete,
  (would_delete = expected_deleted) as ok
from applied
order by user_id, note;
