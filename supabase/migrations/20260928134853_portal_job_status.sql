-- Status tillbaka till portalen: markeringen, det senast köade läget och Fortnox-omförsöken.
--
-- BAKGRUND
-- RESELLER_PORTAL_CRM_PLAN.md, fas 4b ("Status tillbaka till portalen"). Butiken ska se när dess jobb är bekräftat,
-- planerat, utfört, fakturerat eller avbrutet. Statusen skrivs från ett tiotal ställen i koden (PATCH-routen,
-- planeringens statusbyte, fakturavägarna ...) och datumen av databasen själv (fas 4a). Därför:
--
--   DATABASEN MARKERAR. crm_work_orders_mark_portal_job (AFTER-trigger på crm_work_orders) sätter sync_requested_at
--   på portaljobbet när ordern byter status, planerat datum eller Fortnox-nummer, och när ordern raderas. Det täcker
--   varje kodväg, också sådana som skrivs senare. En vanlig order (utan portaljobb) träffar ingen rad.
--   TYPESCRIPT RÄKNAR. Cron-utskicket tar de markerade jobben, härleder vad butiken ska se (jobState.ts), köar
--   skillnaden mot det som senast köats (sync_state) och skickar kön.
--
--   sync_requested_at     satt = jobbet behöver räknas om. Nollas av utskicket, bara om ingen ny ändring kommit.
--   sync_state            det senast köade läget (jsonb, ägs av jobState.ts).
--   sync_pending_events   händelser som är beslutade men kanske inte köade än. Sparas i samma steg som sync_state och
--                         köas efteråt, så att en krasch mitt i varken tappar eller dubblerar en händelse.
--   sync_version          krockkontroll mellan två utskick som går samtidigt (en körning kan ta ~70 s).
--   synced_at             senaste gången jobbet räknades om.
--
-- FORTNOX-OMFÖRSÖKEN (William 2026-09-28): bara efter ett tekniskt fel eller en process som dog, 5 min, 15 min, 1 h och
-- sedan varje timme i 24 h, med kontrollerna före varje försök. Saknas något på kundkortet försöker den aldrig.
--   fortnox_next_attempt_at   nästa försök; null = inget planerat (klart, stoppat av kontrollen eller uppgivet).
--   fortnox_attempts          misslyckade tekniska försök hittills.
--   fortnox_retry_until       när omförsöken ges upp.
--
-- SECURITY DEFINER: sessionen ändrar arbetsordern (RLS släpper den ansvariga och admin) men får aldrig skriva i
-- crm_portal_jobs. Som invoker hade markeringen uppdaterat 0 rader utan fel. Fast search_path (tom), ingen EXECUTE för
-- någon roll. Samma form som ops_segments_sync_planned_days (fas 4a), vars skrivning av planerat datum alltså också
-- markerar jobbet.
--
-- ÅTKOMST
-- De nya kolumnerna är service-rollens. Sessionen läser, som förut, bara brickans kolumner, plus quote_id: portalsidans
-- flik "Utskick" (crm.portal.manage) läser kön med sessionen och känner igen jobbet på könyckeln job:<quote_id>.
-- quote_id är portalens id för offerten; brickan visar redan offertnumret. RLS på raderna är oförändrad.
--
-- Additiv: nya kolumner, en ny trigger, en kolumngrant till. Kan gå till prod före koden. Idempotent, kan köras om.

-- Arbetsordrarna först, sedan jobben: en order som raderas håller crm_work_orders och väntar på crm_portal_jobs (FK:n
-- nollar work_order_id). Tog migreringen jobben först och ordrarna sist (create trigger) hade de kunnat låsa varandra.
-- I ett do-block: supabase db push kör filen utan transaktionsblock, och där vägrar LOCK TABLE (prövat i fas 4a).
do $$ begin lock table public.crm_work_orders in share row exclusive mode; end $$;

alter table public.crm_portal_jobs add column if not exists sync_requested_at timestamptz;
alter table public.crm_portal_jobs add column if not exists sync_state jsonb not null default '{}'::jsonb;
alter table public.crm_portal_jobs add column if not exists sync_pending_events jsonb not null default '[]'::jsonb;
alter table public.crm_portal_jobs add column if not exists sync_version integer not null default 0;
alter table public.crm_portal_jobs add column if not exists synced_at timestamptz;
alter table public.crm_portal_jobs add column if not exists fortnox_next_attempt_at timestamptz;
alter table public.crm_portal_jobs add column if not exists fortnox_attempts integer not null default 0;
alter table public.crm_portal_jobs add column if not exists fortnox_retry_until timestamptz;

alter table public.crm_portal_jobs drop constraint if exists crm_portal_jobs_sync_state_check;
alter table public.crm_portal_jobs
  add constraint crm_portal_jobs_sync_state_check check (jsonb_typeof(sync_state) = 'object');
alter table public.crm_portal_jobs drop constraint if exists crm_portal_jobs_sync_pending_events_check;
alter table public.crm_portal_jobs
  add constraint crm_portal_jobs_sync_pending_events_check check (jsonb_typeof(sync_pending_events) = 'array');
alter table public.crm_portal_jobs drop constraint if exists crm_portal_jobs_sync_version_check;
alter table public.crm_portal_jobs add constraint crm_portal_jobs_sync_version_check check (sync_version >= 0);
alter table public.crm_portal_jobs drop constraint if exists crm_portal_jobs_fortnox_attempts_check;
alter table public.crm_portal_jobs add constraint crm_portal_jobs_fortnox_attempts_check check (fortnox_attempts >= 0);

create index if not exists crm_portal_jobs_sync_requested_idx
  on public.crm_portal_jobs (sync_requested_at) where sync_requested_at is not null;
create index if not exists crm_portal_jobs_fortnox_next_attempt_idx
  on public.crm_portal_jobs (fortnox_next_attempt_at) where fortnox_next_attempt_at is not null;

comment on column public.crm_portal_jobs.sync_requested_at is
  'Satt = jobbet behöver räknas om mot portalen. Sätts av triggern crm_work_orders_mark_portal_job, nollas av utskicket.';
comment on column public.crm_portal_jobs.sync_state is
  'Det senast köade läget mot portalen (lib/domains/portal/jobState.ts). Skrivs bara av utskicket.';
comment on column public.crm_portal_jobs.sync_pending_events is
  'Beslutade händelser som köas efter att sync_state sparats; tom när allt är köat.';

-- ------------------------------------------------------------------------------------------------ markeringen

create or replace function public.crm_work_orders_mark_portal_job()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  wo uuid;
begin
  if tg_op = 'DELETE' then
    wo := old.id;
  elsif (old.status, old.planned_start_day, old.planned_end_day, old.fortnox_order_number)
        is not distinct from (new.status, new.planned_start_day, new.planned_end_day, new.fortnox_order_number) then
    return null;
  else
    wo := new.id;
  end if;

  -- reserved_work_order_id och inte work_order_id: den senare nollas (on delete set null) när ordern raderas.
  -- clock_timestamp och inte now(): två ändringar i olika transaktioner får aldrig samma markering.
  update public.crm_portal_jobs j
     set sync_requested_at = pg_catalog.clock_timestamp()
   where j.reserved_work_order_id = wo;

  return null;
end;
$$;

revoke all on function public.crm_work_orders_mark_portal_job() from public, anon, authenticated, service_role;

drop trigger if exists crm_work_orders_mark_portal_job on public.crm_work_orders;
create trigger crm_work_orders_mark_portal_job
  after delete or update of status, planned_start_day, planned_end_day, fortnox_order_number on public.crm_work_orders
  for each row execute function public.crm_work_orders_mark_portal_job();

-- ------------------------------------------------------------------------------------------------ åtkomst

grant select (quote_id) on table public.crm_portal_jobs to authenticated;

-- ------------------------------------------------------------------------------------------------ ifyllnaden

-- Jobb som redan har en arbetsorder räknas om en gång, så att de får sitt första läge (i prod finns inga än).
update public.crm_portal_jobs
   set sync_requested_at = pg_catalog.clock_timestamp()
 where work_order_created_at is not null
   and sync_requested_at is null
   and sync_state = '{}'::jsonb;

-- ------------------------------------------------------------------------------------------------ efterkontroll

do $$
declare
  col text;
  priv text;
  cfg text[];
  n integer;
begin
  -- Sessionen: läser brickans kolumner och quote_id, inget annat, skriver ingenting. anon ingenting.
  foreach col in array array['quote_id', 'work_order_id', 'quote_number', 'store_name', 'received_at'] loop
    if not has_column_privilege('authenticated', 'public.crm_portal_jobs', col, 'SELECT') then
      raise exception 'portalens status: authenticated kan inte läsa crm_portal_jobs.%', col;
    end if;
  end loop;
  foreach col in array array['sync_requested_at', 'sync_state', 'sync_pending_events', 'sync_version', 'synced_at',
                             'fortnox_next_attempt_at', 'fortnox_attempts', 'fortnox_retry_until', 'payload',
                             'customer_id', 'assigned_to', 'reserved_work_order_id'] loop
    if has_column_privilege('authenticated', 'public.crm_portal_jobs', col, 'SELECT') then
      raise exception 'portalens status: authenticated kan läsa crm_portal_jobs.%', col;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.crm_portal_jobs', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'portalens status: authenticated har rättigheter på tabellnivå';
  end if;
  if has_any_column_privilege('authenticated', 'public.crm_portal_jobs', 'INSERT,UPDATE,REFERENCES') then
    raise exception 'portalens status: authenticated kan skriva en kolumn';
  end if;
  if has_any_column_privilege('anon', 'public.crm_portal_jobs', 'SELECT,INSERT,UPDATE,REFERENCES') then
    raise exception 'portalens status: anon har rättigheter på en kolumn';
  end if;
  -- En kommalista svarar sant om NÅGON finns; varje rättighet prövas därför för sig.
  foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', 'public.crm_portal_jobs', priv) then
      raise exception 'portalens status: service_role saknar % på tabellen', priv;
    end if;
  end loop;

  -- Markeringen: security definer, tomt search_path, samma ägare som tabellerna, ingen roll kör den.
  select p.proconfig into cfg from pg_catalog.pg_proc p
   where p.oid = 'public.crm_work_orders_mark_portal_job()'::regprocedure and p.prosecdef
     and p.proowner = (select c.relowner from pg_catalog.pg_class c where c.oid = 'public.crm_portal_jobs'::regclass);
  if cfg is null or cfg <> array['search_path=""'] then
    raise exception 'portalens status: crm_work_orders_mark_portal_job är inte security definer med tomt search_path och tabellens ägare (%)', cfg;
  end if;
  foreach col in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(col, 'public.crm_work_orders_mark_portal_job()', 'EXECUTE') then
      raise exception 'portalens status: % kan köra crm_work_orders_mark_portal_job', col;
    end if;
  end loop;

  -- Triggern: efter radering och ändring av de fyra kolumnerna (tgtype: 1 rad, 8 delete, 16 update).
  select count(*) into n from pg_catalog.pg_trigger t
   where t.tgrelid = 'public.crm_work_orders'::regclass and t.tgname = 'crm_work_orders_mark_portal_job'
     and t.tgenabled = 'O' and t.tgtype = 1 + 8 + 16
     and t.tgfoid = 'public.crm_work_orders_mark_portal_job()'::regprocedure
     and (select array_agg(a.attname::text order by a.attname) from pg_catalog.pg_attribute a
           where a.attrelid = t.tgrelid and a.attnum = any(t.tgattr))
         = array['fortnox_order_number', 'planned_end_day', 'planned_start_day', 'status'];
  if n <> 1 then raise exception 'portalens status: markeringen på crm_work_orders saknas eller är fel'; end if;

  -- Kolumnerna finns med rätt typ.
  select count(*) into n from pg_catalog.pg_attribute a
   where a.attrelid = 'public.crm_portal_jobs'::regclass and not a.attisdropped and (a.attname, a.atttypid) in (
     ('sync_requested_at', 'timestamptz'::regtype), ('sync_state', 'jsonb'::regtype),
     ('sync_pending_events', 'jsonb'::regtype), ('sync_version', 'integer'::regtype),
     ('synced_at', 'timestamptz'::regtype), ('fortnox_next_attempt_at', 'timestamptz'::regtype),
     ('fortnox_attempts', 'integer'::regtype), ('fortnox_retry_until', 'timestamptz'::regtype));
  if n <> 8 then raise exception 'portalens status: % av 8 nya kolumner finns med rätt typ', n; end if;
end $$;
