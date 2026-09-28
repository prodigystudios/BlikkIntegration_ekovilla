-- Butikerna i återförsäljarportalen och reserven för fördelningen av deras jobb.
--
-- BAKGRUND
-- RESELLER_PORTAL_CRM_PLAN.md, fas 3a. Ett jobb från portalen (fas 3b) ska hamna hos en säljare på Ekovilla. Den första
-- som finns, och som kan skriva arbetsordrar (crm.workorder.write), får det:
--   1. butikens säljare              crm_portal_resellers.seller_user_id, satt på portalsidan
--   2. kundansvarig                  crm_customers.account_manager_id på butikens kundkort
--   3. säljaren för länet            crm_routing_rules, länet ur arbetsplatsens postnummer och ort
--   4. reserven                      crm_portal_settings.fallback_user_id, satt på portalsidan
-- Finns ingen tas jobbet inte emot än: portalen får 503 och försöker igen (William 2026-09-28).
--
--   crm_portal_resellers   en rad per butik, med portalens resellerId som nyckel. Raden skapas och uppdateras av
--                          service-rollen när butiken hör av sig (fas 3b): namn, adress och kundnumret portalen
--                          skickar. Sessionen får bara sätta säljaren (kolumngrant), aldrig lägga till eller ta bort
--                          en butik (William 2026-09-28: butiken dyker upp när den hör av sig första gången).
--                          customer_id är kopplingen till kundkortet; fas 3b sätter den ur kundnumret, fas 3c för
--                          hand. Butiker kan dela kundnummer, därför är den inte unik.
--   crm_portal_settings    en enda rad (som crm_calc_settings). Reserven kan vara säljare eller admin (William
--                          2026-09-28); att den kan skriva arbetsordrar prövas av routen när den sätts och av
--                          fördelningen varje gång.
--
-- ÅTKOMST
-- crm.portal.manage (admin) läser och sätter säljaren och reserven. Default privileges är stängda sedan
-- 20260926134651; varje grant står här, service_role uttryckligen (se 20260928053434). Kolumngranterna står EFTER
-- tabellens revoke all, annars tar revoken bort dem (tests/supabase/migrationGrants.test.ts). updated_at sätts av en
-- trigger och behöver ingen grant.
--
-- Additiv: nya objekt, inget befintligt ändras. Kan gå till prod före koden. Idempotent, kan köras om.

-- ------------------------------------------------------------------------------------------------------- butikerna

create table if not exists public.crm_portal_resellers (
  -- Portalens resellerId, t.ex. `res-norrbygg`.
  reseller_id text primary key,
  name text not null,
  street text not null default '',
  postal_code text not null default '',
  city text not null default '',
  -- Kundnumret i Fortnox som portalen senast skickade (store.ekovillaCustomerNumber). null = inte kopplad i portalen.
  customer_number text,
  customer_id uuid,
  seller_user_id uuid,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Samma tecken som portalens id:n i sökvägar (planens punkt 16). Ett id av bara punkter (`.`, `..`) skrivs om av
-- webbläsaren i en adress och nekas därför.
alter table public.crm_portal_resellers drop constraint if exists crm_portal_resellers_reseller_id_check;
alter table public.crm_portal_resellers
  add constraint crm_portal_resellers_reseller_id_check check (reseller_id ~ '^(?!\.+$)[A-Za-z0-9._~-]{1,100}$');

alter table public.crm_portal_resellers drop constraint if exists crm_portal_resellers_name_check;
alter table public.crm_portal_resellers
  add constraint crm_portal_resellers_name_check check (char_length(btrim(name)) between 1 and 200);

alter table public.crm_portal_resellers drop constraint if exists crm_portal_resellers_address_check;
alter table public.crm_portal_resellers
  add constraint crm_portal_resellers_address_check check (
    char_length(street) <= 200 and char_length(postal_code) <= 20 and char_length(city) <= 100
  );

alter table public.crm_portal_resellers drop constraint if exists crm_portal_resellers_customer_number_check;
alter table public.crm_portal_resellers
  add constraint crm_portal_resellers_customer_number_check check (
    customer_number is null or char_length(customer_number) between 1 and 50
  );

alter table public.crm_portal_resellers drop constraint if exists crm_portal_resellers_customer_id_fkey;
alter table public.crm_portal_resellers
  add constraint crm_portal_resellers_customer_id_fkey
  foreign key (customer_id) references public.crm_customers(id) on delete set null;

alter table public.crm_portal_resellers drop constraint if exists crm_portal_resellers_seller_user_id_fkey;
alter table public.crm_portal_resellers
  add constraint crm_portal_resellers_seller_user_id_fkey
  foreign key (seller_user_id) references public.profiles(id) on delete set null;

alter table public.crm_portal_resellers drop constraint if exists crm_portal_resellers_updated_by_fkey;
alter table public.crm_portal_resellers
  add constraint crm_portal_resellers_updated_by_fkey
  foreign key (updated_by) references public.profiles(id) on delete set null;

create index if not exists crm_portal_resellers_customer_id_idx on public.crm_portal_resellers (customer_id);

drop trigger if exists crm_portal_resellers_set_updated_at on public.crm_portal_resellers;
create trigger crm_portal_resellers_set_updated_at
  before update on public.crm_portal_resellers
  for each row execute function public.set_updated_at();

alter table public.crm_portal_resellers enable row level security;
revoke all on table public.crm_portal_resellers from anon, authenticated;
grant select on table public.crm_portal_resellers to authenticated;
grant update (seller_user_id, updated_by) on table public.crm_portal_resellers to authenticated;
grant select, insert, update, delete on table public.crm_portal_resellers to service_role;

drop policy if exists crm_portal_resellers_select on public.crm_portal_resellers;
create policy crm_portal_resellers_select on public.crm_portal_resellers
  for select to authenticated
  using ((select has_permission('crm.portal.manage')));

drop policy if exists crm_portal_resellers_update on public.crm_portal_resellers;
create policy crm_portal_resellers_update on public.crm_portal_resellers
  for update to authenticated
  using ((select has_permission('crm.portal.manage')))
  with check ((select has_permission('crm.portal.manage')) and updated_by = (select auth.uid()));

-- ------------------------------------------------------------------------------------------------ inställningarna

create table if not exists public.crm_portal_settings (
  id boolean primary key default true,
  -- Reserven: får ett jobb när ingen annan i kedjan finns. null = ingen vald, och då tas ett sådant jobb inte emot.
  fallback_user_id uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.crm_portal_settings drop constraint if exists crm_portal_settings_id_check;
alter table public.crm_portal_settings add constraint crm_portal_settings_id_check check (id);

alter table public.crm_portal_settings drop constraint if exists crm_portal_settings_fallback_user_id_fkey;
alter table public.crm_portal_settings
  add constraint crm_portal_settings_fallback_user_id_fkey
  foreign key (fallback_user_id) references public.profiles(id) on delete set null;

alter table public.crm_portal_settings drop constraint if exists crm_portal_settings_updated_by_fkey;
alter table public.crm_portal_settings
  add constraint crm_portal_settings_updated_by_fkey
  foreign key (updated_by) references public.profiles(id) on delete set null;

drop trigger if exists crm_portal_settings_set_updated_at on public.crm_portal_settings;
create trigger crm_portal_settings_set_updated_at
  before update on public.crm_portal_settings
  for each row execute function public.set_updated_at();

-- Den enda raden finns alltid, så att sidan och fördelningen aldrig behöver skapa den.
insert into public.crm_portal_settings (id) values (true) on conflict (id) do nothing;

alter table public.crm_portal_settings enable row level security;
revoke all on table public.crm_portal_settings from anon, authenticated;
grant select on table public.crm_portal_settings to authenticated;
grant update (fallback_user_id, updated_by) on table public.crm_portal_settings to authenticated;
grant select, insert, update, delete on table public.crm_portal_settings to service_role;

drop policy if exists crm_portal_settings_select on public.crm_portal_settings;
create policy crm_portal_settings_select on public.crm_portal_settings
  for select to authenticated
  using ((select has_permission('crm.portal.manage')));

drop policy if exists crm_portal_settings_update on public.crm_portal_settings;
create policy crm_portal_settings_update on public.crm_portal_settings
  for update to authenticated
  using ((select has_permission('crm.portal.manage')))
  with check ((select has_permission('crm.portal.manage')) and updated_by = (select auth.uid()));

-- ------------------------------------------------------------------------------------------------ efterkontroll

-- Pröva effekten: RLS på; anon ingenting; sessionen läser och ändrar BARA säljaren respektive reserven (och vem som
-- ändrade), aldrig lägger till eller tar bort; service_role allt; inställningsraden finns.
do $$
declare
  tbl text;
  col text;
  priv text;
begin
  foreach tbl in array array['public.crm_portal_resellers', 'public.crm_portal_settings'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = tbl::regclass) then
      raise exception 'portalens butiker: RLS är inte på för %', tbl;
    end if;
    if has_table_privilege('anon', tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
      raise exception 'portalens butiker: anon har rättigheter på %', tbl;
    end if;
    if not has_table_privilege('authenticated', tbl, 'SELECT') then
      raise exception 'portalens butiker: authenticated kan inte läsa %', tbl;
    end if;
    -- Tabellnivå: aldrig insert, update på alla kolumner, delete med mera. Kolumngranterna prövas nedan.
    if has_table_privilege('authenticated', tbl, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
      raise exception 'portalens butiker: authenticated har mer än select på tabellnivå för %', tbl;
    end if;
    foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('service_role', tbl, priv) then
        raise exception 'portalens butiker: service_role saknar % på %', priv, tbl;
      end if;
    end loop;
  end loop;

  -- Butikerna: sessionen ändrar säljaren och updated_by, inget annat.
  foreach col in array array['reseller_id', 'name', 'street', 'postal_code', 'city', 'customer_number', 'customer_id',
                             'first_seen_at', 'last_seen_at', 'updated_at'] loop
    if has_column_privilege('authenticated', 'public.crm_portal_resellers', col, 'UPDATE') then
      raise exception 'portalens butiker: authenticated kan ändra crm_portal_resellers.%', col;
    end if;
  end loop;
  foreach col in array array['seller_user_id', 'updated_by'] loop
    if not has_column_privilege('authenticated', 'public.crm_portal_resellers', col, 'UPDATE') then
      raise exception 'portalens butiker: authenticated kan inte ändra crm_portal_resellers.%', col;
    end if;
  end loop;

  -- Inställningarna: sessionen ändrar reserven och updated_by, inget annat.
  foreach col in array array['id', 'updated_at'] loop
    if has_column_privilege('authenticated', 'public.crm_portal_settings', col, 'UPDATE') then
      raise exception 'portalens butiker: authenticated kan ändra crm_portal_settings.%', col;
    end if;
  end loop;
  foreach col in array array['fallback_user_id', 'updated_by'] loop
    if not has_column_privilege('authenticated', 'public.crm_portal_settings', col, 'UPDATE') then
      raise exception 'portalens butiker: authenticated kan inte ändra crm_portal_settings.%', col;
    end if;
  end loop;

  if (select count(*) from public.crm_portal_settings) <> 1 then
    raise exception 'portalens butiker: crm_portal_settings ska ha exakt en rad';
  end if;
end $$;
