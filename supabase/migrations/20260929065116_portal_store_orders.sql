-- Butiksbeställningarna från återförsäljarportalen: butiken köper material ur prislistan (kontraktets "Flöde 3").
--
-- BAKGRUND
-- RESELLER_PORTAL_CRM_PLAN.md, fas 8, väg B: en egen tabell och en egen POST /orders till Fortnox, skild från
-- arbetsordrarna. Butiken skickar, ändrar och drar tillbaka en beställning tills Ekovilla bekräftat den; sedan är den
-- låst hos butiken. Besluten (William 2026-09-29):
--   - Momsen som i CRM:et i dag, per dokument: en beställning har 25 % (butiken är slutkund), också frakten.
--   - Ekovilla lägger till frakten (artikel 1050 FRAKT, pris från säljaren) eller väljer "Ingen frakt" innan
--     beställningen bekräftas, och ändrar aldrig butikens rader. Raderna kan alltså aldrig få andra priser än butikens
--     unitCost: det finns ingen väg som ändrar dem, bara portalens egen ändring.
--   - Fortnox-ordern skapas när någon trycker Bekräfta. ekovillaOrderNumber är Fortnox-numret.
--   - Levererad med en knapp (datum), fakturerad med knappen Fakturera (Fortnox createinvoice), makulerad med ett skäl
--     som butiken ser, bara före Levererad.
--   - Se: alla med crm.access. Bekräfta, frakt, leverans, faktura och makulering: den ansvarige och admin.
--
-- KOLUMNERNA
--   order_id            portalens orderId (unik), samma tecken som i sökvägar (planens punkt 16).
--   intake_payload      kroppen i den första POST:en. Ändras aldrig: samma orderId igen med en annan första kropp nekas
--                       (409), en upprepning får den befintliga.
--   payload             den senast mottagna versionen (POST eller PUT), alltså Ekovillas version: det är den som
--                       bekräftas och blir Fortnox-ordern. store_version räknas upp för varje mottagen ändring, och
--                       Bekräfta nekas om en ändring kom efter att säljaren läste beställningen.
--   portal_updated_at   det senast mottagna updatedAt. En ändring med ett äldre eller samma updatedAt ignoreras.
--   assigned_to         den som fick beställningen: butikens säljare, kundansvarig, reserven (inget län: leveransen går
--                       till butiken). assigned_to_name är namnet då: profiles är bara självläsbar.
--   notified_key        vilken notis den ansvarige senast fick ("v<version>" eller "withdrawn"); notify_claimed_at är
--                       lånet medan en skickas (samma mönster som meddelandena, fas 6).
--   freight_*           Ekovillas frakt: null = inte beslutat, 'none' = ingen frakt, 'charged' = en fraktrad med priset.
--   confirmed_*         bekräftelsen: vem, när och vilken version.
--   fortnox_*           Fortnox-ordern och fakturan, med claimen (samma mönster som arbetsordern) och omförsöken.
--   delivered_on, invoiced_on   svenska kalenderdagar, det butiken får som deliveredAt och invoicedAt.
--   sync_requested_at, sync_state   status tillbaka till portalen: triggern markerar, TypeScript räknar ut och köar.
--   *_by, *_by_name     den som tryckte, och namnet då. Ingen FK mot profiles, som dokumenten.
--
-- VAKTEN (triggern crm_store_orders_guard)
-- Statusen går bara framåt: received → withdrawn | confirmed | cancelled, confirmed → delivered | cancelled,
-- delivered → invoiced. Butikens innehåll och frakten ändras bara medan beställningen är mottagen och obekräftad, så
-- att en ändring aldrig kan landa efter bekräftelsen, hur koden än ser ut. Fortnox-numren skrivs en gång. Ändras
-- statusen, Fortnox-ordern eller ett datum markeras raden för utskicket.
--
-- ÅTKOMST
-- Tabellen skrivs bara av servern (service-rollen): portalens anrop har ingen användare bakom sig, och Ekovillas
-- knappar gör Fortnox-anrop och köar händelser, som bara service-rollen får. Routerna frågar först, med sessionen,
-- crm_store_order_can_manage() (invoker), samma regel som sidan använder för att visa knapparna. Se "Reviewed
-- elevations" i SUPABASE_CONVENTIONS.md. Sessionen läser visningskolumnerna med crm.access; första kroppen,
-- notisens lån, claimarna och utskickets bokföring är bara service-rollens. Default privileges är stängda sedan
-- 20260926134651; varje grant står här. Kolumngranten står EFTER revoke all, annars tar revoken bort den.
--
-- Additiv: en ny tabell, en ny trigger på den och en ny funktion, inget befintligt ändras. Kan gå till prod före koden.
-- Idempotent, kan köras om.
-- Låsen: de främmande nycklarna tar crm_portal_resellers, crm_customers och profiles i share row exclusive en kort stund
-- medan den nya, tomma tabellen skapas. Läsningar väntar inte, men en samtidig skrivning i kundregistret eller en profil
-- gör det. lock_timeout: får migreringen inte låset inom 5 s ger den upp och rullar tillbaka, i stället för att köa
-- skrivningarna bakom sig. Kör om den då.

set lock_timeout = '5s';

create table if not exists public.crm_store_orders (
  id uuid primary key default gen_random_uuid(),
  order_id text not null,
  order_number text not null,
  reseller_id text not null,
  store_name text not null,
  customer_id uuid,
  assigned_to uuid,
  assigned_to_name text,
  assignment_source text not null,
  status text not null default 'received',
  intake_payload jsonb not null,
  payload jsonb not null,
  store_version integer not null default 1,
  portal_updated_at timestamptz,
  received_at timestamptz not null default now(),
  changed_at timestamptz,
  withdrawn_at timestamptz,
  notified_key text,
  notify_claimed_at timestamptz,
  freight_mode text,
  freight_price numeric(12, 2),
  freight_set_by uuid,
  freight_set_by_name text,
  freight_set_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid,
  confirmed_by_name text,
  confirmed_version integer,
  fortnox_order_number text,
  fortnox_order_sync_status text not null default 'not_synced',
  fortnox_order_claimed_at timestamptz,
  fortnox_error text,
  fortnox_attempts integer not null default 0,
  fortnox_next_attempt_at timestamptz,
  fortnox_retry_until timestamptz,
  delivered_on date,
  delivered_at timestamptz,
  delivered_by uuid,
  delivered_by_name text,
  fortnox_invoice_number text,
  fortnox_invoice_sync_status text not null default 'not_synced',
  fortnox_invoice_claimed_at timestamptz,
  invoiced_on date,
  invoiced_at timestamptz,
  invoiced_by uuid,
  invoiced_by_name text,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancelled_by_name text,
  cancel_reason text,
  sync_requested_at timestamptz,
  sync_state jsonb not null default '{}'::jsonb
);

alter table public.crm_store_orders drop constraint if exists crm_store_orders_order_id_key;
alter table public.crm_store_orders add constraint crm_store_orders_order_id_key unique (order_id);

alter table public.crm_store_orders drop constraint if exists crm_store_orders_order_id_check;
alter table public.crm_store_orders
  add constraint crm_store_orders_order_id_check check (order_id ~ '^(?!\.+$)[A-Za-z0-9._~-]{1,100}$');

alter table public.crm_store_orders drop constraint if exists crm_store_orders_order_number_check;
alter table public.crm_store_orders
  add constraint crm_store_orders_order_number_check check (char_length(btrim(order_number)) between 1 and 50);

alter table public.crm_store_orders drop constraint if exists crm_store_orders_store_name_check;
alter table public.crm_store_orders
  add constraint crm_store_orders_store_name_check check (char_length(btrim(store_name)) between 1 and 200);

-- Som jobbens fördelning, utan länet: leveransen går till butiken.
alter table public.crm_store_orders drop constraint if exists crm_store_orders_assignment_source_check;
alter table public.crm_store_orders
  add constraint crm_store_orders_assignment_source_check
  check (assignment_source in ('reseller_seller', 'account_manager', 'fallback'));

alter table public.crm_store_orders drop constraint if exists crm_store_orders_status_check;
alter table public.crm_store_orders
  add constraint crm_store_orders_status_check
  check (status in ('received', 'withdrawn', 'confirmed', 'delivered', 'invoiced', 'cancelled'));

alter table public.crm_store_orders drop constraint if exists crm_store_orders_payload_check;
alter table public.crm_store_orders
  add constraint crm_store_orders_payload_check
  check (jsonb_typeof(payload) = 'object' and jsonb_typeof(intake_payload) = 'object' and jsonb_typeof(sync_state) = 'object');

alter table public.crm_store_orders drop constraint if exists crm_store_orders_store_version_check;
alter table public.crm_store_orders
  add constraint crm_store_orders_store_version_check check (store_version >= 1);

-- Tillbakadragen av butiken: tiden finns precis när statusen säger det.
alter table public.crm_store_orders drop constraint if exists crm_store_orders_withdrawn_check;
alter table public.crm_store_orders
  add constraint crm_store_orders_withdrawn_check check ((status = 'withdrawn') = (withdrawn_at is not null));

alter table public.crm_store_orders drop constraint if exists crm_store_orders_freight_check;
alter table public.crm_store_orders
  add constraint crm_store_orders_freight_check
  check (
    (freight_mode is null and freight_price is null)
    or (freight_mode = 'none' and freight_price is null)
    or (freight_mode = 'charged' and freight_price > 0 and freight_price <= 1000000)
  );

-- Bekräftad (och det som följer): någon bekräftade en viss version, och frakten var beslutad.
alter table public.crm_store_orders drop constraint if exists crm_store_orders_confirmed_check;
alter table public.crm_store_orders
  add constraint crm_store_orders_confirmed_check
  check (
    status not in ('confirmed', 'delivered', 'invoiced')
    or (confirmed_at is not null and confirmed_version is not null and freight_mode is not null)
  );

-- Levererad först när Fortnox-ordern finns: butiken ska ha fått sitt ordernummer.
alter table public.crm_store_orders drop constraint if exists crm_store_orders_delivered_check;
alter table public.crm_store_orders
  add constraint crm_store_orders_delivered_check
  check (status not in ('delivered', 'invoiced') or (delivered_on is not null and fortnox_order_number is not null));

alter table public.crm_store_orders drop constraint if exists crm_store_orders_invoiced_check;
alter table public.crm_store_orders
  add constraint crm_store_orders_invoiced_check
  check (status <> 'invoiced' or (invoiced_on is not null and fortnox_invoice_number is not null));

-- Makulerad av Ekovilla: tiden och ett skäl som butiken ser (portalen tar högst 2000 tecken).
alter table public.crm_store_orders drop constraint if exists crm_store_orders_cancelled_check;
alter table public.crm_store_orders
  add constraint crm_store_orders_cancelled_check
  check (
    (status = 'cancelled') = (cancelled_at is not null)
    and (status <> 'cancelled' or char_length(btrim(coalesce(cancel_reason, ''))) between 1 and 2000)
  );

alter table public.crm_store_orders drop constraint if exists crm_store_orders_sync_status_check;
alter table public.crm_store_orders
  add constraint crm_store_orders_sync_status_check
  check (
    fortnox_order_sync_status in ('not_synced', 'pending', 'synced', 'failed')
    and fortnox_invoice_sync_status in ('not_synced', 'pending', 'synced', 'failed')
  );

-- Butikerna tas aldrig bort (ingen delete för sessionen); en beställning håller kvar sin butik.
alter table public.crm_store_orders drop constraint if exists crm_store_orders_reseller_id_fkey;
alter table public.crm_store_orders
  add constraint crm_store_orders_reseller_id_fkey
  foreign key (reseller_id) references public.crm_portal_resellers(reseller_id);

alter table public.crm_store_orders drop constraint if exists crm_store_orders_customer_id_fkey;
alter table public.crm_store_orders
  add constraint crm_store_orders_customer_id_fkey
  foreign key (customer_id) references public.crm_customers(id) on delete set null;

alter table public.crm_store_orders drop constraint if exists crm_store_orders_assigned_to_fkey;
alter table public.crm_store_orders
  add constraint crm_store_orders_assigned_to_fkey
  foreign key (assigned_to) references public.profiles(id) on delete set null;

create index if not exists crm_store_orders_reseller_id_idx on public.crm_store_orders (reseller_id);
create index if not exists crm_store_orders_customer_id_idx on public.crm_store_orders (customer_id);
create index if not exists crm_store_orders_assigned_to_idx on public.crm_store_orders (assigned_to);
create index if not exists crm_store_orders_status_received_idx on public.crm_store_orders (status, received_at desc);
create index if not exists crm_store_orders_sync_requested_idx
  on public.crm_store_orders (sync_requested_at) where sync_requested_at is not null;
create index if not exists crm_store_orders_fortnox_next_attempt_idx
  on public.crm_store_orders (fortnox_next_attempt_at) where fortnox_next_attempt_at is not null;

-- ---------------------------------------------------------------------------------------------------------- vakten

create or replace function public.crm_store_orders_guard()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'received' or new.store_version <> 1 then
      raise exception 'butiksbeställningar: en ny beställning är mottagen, version 1 (status %, version %)',
        new.status, new.store_version;
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.order_id is distinct from old.order_id
     or new.order_number is distinct from old.order_number
     or new.reseller_id is distinct from old.reseller_id
     or new.intake_payload is distinct from old.intake_payload
     or new.received_at is distinct from old.received_at then
    raise exception 'butiksbeställningar: beställningens identitet och första kropp ändras aldrig';
  end if;

  if not (
    new.status = old.status
    or (old.status = 'received' and new.status in ('withdrawn', 'confirmed', 'cancelled'))
    or (old.status = 'confirmed' and new.status in ('delivered', 'cancelled'))
    or (old.status = 'delivered' and new.status = 'invoiced')
  ) then
    raise exception 'butiksbeställningar: statusen kan inte gå från % till %', old.status, new.status;
  end if;

  -- Butikens innehåll och Ekovillas frakt: bara medan beställningen är mottagen och förblir det. En bekräftelse ändrar
  -- dem aldrig, så en ändring kan inte glida in i samma UPDATE som låser beställningen.
  if (new.payload is distinct from old.payload
      or new.store_version is distinct from old.store_version
      or new.portal_updated_at is distinct from old.portal_updated_at
      or new.freight_mode is distinct from old.freight_mode
      or new.freight_price is distinct from old.freight_price)
     and not (old.status = 'received' and new.status = 'received') then
    raise exception 'butiksbeställningar: innehållet och frakten ändras bara på en mottagen beställning (status %)', old.status;
  end if;

  if new.store_version < old.store_version then
    raise exception 'butiksbeställningar: versionen går bara framåt';
  end if;

  -- Kunden byts bara före bekräftelsen; tas kundkortet bort (on delete set null) står beställningen kvar utan.
  if new.customer_id is distinct from old.customer_id and new.customer_id is not null and old.status <> 'received' then
    raise exception 'butiksbeställningar: kunden byts bara på en mottagen beställning';
  end if;

  if (old.fortnox_order_number is not null and new.fortnox_order_number is distinct from old.fortnox_order_number)
     or (old.fortnox_invoice_number is not null and new.fortnox_invoice_number is distinct from old.fortnox_invoice_number) then
    raise exception 'butiksbeställningar: ett Fortnox-nummer skrivs en gång';
  end if;

  if new.status is distinct from old.status
     or new.fortnox_order_number is distinct from old.fortnox_order_number
     or new.delivered_on is distinct from old.delivered_on
     or new.invoiced_on is distinct from old.invoiced_on
     or new.cancelled_at is distinct from old.cancelled_at then
    new.sync_requested_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.crm_store_orders_guard() from public, anon, authenticated, service_role;

drop trigger if exists crm_store_orders_guard on public.crm_store_orders;
create trigger crm_store_orders_guard
  before insert or update on public.crm_store_orders
  for each row execute function public.crm_store_orders_guard();

-- ------------------------------------------------------------------------------------------- vem som får hantera

-- Den ansvarige, eller en admin, och båda med crm.workorder.write: samma personer som får redigera en arbetsorder och
-- svara butiken (crm_portal_job_message_can_reply, fas 6). Invoker: frågan ställs med sessionen, som läser raden
-- genom tabellens policy. Routerna frågar den innan de gör något, och sidan frågar den om knapparna ska visas.
create or replace function public.crm_store_order_can_manage(p_id uuid)
  returns boolean
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select (select public.has_permission('crm.workorder.write'))
     and exists (
       select 1
         from public.crm_store_orders o
        where o.id = p_id
          and (o.assigned_to = (select auth.uid()) or (select public.has_permission('crm.admin')))
     );
$$;

revoke all on function public.crm_store_order_can_manage(uuid) from public, anon, authenticated, service_role;
grant execute on function public.crm_store_order_can_manage(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------- åtkomst

alter table public.crm_store_orders enable row level security;
revoke all on table public.crm_store_orders from anon, authenticated;
grant select (id, order_id, order_number, reseller_id, store_name, customer_id, assigned_to, assigned_to_name,
              assignment_source, status, payload, store_version, portal_updated_at, received_at, changed_at,
              withdrawn_at, freight_mode, freight_price, freight_set_by_name, freight_set_at, confirmed_at,
              confirmed_by_name, fortnox_order_number, fortnox_order_sync_status, fortnox_error, delivered_on,
              delivered_by_name, fortnox_invoice_number, invoiced_on, invoiced_by_name, cancelled_at,
              cancelled_by_name, cancel_reason)
  on table public.crm_store_orders to authenticated;
grant select, insert, update, delete on table public.crm_store_orders to service_role;

drop policy if exists crm_store_orders_select on public.crm_store_orders;
create policy crm_store_orders_select on public.crm_store_orders
  for select to authenticated
  using ((select has_permission('crm.access')));

reset lock_timeout;

-- ---------------------------------------------------------------------------------------------------- efterkontroll

-- Pröva effekten: RLS på med läspolicyn; anon ingenting; sessionen läser BARA visningskolumnerna och skriver
-- ingenting; service_role allt; regeln körbar bara för sessionen; vakten sitter på tabellen och är ingens att köra.
-- (has_table_privilege med en kommalista svarar på om NÅGON av rättigheterna finns.)
do $$
declare
  col text;
  priv text;
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.crm_store_orders'::regclass) then
    raise exception 'butiksbeställningar: RLS är inte på';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'crm_store_orders' and policyname = 'crm_store_orders_select'
       and cmd = 'SELECT' and roles = '{authenticated}' and qual like '%has_permission(''crm.access''%'
  ) then
    raise exception 'butiksbeställningar: läspolicyn saknas eller frågar inte efter crm.access';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'crm_store_orders' and policyname <> 'crm_store_orders_select'
  ) then
    raise exception 'butiksbeställningar: tabellen har en policy till';
  end if;
  if has_table_privilege('anon', 'public.crm_store_orders', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'butiksbeställningar: anon har rättigheter på tabellen';
  end if;
  if has_any_column_privilege('anon', 'public.crm_store_orders', 'SELECT,INSERT,UPDATE,REFERENCES') then
    raise exception 'butiksbeställningar: anon har rättigheter på en kolumn';
  end if;
  if has_table_privilege('authenticated', 'public.crm_store_orders', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'butiksbeställningar: authenticated har rättigheter på tabellnivå';
  end if;
  if has_any_column_privilege('authenticated', 'public.crm_store_orders', 'INSERT,UPDATE,REFERENCES') then
    raise exception 'butiksbeställningar: authenticated kan skriva en kolumn';
  end if;
  foreach col in array array['id', 'order_id', 'order_number', 'reseller_id', 'store_name', 'customer_id',
                             'assigned_to', 'assigned_to_name', 'assignment_source', 'status', 'payload',
                             'store_version', 'portal_updated_at', 'received_at', 'changed_at', 'withdrawn_at',
                             'freight_mode', 'freight_price', 'freight_set_by_name', 'freight_set_at', 'confirmed_at',
                             'confirmed_by_name', 'fortnox_order_number', 'fortnox_order_sync_status', 'fortnox_error',
                             'delivered_on', 'delivered_by_name', 'fortnox_invoice_number', 'invoiced_on',
                             'invoiced_by_name', 'cancelled_at', 'cancelled_by_name', 'cancel_reason'] loop
    if not has_column_privilege('authenticated', 'public.crm_store_orders', col, 'SELECT') then
      raise exception 'butiksbeställningar: authenticated kan inte läsa crm_store_orders.%', col;
    end if;
  end loop;
  foreach col in array array['intake_payload', 'notified_key', 'notify_claimed_at', 'freight_set_by', 'confirmed_by',
                             'confirmed_version', 'fortnox_order_claimed_at', 'fortnox_attempts',
                             'fortnox_next_attempt_at', 'fortnox_retry_until', 'delivered_at', 'delivered_by',
                             'fortnox_invoice_sync_status', 'fortnox_invoice_claimed_at', 'invoiced_at', 'invoiced_by',
                             'cancelled_by', 'sync_requested_at', 'sync_state'] loop
    if has_column_privilege('authenticated', 'public.crm_store_orders', col, 'SELECT') then
      raise exception 'butiksbeställningar: authenticated kan läsa crm_store_orders.%', col;
    end if;
  end loop;
  foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', 'public.crm_store_orders', priv) then
      raise exception 'butiksbeställningar: service_role saknar % på tabellen', priv;
    end if;
  end loop;

  if not has_function_privilege('authenticated', 'public.crm_store_order_can_manage(uuid)', 'EXECUTE') then
    raise exception 'butiksbeställningar: authenticated kan inte köra crm_store_order_can_manage';
  end if;
  if has_function_privilege('anon', 'public.crm_store_order_can_manage(uuid)', 'EXECUTE') then
    raise exception 'butiksbeställningar: anon kan köra crm_store_order_can_manage';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = 'public.crm_store_order_can_manage(uuid)'::regprocedure) then
    raise exception 'butiksbeställningar: crm_store_order_can_manage är security definer';
  end if;

  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.crm_store_orders'::regclass and t.tgname = 'crm_store_orders_guard'
       and t.tgfoid = 'public.crm_store_orders_guard()'::regprocedure and t.tgenabled = 'O' and not t.tgisinternal
       -- before (2), for each row (1), insert (4) och update (16), på alla kolumner.
       and (t.tgtype::int & 23) = 23 and cardinality(t.tgattr::int2[]) = 0
  ) then
    raise exception 'butiksbeställningar: vakten sitter inte på tabellen';
  end if;
  if (select p.prosecdef from pg_proc p where p.oid = 'public.crm_store_orders_guard()'::regprocedure) then
    raise exception 'butiksbeställningar: vakten är security definer';
  end if;
  foreach priv in array array['anon', 'authenticated'] loop
    if has_function_privilege(priv, 'public.crm_store_orders_guard()', 'EXECUTE') then
      raise exception 'butiksbeställningar: % kan köra vakten', priv;
    end if;
  end loop;
end $$;
