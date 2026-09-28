-- Transporten mot återförsäljarportalen: svarscachen för inkommande anrop och kön för utgående.
--
-- BAKGRUND
-- RESELLER_PORTAL_CRM_PLAN.md, fas 1b. Portalen och CRM:et pratar bara med signerade HTTP-anrop, i båda riktningarna,
-- och gör om ett anrop vid timeout och fel. Dubbletter kommer alltså att hända, och ingen händelse får tappas.
--
--   portal_idempotency_keys   inkommande: varje behandlad Idempotency-Key och svaret som gavs. Ett upprepat anrop får
--                             samma svar och gör ingenting nytt. Tabellen är en CACHE: de riktiga dubblettskydden är
--                             affärsnycklarna (quote_id, message_id, order_id), som kommer med sina tabeller i fas 3.
--                             Samma nyckel med en annan förfrågan (annan kropp eller route) ger 422.
--   portal_outbound_events    utgående: varje händelse till portalen, tills den är levererad eller uppgiven. Kroppen
--                             lagras osignerad och signeras vid varje försök, eftersom signaturen bara gäller i
--                             300 sekunder.
--   claim_portal_outbound_events()
--                             tar nästa händelser att skicka, med `for update skip locked`, och bara den ÄLDSTA
--                             oavslutade per `ordering_key` (t.ex. ett jobb), så att ett jobbs händelser kommer fram i
--                             ordning. En händelse som fastnat i "sending" (en funktion som dog) tas om efter
--                             p_stale_after.
--
-- ÅTKOMST
-- Bara service_role, från portalens routes och utskicket. anon och authenticated får INGENTING: RLS är på, inga
-- policyer finns, och inga grants ges. Default privileges är stängda sedan 20260926134651; revoke står ändå här, så att
-- migreringen inte blir öppen i en databas där standarden inte är stängd. service_role grantas uttryckligen av samma
-- skäl åt andra hållet: default privileges gäller per databas, och i en databas utan Supabases standard hade
-- service_role annars saknat åtkomst (prövat mot en tom databas). En adminsida som ska läsa kön (fas 2b/4b)
-- får en egen migrering med en policy på crm.portal.manage.
--
-- Tabellerna ligger i public eftersom service-rollens klient bara når exponerade scheman, som husets övriga interna
-- tabeller (ops_material_orders m.fl.).
--
-- Additiv: nya objekt, inget befintligt ändras. Kan gå till prod före koden. Idempotent, kan köras om.

-- ---------------------------------------------------------------------------------------------------- inkommande

create table if not exists public.portal_idempotency_keys (
  key text primary key,
  -- sha256 (hex) av metod, sökväg och råkropp: skiljer ett omförsök från en annan förfrågan med samma nyckel.
  request_hash text not null,
  status text not null default 'processing',
  response_status integer,
  response_body jsonb,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.portal_idempotency_keys drop constraint if exists portal_idempotency_keys_key_check;
alter table public.portal_idempotency_keys
  add constraint portal_idempotency_keys_key_check check (char_length(key) between 1 and 200);

alter table public.portal_idempotency_keys drop constraint if exists portal_idempotency_keys_request_hash_check;
alter table public.portal_idempotency_keys
  add constraint portal_idempotency_keys_request_hash_check check (request_hash ~ '^[0-9a-f]{64}$');

alter table public.portal_idempotency_keys drop constraint if exists portal_idempotency_keys_status_check;
alter table public.portal_idempotency_keys
  add constraint portal_idempotency_keys_status_check check (status in ('processing', 'done'));

-- Bara svar som blir samma vid ett omförsök sparas: 2xx och 4xx. Ett 5xx släpper nyckeln, så att omförsöket körs.
alter table public.portal_idempotency_keys drop constraint if exists portal_idempotency_keys_response_check;
alter table public.portal_idempotency_keys
  add constraint portal_idempotency_keys_response_check check (
    (status = 'processing' and response_status is null and completed_at is null)
    or (status = 'done' and response_status between 200 and 499 and completed_at is not null)
  );

-- Gallringen (gamla nycklar) går på created_at.
create index if not exists portal_idempotency_keys_created_at_idx on public.portal_idempotency_keys (created_at);

alter table public.portal_idempotency_keys enable row level security;
revoke all on table public.portal_idempotency_keys from anon, authenticated;
grant select, insert, update, delete on table public.portal_idempotency_keys to service_role;

-- ----------------------------------------------------------------------------------------------------- utgående

create table if not exists public.portal_outbound_events (
  id uuid primary key default gen_random_uuid(),
  -- Idempotency-Key mot portalen, t.ex. `job.scheduled-q-2026-015-2026-10-14T08:00:00Z`. Unik: samma händelse köas en gång.
  idempotency_key text not null,
  -- Portalens route, t.ex. `/api/ekovilla/events`. Värden kommer ur RESELLER_PORTAL_URL, aldrig härifrån.
  path text not null,
  payload jsonb not null,
  -- Händelser med samma nyckel skickas i den ordning de köades, t.ex. `job:q-2026-015`.
  ordering_key text not null,
  -- En ny väntande händelse med samma nyckel ersätter äldre väntande, t.ex. ett nytt planerat datum.
  supersede_key text,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  last_http_status integer,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.portal_outbound_events drop constraint if exists portal_outbound_events_idempotency_key_key;
alter table public.portal_outbound_events
  add constraint portal_outbound_events_idempotency_key_key unique (idempotency_key);

alter table public.portal_outbound_events drop constraint if exists portal_outbound_events_idempotency_key_check;
alter table public.portal_outbound_events
  add constraint portal_outbound_events_idempotency_key_check check (char_length(idempotency_key) between 1 and 200);

-- Bara portalens egna routes: kön kan inte användas för att skicka någon annanstans.
alter table public.portal_outbound_events drop constraint if exists portal_outbound_events_path_check;
alter table public.portal_outbound_events
  add constraint portal_outbound_events_path_check check (path ~ '^/api/ekovilla/[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$');

alter table public.portal_outbound_events drop constraint if exists portal_outbound_events_ordering_key_check;
alter table public.portal_outbound_events
  add constraint portal_outbound_events_ordering_key_check check (char_length(ordering_key) between 1 and 200);

alter table public.portal_outbound_events drop constraint if exists portal_outbound_events_supersede_key_check;
alter table public.portal_outbound_events
  add constraint portal_outbound_events_supersede_key_check check (
    supersede_key is null or char_length(supersede_key) between 1 and 200
  );

alter table public.portal_outbound_events drop constraint if exists portal_outbound_events_status_check;
alter table public.portal_outbound_events
  add constraint portal_outbound_events_status_check check (status in ('pending', 'sending', 'sent', 'dead', 'superseded'));

alter table public.portal_outbound_events drop constraint if exists portal_outbound_events_attempts_check;
alter table public.portal_outbound_events
  add constraint portal_outbound_events_attempts_check check (attempts >= 0);

-- En händelse som skickas har en claim; en skickad har en tidpunkt.
alter table public.portal_outbound_events drop constraint if exists portal_outbound_events_state_check;
alter table public.portal_outbound_events
  add constraint portal_outbound_events_state_check check (
    (status <> 'sending' or claimed_at is not null)
    and (status <> 'sent' or sent_at is not null)
  );

-- Claim-funktionens sökning: oavslutade händelser per nyckel i köordning.
create index if not exists portal_outbound_events_open_idx
  on public.portal_outbound_events (ordering_key, created_at, id)
  where status in ('pending', 'sending');

create index if not exists portal_outbound_events_supersede_idx
  on public.portal_outbound_events (supersede_key)
  where status = 'pending';

alter table public.portal_outbound_events enable row level security;
revoke all on table public.portal_outbound_events from anon, authenticated;
grant select, insert, update, delete on table public.portal_outbound_events to service_role;

-- --------------------------------------------------------------------------------------------------- claim

-- Nästa händelser att skicka, markerade "sending". Per ordering_key bara den äldsta oavslutade ("huvudet"): en
-- händelse som skickas håller kvar resten av sin nyckel tills den är klar. `for update skip locked` med villkoren på
-- själva raden gör att två samtidiga utskick aldrig tar samma händelse — i READ COMMITTED prövas villkoren om mot den
-- nyaste versionen av en rad som hunnit ändras.
create or replace function public.claim_portal_outbound_events(
  p_limit integer default 20,
  p_stale_after interval default interval '2 minutes'
)
returns setof public.portal_outbound_events
language sql
volatile
security invoker
set search_path = ''
as $$
  with heads as (
    select distinct on (e.ordering_key) e.id, e.status, e.next_attempt_at, e.claimed_at, e.created_at
      from public.portal_outbound_events e
     where e.status in ('pending', 'sending')
     order by e.ordering_key, e.created_at, e.id
  ),
  ready as (
    select h.id
      from heads h
     where (h.status = 'pending' and h.next_attempt_at <= now())
        or (h.status = 'sending' and h.claimed_at < now() - p_stale_after)
     order by h.created_at, h.id
     limit greatest(p_limit, 0)
  ),
  locked as (
    select e.id
      from public.portal_outbound_events e
     where e.id in (select r.id from ready r)
       and (
         (e.status = 'pending' and e.next_attempt_at <= now())
         or (e.status = 'sending' and e.claimed_at < now() - p_stale_after)
       )
       for update skip locked
  )
  update public.portal_outbound_events e
     set status = 'sending',
         claimed_at = now(),
         attempts = e.attempts + 1
    from locked l
   where e.id = l.id
  returning e.*;
$$;

revoke all on function public.claim_portal_outbound_events(integer, interval) from public, anon, authenticated;
grant execute on function public.claim_portal_outbound_events(integer, interval) to service_role;

-- ------------------------------------------------------------------------------------------------ efterkontroll

-- Pröva effekten, inte hur grantsen råkar vara skrivna: ingen session når tabellerna eller funktionen, service_role
-- når dem, och RLS är på.
do $$
declare
  who text;
  tbl text;
begin
  foreach tbl in array array['public.portal_idempotency_keys', 'public.portal_outbound_events'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = tbl::regclass) then
      raise exception 'portaltransporten: RLS är inte på för %', tbl;
    end if;
    foreach who in array array['anon', 'authenticated'] loop
      if has_table_privilege(who, tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
        raise exception 'portaltransporten: % har rättigheter på %', who, tbl;
      end if;
    end loop;
    if not has_table_privilege('service_role', tbl, 'SELECT,INSERT,UPDATE,DELETE') then
      raise exception 'portaltransporten: service_role saknar rättigheter på %', tbl;
    end if;
  end loop;

  foreach who in array array['anon', 'authenticated'] loop
    if has_function_privilege(who, 'public.claim_portal_outbound_events(integer, interval)', 'EXECUTE') then
      raise exception 'portaltransporten: % kan köra claim_portal_outbound_events', who;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.claim_portal_outbound_events(integer, interval)', 'EXECUTE') then
    raise exception 'portaltransporten: service_role kan inte köra claim_portal_outbound_events';
  end if;
end $$;
