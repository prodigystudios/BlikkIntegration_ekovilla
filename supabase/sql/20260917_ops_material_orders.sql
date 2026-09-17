-- Materialbeställningar till fabriken: en rad = ett beställningstillfälle = ett mail.
--
-- BAKGRUND
-- Etapp 4 av lagerspåret (plan: ~/.claude/plans/etapp4-bestallningsmail.md). Beslut med William
-- 2026-09-11: inga automatiska utskick, ETT mail per tillfälle till EN leverantör med alla rader i lasset,
-- ett utkast som delas mellan admins tills det skickas eller slängs. Mallen bor på leverantören
-- (20260917_ops_material_suppliers_order_email.sql).
--
-- KÄRNINVARIANTER
-- ⚠️ BESTÄLLDA SÄCKAR RÖR ALDRIG SALDOT. Beställningen skapar väntade leveranser (ops_expected_deliveries),
--    och bara receive_expected_delivery gör dem till lager.
-- ⚠️ EN VÄNTAD LEVERANS RÄKNAS SOM INFLÖDE I SAMMA STUND SOM DEN FINNS. Därför skapas raderna först NÄR
--    Resend har tagit emot mailet, i samma transaktion som ordern blir 'sent' (finalize_material_order).
--    Ett misslyckat eller oklart utskick får aldrig tysta en brist.
-- ⚠️ MOTTAGAREN KOMMER ALDRIG FRÅN KLIENTEN. Den slås upp via supplier_id och snapshottas här.
-- ⚠️ ETT NÄTVERKSFEL FÅR ALDRIG BLI TVÅ LASS. Koden skickar det lagrade mailet byte för byte med en
--    idempotensnyckel per försök; tabellen håller försöksnumret och fönstret.
--
-- STATUS
--   draft    utkast, går att redigera (optimistiskt lås på revision)
--   sending  ett utskick pågår eller har ett oklart utfall. Innehållet är fryst.
--   sent     slutgiltig. Resend tog emot mailet (provider_message_id) eller en människa har verifierat
--            det (verified_by), och de väntade leveranserna är skapade.
--
-- ⚠️ STATUSÖVERGÅNGAR SKER BARA I RPC:ERNA NEDAN. Vakttriggern släpper igenom en ändring av status bara
-- när transaktionen satt flaggan `ekovilla.material_order_rpc`, vilket bara funktionerna gör. En direkt
-- PostgREST-skrivning kan alltså redigera ett utkast och bokföra ett felmeddelande — men aldrig markera en
-- order som skickad utan att mailet gått, och aldrig lägga ett utkast i 'sending' förbi claim-logiken.
--
-- LÄSBARHET
-- Leverantörsnamn, mottagare och brödtext finns BARA här, bakom planning.depot.manage. De väntade
-- leveranserna (schedule.read, publicerade i realtime) får bara ett naket order_id. Tabellen publiceras
-- INTE i realtime — postgres_changes skickar hela raden vid INSERT oavsett RLS.
--
-- DEPLOY-ORDNING
-- ADDITIV. Ny tabell, ny nullbar kolumn på ops_expected_deliveries, nya funktioner. Två befintliga saker
-- skärps: forward_only-triggern på ops_expected_deliveries (order_id och depå/material på en beställd rad
-- låses) och dess INSERT/DELETE-policy (order_id is null). Dagens kod sätter aldrig order_id och raderar
-- aldrig, så ordningen mot koden är fri — men API:t för beställningar (etapp 4d) kräver filen.
--
-- Kör EFTER 20260910_ops_expected_deliveries.sql, 20260910_ops_material_suppliers.sql och
-- 20260608_permissions_model.sql (has_permission).
--
-- Kör i Supabase SQL editor. Idempotent — kör den TVÅ gånger innan du litar på påståendet.
-- Inga tecken utanför BMP i den här filen.

-- ---------------------------------------------------------------------------
-- Tabell
-- ---------------------------------------------------------------------------

create table if not exists public.ops_material_orders (
  id                 uuid primary key default gen_random_uuid(),
  -- "#14" i ämnesraden, i UI:t och när fabriken ringer.
  order_no           bigint generated always as identity unique,
  -- SET NULL: en raderad leverantör får inte ta med sig vad en skickad beställning påstår sig ha gått
  -- till. supplier_name och recipient_email är snapshottade nedan.
  supplier_id        uuid references public.ops_material_suppliers(id) on delete set null,
  status             text not null default 'draft',

  -- Stockrader, byggda av SERVERN ur databasen: depot_id, depot_name, depot_location, material, sacks,
  -- sacks_per_pallet, requested_on (+ prognosens snapshot). Blir väntade leveranser vid finalize.
  lines              jsonb not null default '[]'::jsonb,
  -- "Övrigt på lasset": fri text (valfri depå). Rör ALDRIG lagret och blir aldrig en väntad leverans.
  other_lines        jsonb not null default '[]'::jsonb,
  message            text,
  -- Optimistiskt lås för det delade utkastet: varje innehållsändring räknar upp den med exakt ett.
  revision           integer not null default 1,

  -- Fryst vid Granska: exakt det mail som skickas.
  supplier_name      text,
  recipient_email    text,
  from_address       text,
  reply_to           text,
  bcc                text,
  email_language     text,
  email_subject      text,
  email_text         text,
  -- Namnet som står som avsändare i mailet ({avsändare}). Den som granskade senast.
  composed_by_name   text,

  -- Utskicksbokföring.
  send_attempt       integer not null default 1,
  -- När försöket startade. Resends idempotensnyckel gäller 24 timmar; efter 23 h får samma nyckel inte
  -- återanvändas, och en människa avgör om mailet gick fram.
  attempt_started_at timestamptz,
  -- Senaste gången ett utskick påbörjades inom försöket. Yngre än 2 minuter = pågår.
  last_try_at        timestamptz,
  send_error         text,
  send_error_code    text,
  provider_message_id text,
  sent_at            timestamptz,
  sent_by            uuid references public.profiles(id) on delete set null,
  sent_by_name       text,
  verified_by        uuid references public.profiles(id) on delete set null,
  verified_by_name   text,

  created_by         uuid references public.profiles(id) on delete set null,
  created_by_name    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.ops_material_orders drop constraint if exists ops_material_orders_status_check;
alter table public.ops_material_orders
  add constraint ops_material_orders_status_check check (status in ('draft', 'sending', 'sent'));

alter table public.ops_material_orders drop constraint if exists ops_material_orders_shape_check;
alter table public.ops_material_orders
  add constraint ops_material_orders_shape_check check (
    jsonb_typeof(lines) = 'array'
    and jsonb_typeof(other_lines) = 'array'
    and jsonb_array_length(other_lines) <= 20
    and (message is null or char_length(message) <= 1000)
    and (email_language is null or email_language in ('sv', 'en'))
    and revision >= 1
    and send_attempt >= 1
  );

-- En öppen order per fabrik: två admins hamnar i SAMMA utkast, och ett olöst utskick blockerar en ny
-- beställning till samma fabrik tills någon avgjort om det gick fram.
create unique index if not exists ops_material_orders_one_open_per_supplier
  on public.ops_material_orders (supplier_id) where status in ('draft', 'sending');
create index if not exists ops_material_orders_status_sent_idx
  on public.ops_material_orders (status, sent_at desc);

-- ---------------------------------------------------------------------------
-- Vakttrigger
-- ---------------------------------------------------------------------------
--
-- ⚠️ EN POLICY VÄLJER RADER, ALDRIG KOLUMNER. UPDATE-policyn släpper in depot.manage på ett utkast, men kan
-- inte hindra samma anrop från att skriva status, provider_message_id eller ett redan fryst mail. Reglerna
-- är därför databasregler här.

create or replace function public.ops_material_orders_guard()
returns trigger
language plpgsql
as $$
declare
  v_rpc boolean := coalesce(current_setting('ekovilla.material_order_rpc', true), '') = 'on';
  v_content_changed boolean;
begin
  if new.id is distinct from old.id or new.order_no is distinct from old.order_no or new.created_at is distinct from old.created_at then
    raise exception 'material_order_identity_is_final' using errcode = '23514';
  end if;

  -- FK-kaskaderna (ON DELETE SET NULL) går genom den här triggern, också för en skickad order. De fyra
  -- referenserna får därför alltid bli NULL — men aldrig bytas mot någon annan. sent_by och verified_by
  -- sätts dessutom (från null) av RPC:erna.
  if new.supplier_id is distinct from old.supplier_id and new.supplier_id is not null then
    raise exception 'material_order_supplier_is_final' using errcode = '23514';
  end if;
  if new.created_by is distinct from old.created_by and new.created_by is not null then
    raise exception 'material_order_creator_is_final' using errcode = '23514';
  end if;
  if (new.sent_by is distinct from old.sent_by and new.sent_by is not null and not v_rpc)
     or (new.verified_by is distinct from old.verified_by and new.verified_by is not null and not v_rpc) then
    raise exception 'material_order_send_state_via_rpc_only' using errcode = '42501';
  end if;

  -- En skickad order är slutgiltig. Allt utom de FK-nullbara referenserna och updated_at jämförs.
  if old.status = 'sent' then
    if (new.status, new.lines, new.other_lines, new.message, new.revision, new.supplier_name,
        new.recipient_email, new.from_address, new.reply_to, new.bcc, new.email_language,
        new.email_subject, new.email_text, new.composed_by_name, new.send_attempt,
        new.attempt_started_at, new.last_try_at, new.send_error, new.send_error_code,
        new.provider_message_id, new.sent_at, new.sent_by_name, new.verified_by_name, new.created_by_name)
       is distinct from
       (old.status, old.lines, old.other_lines, old.message, old.revision, old.supplier_name,
        old.recipient_email, old.from_address, old.reply_to, old.bcc, old.email_language,
        old.email_subject, old.email_text, old.composed_by_name, old.send_attempt,
        old.attempt_started_at, old.last_try_at, old.send_error, old.send_error_code,
        old.provider_message_id, old.sent_at, old.sent_by_name, old.verified_by_name, old.created_by_name)
    then
      raise exception 'material_order_sent_is_final' using errcode = '23514';
    end if;
    new.updated_at := now();
    return new;
  end if;

  -- ⚠️ UTSKICKSTILLSTÅNDET ÄNDRAS BARA I RPC:ERNA. Inte bara status: kunde en direkt skrivning flytta
  -- attempt_started_at hade 23-timmarsfönstret gått att förlänga, och ett omförsök efter att Resends
  -- nyckel gått ut hade blivit ett ANDRA mail. Samma för försöksnumret (ny nyckel) och beviset på utskick.
  if not v_rpc and (new.status, new.send_attempt, new.attempt_started_at, new.last_try_at,
                    new.provider_message_id, new.sent_at, new.sent_by_name, new.verified_by_name)
                   is distinct from
                   (old.status, old.send_attempt, old.attempt_started_at, old.last_try_at,
                    old.provider_message_id, old.sent_at, old.sent_by_name, old.verified_by_name) then
    raise exception 'material_order_send_state_via_rpc_only' using errcode = '42501';
  end if;

  -- De tillåtna vägarna, också för RPC:erna.
  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status = 'sending')
      or (old.status = 'sending' and new.status = 'draft')
      or (old.status = 'sending' and new.status = 'sent')
    ) then
      raise exception 'material_order_status_transition_invalid' using errcode = '23514';
    end if;
    if new.status = 'sending' and (new.email_subject is null or new.email_text is null or new.recipient_email is null) then
      raise exception 'material_order_not_reviewed' using errcode = '23514';
    end if;
    -- Tillbaka till utkast = ett NYTT försök med en ny idempotensnyckel. Samma nummer hade låtit Resend
    -- svara med det gamla, avvisade utfallet.
    if old.status = 'sending' and new.status = 'draft' and new.send_attempt <> old.send_attempt + 1 then
      raise exception 'material_order_release_needs_new_attempt' using errcode = '23514';
    end if;
    if new.status = 'sent' and new.provider_message_id is null and new.verified_by is null then
      raise exception 'material_order_sent_needs_proof' using errcode = '23514';
    end if;
  elsif new.send_attempt is distinct from old.send_attempt then
    raise exception 'material_order_attempt_changes_with_status_only' using errcode = '23514';
  end if;

  if old.provider_message_id is not null and new.provider_message_id is distinct from old.provider_message_id then
    raise exception 'material_order_provider_id_is_final' using errcode = '23514';
  end if;

  v_content_changed := (new.lines, new.other_lines, new.message, new.supplier_name, new.recipient_email,
                        new.from_address, new.reply_to, new.bcc, new.email_language, new.email_subject,
                        new.email_text, new.composed_by_name)
                       is distinct from
                       (old.lines, old.other_lines, old.message, old.supplier_name, old.recipient_email,
                        old.from_address, old.reply_to, old.bcc, old.email_language, old.email_subject,
                        old.email_text, old.composed_by_name);

  -- Innehållet är fryst så fort ett utskick påbörjats: det som skickas vid ett nytt försök måste vara
  -- samma bytes, annars svarar Resend 409 på nyckeln — och mailet kan redan ha gått.
  if v_content_changed and (old.status <> 'draft' or new.status <> 'draft') then
    raise exception 'material_order_content_is_frozen' using errcode = '23514';
  end if;

  -- Optimistiskt lås: en innehållsändring räknar upp revision med exakt ett. Två admins i samma utkast
  -- kan då inte tyst skriva över varandra.
  if v_content_changed and new.revision <> old.revision + 1 then
    raise exception 'material_order_revision_must_increment' using errcode = '40001';
  end if;
  if not v_content_changed and new.revision is distinct from old.revision then
    raise exception 'material_order_revision_without_change' using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists ops_material_orders_guard on public.ops_material_orders;
create trigger ops_material_orders_guard
  before update on public.ops_material_orders
  for each row execute function public.ops_material_orders_guard();

-- En ny order är alltid ett utkast på försök 1, utan bokfört utskick.
create or replace function public.ops_material_orders_insert_guard()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'draft' or new.send_attempt <> 1 or new.revision <> 1
     or new.provider_message_id is not null or new.sent_at is not null or new.verified_by is not null
     or new.attempt_started_at is not null or new.last_try_at is not null then
    raise exception 'material_order_insert_must_be_fresh_draft' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists ops_material_orders_insert_guard on public.ops_material_orders;
create trigger ops_material_orders_insert_guard
  before insert on public.ops_material_orders
  for each row execute function public.ops_material_orders_insert_guard();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.ops_material_orders enable row level security;
grant select, insert, update, delete on public.ops_material_orders to authenticated;

drop policy if exists ops_material_orders_select on public.ops_material_orders;
create policy ops_material_orders_select on public.ops_material_orders
  for select to authenticated
  using (public.has_permission('planning.depot.manage'));

drop policy if exists ops_material_orders_insert on public.ops_material_orders;
create policy ops_material_orders_insert on public.ops_material_orders
  for insert to authenticated
  with check (created_by = auth.uid() and status = 'draft' and public.has_permission('planning.depot.manage'));

drop policy if exists ops_material_orders_update on public.ops_material_orders;
create policy ops_material_orders_update on public.ops_material_orders
  for update to authenticated
  using (public.has_permission('planning.depot.manage') and status <> 'sent')
  with check (public.has_permission('planning.depot.manage') and status <> 'sent');

-- Bara ett utkast går att slänga. Ett utskick som pågår eller har gått är historik.
drop policy if exists ops_material_orders_delete on public.ops_material_orders;
create policy ops_material_orders_delete on public.ops_material_orders
  for delete to authenticated
  using (public.has_permission('planning.depot.manage') and status = 'draft');

-- ---------------------------------------------------------------------------
-- Realtime: NEJ
-- ---------------------------------------------------------------------------
--
-- ⚠️ Tabellen får ALDRIG ligga i supabase_realtime: postgres_changes skickar hela raden vid INSERT oavsett
-- RLS, och raden bär fabrikens adress och mailets text. Blocket tar bort den om någon lagt till den för hand.
-- Lägg den heller aldrig i tavlans delade kanal — en opublicerad tabell där kan sänka livesynken för hela
-- tavlan.

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ops_material_orders'
  ) then
    alter publication supabase_realtime drop table public.ops_material_orders;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- ops_expected_deliveries: koppling till beställningen
-- ---------------------------------------------------------------------------
--
-- En väntad leverans UTAN order_id är inlagd för hand ("Boka in leverans"); MED är den beställd via
-- systemet. RESTRICT: en beställning som skapat väntade leveranser går inte att radera bort (den kan inte
-- raderas ändå — DELETE-policyn kräver draft — men regeln ska inte vila på en policy).
--
-- ⚠️ Kolumnen är bara ett naket uuid. Bädda aldrig in orderhuvudet i expected-SELECT:en: tabellen läses
-- med schedule.read, och embeddet kommer tillbaka null för sales och konsult, utan fel.

alter table public.ops_expected_deliveries
  add column if not exists order_id uuid references public.ops_material_orders(id) on delete restrict;
create index if not exists ops_expected_deliveries_order_idx
  on public.ops_expected_deliveries (order_id) where order_id is not null;

-- ERSÄTTER funktionen i 20260910_ops_expected_deliveries.sql. De två befintliga reglerna står kvar
-- oförändrade; två tillkommer.
create or replace function public.ops_expected_deliveries_forward_only()
returns trigger
language plpgsql
as $$
begin
  if old.status is distinct from new.status then
    if old.status <> 'expected' then
      raise exception 'expected_delivery_status_is_final' using errcode = '23514';
    end if;
    if new.status not in ('arrived', 'cancelled') then
      raise exception 'expected_delivery_status_invalid' using errcode = '23514';
    end if;
  end if;

  if old.delivery_id is not null and new.delivery_id is distinct from old.delivery_id then
    raise exception 'expected_delivery_link_is_final' using errcode = '23514';
  end if;

  -- NYTT: kopplingen till beställningen ändras aldrig. En rad blir inte "beställd" i efterhand, och en
  -- beställd rad kan inte kopplas loss från ordern den kom ur.
  if new.order_id is distinct from old.order_id then
    raise exception 'expected_delivery_order_is_final' using errcode = '23514';
  end if;

  -- NYTT: på en beställd rad är depå och material låsta — de är det fabriken fick i mailet. Datum, antal
  -- och notering går att ändra: det är fabrikens svar ("vi kommer onsdag i stället").
  if old.order_id is not null
     and (new.depot_id is distinct from old.depot_id or new.material is distinct from old.material) then
    raise exception 'expected_delivery_ordered_line_is_locked' using errcode = '23514';
  end if;

  return new;
end $$;

-- Policyerna skärps: en beställd rad skapas bara av finalize_material_order (SECURITY DEFINER), aldrig
-- direkt, och raderas aldrig.
drop policy if exists ops_expected_deliveries_insert on public.ops_expected_deliveries;
create policy ops_expected_deliveries_insert on public.ops_expected_deliveries
  for insert to authenticated
  with check (created_by = auth.uid() and order_id is null and public.has_permission('planning.depot.manage'));

drop policy if exists ops_expected_deliveries_delete on public.ops_expected_deliveries;
create policy ops_expected_deliveries_delete on public.ops_expected_deliveries
  for delete to authenticated
  using (order_id is null and public.has_permission('planning.depot.manage'));

-- ---------------------------------------------------------------------------
-- RPC:er
-- ---------------------------------------------------------------------------
--
-- plpgsql, SECURITY DEFINER, has_permission INUTI.
-- ⚠️ ANROPA ALDRIG MED SERVICE-ROLE-KLIENTEN. has_permission nycklar på auth.uid(), som är null under
-- service-role — grinden nekar då alltid. Sessionsklienten, alltid.

-- Intern: skapa en väntad leverans per stockrad. Anropas bara inifrån funktionerna nedan.
create or replace function public._material_order_create_expected(p_order_id uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.ops_expected_deliveries (depot_id, material, sacks, expected_on, note, created_by, order_id)
  select (l->>'depot_id')::uuid,
         l->>'material',
         (l->>'sacks')::integer,
         (l->>'requested_on')::date,
         -- ⚠️ ALDRIG orderns meddelande här: receive_expected_delivery kopierar noteringen till lagerraden.
         null,
         auth.uid(),
         p_order_id
  from jsonb_array_elements(p_lines) as l;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public._material_order_create_expected(uuid, jsonb) from public, anon, authenticated;

-- Ta ett utskick. Svaret styr routen:
--   claimed          draft -> sending, nytt försök påbörjat
--   reclaimed        redan sending, senaste försöket äldre än 2 min och fönstret öppet: skicka IGEN med
--                    samma nyckel och samma bytes (Resend skickar inte ett andra mail)
--   in_progress      ett utskick påbörjades för under 2 minuter sedan
--   already_sent     slutgiltigt skickad
--   revision_changed utkastet har ändrats sedan det granskades
--   window_expired   fönstret på 23 h har passerat — en människa avgör (resolve_material_order_send)
--   not_reviewed     utkastet har inget renderat mail att skicka
--   not_found        finns inte, eller osynlig
--
-- Det är en RPC och inte en PostgREST-skrivning: villkoret är en OR mellan tillstånd, och PostgREST godtar
-- inte `.or()` på mutationer.
create or replace function public.claim_material_order_send(p_order_id uuid, p_revision integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ops_material_orders%rowtype;
begin
  if not public.has_permission('planning.depot.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_row from public.ops_material_orders where id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_row.status = 'sent' then
    return 'already_sent';
  end if;
  if v_row.revision <> p_revision then
    return 'revision_changed';
  end if;

  if v_row.status = 'draft' and (v_row.email_subject is null or v_row.email_text is null or v_row.recipient_email is null) then
    return 'not_reviewed';
  end if;

  perform set_config('ekovilla.material_order_rpc', 'on', true);

  if v_row.status = 'draft' then
    update public.ops_material_orders
       set status = 'sending', attempt_started_at = now(), last_try_at = now(),
           send_error = null, send_error_code = null
     where id = p_order_id;
    perform set_config('ekovilla.material_order_rpc', 'off', true);
    return 'claimed';
  end if;

  -- sending
  if v_row.attempt_started_at is null or v_row.attempt_started_at < now() - interval '23 hours' then
    perform set_config('ekovilla.material_order_rpc', 'off', true);
    return 'window_expired';
  end if;
  if v_row.last_try_at is not null and v_row.last_try_at > now() - interval '2 minutes' then
    perform set_config('ekovilla.material_order_rpc', 'off', true);
    return 'in_progress';
  end if;
  update public.ops_material_orders set last_try_at = now() where id = p_order_id;
  perform set_config('ekovilla.material_order_rpc', 'off', true);
  return 'reclaimed';
end $$;

revoke all on function public.claim_material_order_send(uuid, integer) from public, anon;
grant execute on function public.claim_material_order_send(uuid, integer) to authenticated;

-- Resend tog emot mailet: skapa de väntade leveranserna och markera ordern skickad, i EN transaktion.
-- Returnerar antalet skapade rader, 0 om ordern redan var skickad (ett andra anrop skapar inga dubbletter).
create or replace function public.finalize_material_order(p_order_id uuid, p_provider_message_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.ops_material_orders%rowtype;
  v_name  text;
  v_count integer;
begin
  if not public.has_permission('planning.depot.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_provider_message_id is null or btrim(p_provider_message_id) = '' then
    raise exception 'material_order_provider_id_required' using errcode = '22023';
  end if;

  select * into v_row from public.ops_material_orders where id = p_order_id for update;
  if not found then
    raise exception 'material_order_not_found' using errcode = 'P0002';
  end if;
  if v_row.status = 'sent' then
    return 0;
  end if;
  if v_row.status <> 'sending' then
    raise exception 'material_order_not_sending' using errcode = '23514';
  end if;

  v_count := public._material_order_create_expected(p_order_id, v_row.lines);
  select full_name into v_name from public.profiles where id = auth.uid();

  perform set_config('ekovilla.material_order_rpc', 'on', true);
  update public.ops_material_orders
     set status = 'sent', provider_message_id = p_provider_message_id,
         sent_at = now(), sent_by = auth.uid(), sent_by_name = v_name,
         send_error = null, send_error_code = null
   where id = p_order_id;
  perform set_config('ekovilla.material_order_rpc', 'off', true);

  return v_count;
end $$;

revoke all on function public.finalize_material_order(uuid, text) from public, anon;
grant execute on function public.finalize_material_order(uuid, text) to authenticated;

-- Resend avvisade mailet DEFINITIVT (inget gick iväg): tillbaka till utkast, med ett nytt försöksnummer och
-- därmed en ny idempotensnyckel. Bara för det försök som faktiskt avvisades — ett äldre svar som kommer
-- fram sent får inte släppa ett nyare försök.
create or replace function public.release_material_order_send(
  p_order_id   uuid,
  p_attempt    integer,
  p_error_code text,
  p_error      text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ops_material_orders%rowtype;
begin
  if not public.has_permission('planning.depot.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_row from public.ops_material_orders where id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_row.status <> 'sending' or v_row.send_attempt <> p_attempt then
    return 'stale';
  end if;

  perform set_config('ekovilla.material_order_rpc', 'on', true);
  update public.ops_material_orders
     set status = 'draft', send_attempt = send_attempt + 1,
         attempt_started_at = null, last_try_at = null,
         send_error = left(p_error, 1000), send_error_code = left(p_error_code, 100)
   where id = p_order_id;
  perform set_config('ekovilla.material_order_rpc', 'off', true);
  return 'released';
end $$;

revoke all on function public.release_material_order_send(uuid, integer, text, text) from public, anon;
grant execute on function public.release_material_order_send(uuid, integer, text, text) to authenticated;

-- En människa avgör ett oklart utskick, efter att ha tittat i BCC-kopian i order@:
--   p_delivered = true   mailet gick fram: skapa de väntade leveranserna och markera skickad (verified_by)
--   p_delivered = false  mailet gick inte fram: tillbaka till utkast med nytt försök
-- Nekas medan ett utskick pågår (senaste försöket yngre än 2 minuter).
create or replace function public.resolve_material_order_send(p_order_id uuid, p_delivered boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.ops_material_orders%rowtype;
  v_name text;
begin
  if not public.has_permission('planning.depot.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_delivered is null then
    raise exception 'material_order_resolution_required' using errcode = '22023';
  end if;

  select * into v_row from public.ops_material_orders where id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;
  if v_row.status = 'sent' then
    return 'already_sent';
  end if;
  if v_row.status <> 'sending' then
    return 'not_sending';
  end if;
  if v_row.last_try_at is not null and v_row.last_try_at > now() - interval '2 minutes' then
    return 'in_progress';
  end if;

  select full_name into v_name from public.profiles where id = auth.uid();
  perform set_config('ekovilla.material_order_rpc', 'on', true);

  if p_delivered then
    perform public._material_order_create_expected(p_order_id, v_row.lines);
    update public.ops_material_orders
       set status = 'sent', verified_by = auth.uid(), verified_by_name = v_name,
           sent_at = now(), sent_by = auth.uid(), sent_by_name = v_name
     where id = p_order_id;
    perform set_config('ekovilla.material_order_rpc', 'off', true);
    return 'marked_sent';
  end if;

  update public.ops_material_orders
     set status = 'draft', send_attempt = send_attempt + 1,
         attempt_started_at = null, last_try_at = null
   where id = p_order_id;
  perform set_config('ekovilla.material_order_rpc', 'off', true);
  return 'released';
end $$;

revoke all on function public.resolve_material_order_send(uuid, boolean) from public, anon;
grant execute on function public.resolve_material_order_send(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Verifiering (kör efter applicering, som inloggad admin i SQL-editorn gäller INTE auth.uid() —
-- RPC-grindarna prövas därför från appen i etapp 4d. Här prövas tabellens och triggerns regler.)
-- ---------------------------------------------------------------------------
--
-- 1. Tabell, RLS, fyra policyer, inte i realtime:
--
--    select relrowsecurity from pg_class where oid = 'public.ops_material_orders'::regclass;
--    select policyname, cmd from pg_policies where tablename = 'ops_material_orders' order by policyname;
--    select count(*) from pg_publication_tables where tablename = 'ops_material_orders';   -- 0
--
-- 2. Kolumnen på väntade leveranser, och att befintliga rader är orörda:
--
--    select count(*) filter (where order_id is null) as manuella, count(*) as alla
--    from public.ops_expected_deliveries;   -- manuella = alla
--
-- 3. Triggerns regler. Kör blocket i SQL-editorn; det rullar tillbaka allt och ska skriva ut
--    "alla regler höll":
--
--    do $$
--    declare v_supplier uuid; v_order uuid; v_ok boolean;
--    begin
--      select id into v_supplier from public.ops_material_suppliers limit 1;
--      insert into public.ops_material_orders (supplier_id, email_subject, email_text, recipient_email)
--        values (v_supplier, 'S', 'T', 'x@example.com') returning id into v_order;
--
--      -- a) status går inte att ändra direkt
--      begin
--        update public.ops_material_orders set status = 'sending' where id = v_order;
--        raise exception 'REGEL BRÖTS: status ändrades utan RPC';
--      exception when others then
--        if sqlerrm like 'REGEL BRÖTS%' then raise; end if;
--      end;
--      -- b) innehållsändring utan revision+1 nekas
--      begin
--        update public.ops_material_orders set message = 'x' where id = v_order;
--        raise exception 'REGEL BRÖTS: innehåll ändrades utan revision';
--      exception when others then
--        if sqlerrm like 'REGEL BRÖTS%' then raise; end if;
--      end;
--      -- c) med revision+1 går den igenom
--      update public.ops_material_orders set message = 'x', revision = 2 where id = v_order;
--      -- d) leverantören byts inte
--      begin
--        update public.ops_material_orders set supplier_id = gen_random_uuid() where id = v_order;
--        raise exception 'REGEL BRÖTS: leverantören byttes';
--      exception when others then
--        if sqlerrm like 'REGEL BRÖTS%' then raise; end if;
--      end;
--      raise notice 'alla regler höll';
--      raise exception 'rollback (avsiktligt)';
--    exception when others then
--      if sqlerrm like 'REGEL BRÖTS%' then raise; end if;
--      if sqlerrm <> 'rollback (avsiktligt)' then raise; end if;
--    end $$;
--
-- 4. En beställd väntad leverans: depå och material låsta, datum fritt. Görs från appen i etapp 4d, när
--    finalize finns att anropa med en riktig session.
