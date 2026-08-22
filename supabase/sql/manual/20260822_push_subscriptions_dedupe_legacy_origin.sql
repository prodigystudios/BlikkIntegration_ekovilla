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


-- ---------------------------------------------------------------------------
-- DEL 1 - omfattning. Kor den har forst och las utfallet innan du gar vidare.
-- ---------------------------------------------------------------------------
--
-- Om kolumnen tolkas: 'null' betyder att raden inte POST:ats om sedan origin-kolumnen kom, alltsa
-- en enhet som inte hort av sig pa lange. En rad som stamplats med den GAMLA adressen ar tvartom
-- en enhet som fortfarande ar aktiv dar - den ar den kansligaste gruppen, och DEL 2 ror den inte.

select
  count(*) filter (where origin is null)
    as legacy_null_rows,
  count(*) filter (where origin = 'https://blikk-integration-ekovilla.vercel.app')
    as legacy_old_origin_rows,
  count(*) filter (where origin = 'https://app.ekovilla.se')
    as new_origin_rows,
  count(*) filter (
    where origin is not null
      and origin not in ('https://app.ekovilla.se', 'https://blikk-integration-ekovilla.vercel.app')
  ) as other_origin_rows,
  count(distinct user_id) filter (where origin is null)
    as legacy_null_users,
  count(distinct user_id) filter (where origin = 'https://blikk-integration-ekovilla.vercel.app')
    as legacy_old_origin_users,
  count(distinct user_id) filter (where origin = 'https://app.ekovilla.se')
    as new_origin_users,
  (
    select count(*)
    from (
      select user_id
      from public.dashboard_push_subscriptions
      group by user_id
      having bool_or(origin is null)
         and bool_or(origin = 'https://app.ekovilla.se')
    ) both_sides
  ) as users_with_legacy_null_and_new,
  count(*) as total_rows
from public.dashboard_push_subscriptions;


-- ---------------------------------------------------------------------------
-- DEL 2a - torrkorning. Exakt de rader som DEL 2b skulle radera.
-- ---------------------------------------------------------------------------
--
-- Jamforelsen gors pa created_at, inte updated_at: updated_at flyttas av triggern
-- set_timestamp_dashboard_push_subscriptions vid varje omPOST och sager darfor ingenting om nar
-- raden faktiskt skapades.

select
  legacy.id,
  legacy.user_id,
  legacy.user_agent,
  legacy.created_at    as legacy_created_at,
  legacy.last_success_at as legacy_last_success_at,
  fresh.created_at     as replacement_created_at
from public.dashboard_push_subscriptions as legacy
join lateral (
  select f.created_at
  from public.dashboard_push_subscriptions as f
  where f.user_id = legacy.user_id
    and f.origin = 'https://app.ekovilla.se'
    and f.created_at > legacy.created_at
  order by f.created_at desc
  limit 1
) as fresh on true
where legacy.origin is null
order by legacy.user_id, legacy.created_at;


-- ---------------------------------------------------------------------------
-- DEL 2b - raderingen. Kor bara nar DEL 2a visar det du forvantar dig.
-- ---------------------------------------------------------------------------
--
-- Villkoret ar medvetet snavt: bara rader utan origin, och bara nar samma anvandare redan har en
-- NYARE rad pa den nya domanen. En anvandare som inte hunnit sla pa notiser igen behaller sin
-- gamla rad och sina notiser.
--
-- Rader stamplade med den gamla domanen ror vi inte. De tillhor enheter som bevisligen fortfarande
-- anvander den gamla installationen, och de ska fa tystna av sig sjalva nar den slutar svara -
-- eller stadas i en separat, medveten omgang.

delete from public.dashboard_push_subscriptions as legacy
where legacy.origin is null
  and exists (
    select 1
    from public.dashboard_push_subscriptions as fresh
    where fresh.user_id = legacy.user_id
      and fresh.origin = 'https://app.ekovilla.se'
      and fresh.created_at > legacy.created_at
  );


-- ---------------------------------------------------------------------------
-- DEL 3 - kontroll efterat. Ska visa 0 kvarvarande null-rader for de anvandare
-- som har en ny rad.
-- ---------------------------------------------------------------------------

select
  count(*) filter (where origin is null)                   as legacy_null_rows_kvar,
  count(*) filter (where origin = 'https://app.ekovilla.se') as new_origin_rows,
  count(*)                                                 as total_rows
from public.dashboard_push_subscriptions;


-- ---------------------------------------------------------------------------
-- BILAGA - predikatet mot fixtures. Ofarlig: ror ingen tabell, laser ingen data.
-- ---------------------------------------------------------------------------
--
-- Kor den har for att se att villkoret i DEL 2b gor det du tror INNAN du kor det skarpt.
-- Den bygger sina egna rader i en CTE och tillampar exakt samma villkor.
--
-- Forvantat utfall: kolumnen `ok` ska vara true pa samtliga rader.
--
-- Not om fixturen "tva anvandare som delar endpoint": det gar inte att konstruera. Kolumnen ar
-- `endpoint text not null unique` i schemat, alltsa unik over HELA tabellen och inte per anvandare.
-- Tva anvandare kan darfor aldrig dela en endpoint, och en endpoint kan aldrig heller finnas pa
-- bade gammalt och nytt origin samtidigt - push-endpoints ar per service worker-registrering,
-- och registreringen ar origin-scopad.

with fixtures (user_id, origin, created_at, note, expected_deleted) as (
  values
    -- A: bara legacy-rad, ingen ersattare. Ska INTE raderas - anvandaren har inga notiser alls om vi tar den.
    ('a', null::text,                                            timestamptz '2026-01-01', 'bara legacy',              false),

    -- B: bara ny rad. Inte null, alltsa utanfor villkoret helt.
    ('b', 'https://app.ekovilla.se',                       timestamptz '2026-08-01', 'bara ny',                  false),

    -- C: legacy + NYARE ny rad. Det enda fallet som ska raderas.
    ('c', null::text,                                            timestamptz '2026-01-01', 'legacy med ersattare',     true),
    ('c', 'https://app.ekovilla.se',                       timestamptz '2026-08-01', 'ersattaren',               false),

    -- D: legacy + ny rad som ar ALDRE. Villkoret kraver created_at >, sa legacy-raden star kvar.
    ('d', null::text,                                            timestamptz '2026-08-01', 'legacy nyare an "ny"',     false),
    ('d', 'https://app.ekovilla.se',                       timestamptz '2026-01-01', 'aldre ny rad',             false),

    -- E: legacy + aktiv rad pa GAMLA originet. Ingen ersattare pa nya domanen finns.
    ('e', null::text,                                            timestamptz '2026-01-01', 'legacy',                   false),
    ('e', 'https://blikk-integration-ekovilla.vercel.app', timestamptz '2026-08-01', 'aktiv pa gamla domanen',   false)
),
applied as (
  select
    f.user_id,
    f.note,
    f.expected_deleted,
    -- Samma villkor som DEL 2b.
    (
      f.origin is null
      and exists (
        select 1
        from fixtures as fresh
        where fresh.user_id = f.user_id
          and fresh.origin = 'https://app.ekovilla.se'
          and fresh.created_at > f.created_at
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
