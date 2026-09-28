-- Prislistan till återförsäljarportalen: behörigheten, publiceringarna och sidans läsning.
--
-- BAKGRUND
-- RESELLER_PORTAL_CRM_PLAN.md, fas 2b. Sidan Återförsäljarportalen (CRM → Inställningar) förhandsvisar prislistan
-- och publicerar den: lista 160 ur Fortnox plus portalfälten per artikel (fas 2a), skickad till portalen genom
-- utskickskön (fas 1b). Varje publicering blir en ny prislista i portalen.
--
--   crm.portal.manage                   ny nyckel, bara admin: portalens sida och allt den gör. Speglar
--                                       lib/auth/permissions.ts PERMISSION_KEYS (59 → 60).
--   crm_portal_pricelist_publications   varje publicering: giltig från, hashen av innehållet, löpnumret,
--                                       Idempotency-Key (`pricelist-<giltig från>-<hash>-<löpnummer>`, samma som
--                                       händelsen i kön), kroppen som skickades, antalet artiklar, vem och när.
--                                       Löpnumret gör att en lista kan publiceras IGEN: X, sedan Y, sedan X igen med
--                                       samma datum hade annars fått första X:ets nyckel, ingenting hade skickats och
--                                       portalen hade behållit Y. Samma innehåll och datum som den SENASTE
--                                       publiceringen, som inte nekats, är samma publicering
--                                       (lib/domains/portal/pricelistPublish.ts).
--                                       Vem sparas också som NAMN vid publiceringen: sessionen läser bara sin egen
--                                       profil, och ett namnuppslag ska inte bli en ny elevation
--                                       (SUPABASE_CONVENTIONS.md, profiles). Historik: ändras och tas aldrig bort, så
--                                       sessionen får bara select och insert, och bara som sig själv
--                                       (published_by = auth.uid()).
--   läspolicyer                         sidan läser portalfälten (policyn i 2a gällde bara crm.article.manage) och
--                                       kön, för att visa om en publicering har kommit fram. Kön SKRIVS fortfarande
--                                       bara av service_role; claim-funktionen rörs inte.
--
-- ⚠️ Kön bär senare jobbens händelser (fas 4b). En läsare av kön med crm.portal.manage ser dem också. Nyckeln är
-- admin, och det är samma krets som ska kunna se och skicka om uppgivna händelser.
--
-- ÅTKOMST
-- Default privileges är stängda sedan 20260926134651; varje grant står här, service_role uttryckligen (se
-- 20260928053434). Additiv: nya objekt, två nya policyer och en ny grant (select på kön), inget befintligt
-- stramas åt. Kan gå till prod före koden. Idempotent, kan köras om.

-- -------------------------------------------------------------------------------------------------- behörigheten

insert into public.permissions (key, description) values
  ('crm.portal.manage', 'CRM: återförsäljarportalen, prislistan och utskicken (admin)')
on conflict (key) do nothing;

insert into public.role_permissions (role, permission_key) values
  ('admin', 'crm.portal.manage')
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------- publiceringarna

create table if not exists public.crm_portal_pricelist_publications (
  id uuid primary key default gen_random_uuid(),
  valid_from date not null,
  -- sha256 (hex) av artiklarna som JSON med sorterade nycklar (lib/domains/portal/pricelist.ts).
  content_hash text not null,
  -- Publiceringens nummer i ordningen, 1, 2, 3 …
  sequence integer not null,
  -- `pricelist-<valid_from>-<content_hash>-<sequence>`, samma nyckel som händelsen i portal_outbound_events.
  idempotency_key text not null,
  payload jsonb not null,
  article_count integer not null,
  published_by uuid,
  published_by_name text,
  created_at timestamptz not null default now()
);

alter table public.crm_portal_pricelist_publications drop constraint if exists crm_portal_pricelist_publications_idempotency_key_key;
alter table public.crm_portal_pricelist_publications
  add constraint crm_portal_pricelist_publications_idempotency_key_key unique (idempotency_key);

alter table public.crm_portal_pricelist_publications drop constraint if exists crm_portal_pricelist_publications_content_hash_check;
alter table public.crm_portal_pricelist_publications
  add constraint crm_portal_pricelist_publications_content_hash_check check (content_hash ~ '^[0-9a-f]{64}$');

alter table public.crm_portal_pricelist_publications drop constraint if exists crm_portal_pricelist_publications_idempotency_key_check;
alter table public.crm_portal_pricelist_publications
  add constraint crm_portal_pricelist_publications_idempotency_key_check check (
    idempotency_key ~ '^pricelist-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f]{64}-[1-9][0-9]{0,8}$'
    and idempotency_key = 'pricelist-' || substring(idempotency_key from 11 for 10) || '-' || content_hash || '-' || sequence::text
  );

alter table public.crm_portal_pricelist_publications drop constraint if exists crm_portal_pricelist_publications_sequence_check;
alter table public.crm_portal_pricelist_publications
  add constraint crm_portal_pricelist_publications_sequence_check check (sequence > 0);

-- En tom lista publiceras aldrig: portalen hade fått en prislista utan artiklar att räkna offerter på.
alter table public.crm_portal_pricelist_publications drop constraint if exists crm_portal_pricelist_publications_article_count_check;
alter table public.crm_portal_pricelist_publications
  add constraint crm_portal_pricelist_publications_article_count_check check (article_count > 0);

alter table public.crm_portal_pricelist_publications drop constraint if exists crm_portal_pricelist_publications_published_by_name_check;
alter table public.crm_portal_pricelist_publications
  add constraint crm_portal_pricelist_publications_published_by_name_check check (
    published_by_name is null or char_length(published_by_name) <= 200
  );

alter table public.crm_portal_pricelist_publications drop constraint if exists crm_portal_pricelist_publications_published_by_fkey;
alter table public.crm_portal_pricelist_publications
  add constraint crm_portal_pricelist_publications_published_by_fkey
  foreign key (published_by) references public.profiles(id) on delete set null;

-- Sidan visar de senaste först, och publiceringen läser den senaste.
create index if not exists crm_portal_pricelist_publications_sequence_idx
  on public.crm_portal_pricelist_publications (sequence desc, created_at desc);

alter table public.crm_portal_pricelist_publications enable row level security;
revoke all on table public.crm_portal_pricelist_publications from anon, authenticated;
grant select, insert on table public.crm_portal_pricelist_publications to authenticated;
grant select, insert, update, delete on table public.crm_portal_pricelist_publications to service_role;

drop policy if exists crm_portal_pricelist_publications_select on public.crm_portal_pricelist_publications;
create policy crm_portal_pricelist_publications_select on public.crm_portal_pricelist_publications
  for select to authenticated
  using ((select has_permission('crm.portal.manage')));

drop policy if exists crm_portal_pricelist_publications_insert on public.crm_portal_pricelist_publications;
create policy crm_portal_pricelist_publications_insert on public.crm_portal_pricelist_publications
  for insert to authenticated
  with check ((select has_permission('crm.portal.manage')) and published_by = (select auth.uid()));

-- ------------------------------------------------------------------------------------------------ läspolicyerna

-- Förhandsvisningen läser portalfälten med sessionen. En egen policy i stället för att ändra 2a:s: två tillåtande
-- policyer är ett ELLER, och 2a:s policy står kvar som den prövades.
drop policy if exists crm_portal_article_fields_select_portal on public.crm_portal_article_fields;
create policy crm_portal_article_fields_select_portal on public.crm_portal_article_fields
  for select to authenticated
  using ((select has_permission('crm.portal.manage')));

-- Kön: bara läsning. Inga insert-, update- eller delete-grants, så sessionen kan aldrig lägga till, ändra eller
-- ta en händelse; det gör service_role (enqueuePortalEvent, dispatchPortalOutbox).
grant select on table public.portal_outbound_events to authenticated;

drop policy if exists portal_outbound_events_select_portal on public.portal_outbound_events;
create policy portal_outbound_events_select_portal on public.portal_outbound_events
  for select to authenticated
  using ((select has_permission('crm.portal.manage')));

-- ------------------------------------------------------------------------------------------------ efterkontroll

-- Pröva effekten: bara admin har nyckeln; publiceringarna är select + insert för sessionen och allt för service_role;
-- kön är bara läsbar för sessionen och fortfarande stängd för anon; claim-funktionen körs bara av service_role.
do $$
declare
  pub constant text := 'public.crm_portal_pricelist_publications';
  queue constant text := 'public.portal_outbound_events';
  priv text;
begin
  if not exists (select 1 from public.role_permissions where permission_key = 'crm.portal.manage' and role::text = 'admin') then
    raise exception 'portalens prislista: admin saknar crm.portal.manage';
  end if;
  if exists (select 1 from public.role_permissions where permission_key = 'crm.portal.manage' and role::text <> 'admin') then
    raise exception 'portalens prislista: en annan roll än admin har crm.portal.manage';
  end if;

  if not (select c.relrowsecurity from pg_class c where c.oid = pub::regclass) then
    raise exception 'portalens prislista: RLS är inte på för publiceringarna';
  end if;
  foreach priv in array array['SELECT', 'INSERT'] loop
    if not has_table_privilege('authenticated', pub, priv) then
      raise exception 'portalens prislista: authenticated saknar % på publiceringarna', priv;
    end if;
  end loop;
  -- En kommaseparerad lista svarar sant om NÅGON finns.
  if has_table_privilege('authenticated', pub, 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'portalens prislista: authenticated kan ändra eller ta bort publiceringar';
  end if;
  foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', pub, priv) then
      raise exception 'portalens prislista: service_role saknar % på publiceringarna', priv;
    end if;
  end loop;

  foreach priv in array array[pub, queue, 'public.crm_portal_article_fields'] loop
    if has_table_privilege('anon', priv, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
      raise exception 'portalens prislista: anon har rättigheter på %', priv;
    end if;
  end loop;

  if not has_table_privilege('authenticated', queue, 'SELECT') then
    raise exception 'portalens prislista: authenticated kan inte läsa kön';
  end if;
  if has_table_privilege('authenticated', queue, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'portalens prislista: authenticated kan skriva i kön';
  end if;
  foreach priv in array array['anon', 'authenticated'] loop
    if has_function_privilege(priv, 'public.claim_portal_outbound_events(integer, interval)', 'EXECUTE') then
      raise exception 'portalens prislista: % kan köra claim_portal_outbound_events', priv;
    end if;
  end loop;
end $$;
