-- Portalfälten per artikel: det återförsäljarportalens prislista behöver utöver Fortnox.
--
-- BAKGRUND
-- RESELLER_PORTAL_CRM_PLAN.md, fas 2a. Prislistan till portalen (fas 2b) byggs ur Fortnox lista 160 (pris) och
-- artikelcachen (namn, enhet), men portalen behöver också det Fortnox inte har (kontraktet, "Flöde 1"):
--
--   customer_name   namnet slutkunden ser på offerten, t.ex. "Lösull på vinden". Nämner aldrig Ekovilla.
--   category        grupperingen i portalen: losull, skivor, tatskikt, verktyg, etablering, ovrigt.
--   labor_share     andelen av priset som är arbete och ger ROT, 0–1. numeric(4,3) som portalens egen kolumn
--                   (pricelist_articles.labor_share), så att inget avrundas på vägen: 45,5 % = 0,455.
--   note            kort förtydligande i prislistan, får vara tom.
--   sort_order      ordningen i listan.
--   publish         om artikeln ska med i prislistan. Publiceringen (fas 2b) hoppar ändå över en artikel utan
--                   enhet, utan pris på lista 160 eller som är inaktiv, eftersom det kan ändras i Fortnox efteråt.
--                   Här krävs bara det som bara finns här: kundnamn och kategori.
--
-- Nyckeln är artikelnumret, utan FK mot fortnox_articles_cache, som fortnox_article_favorites och
-- fortnox_article_work_description_defaults: fälten är vår egen kuratering och ska överleva varje omsynk.
--
-- IFYLLNADEN (William 2026-09-28): de 51 artiklarna portalen visar i dag, med portalens kundnamn, kategori och
-- arbetsandel ur ~/Documents/aterforsaljare-ekovilla/lib/data/mock/seed.ts (ARTICLES, prods lista 160 läst
-- 2026-09-25), publiceras = ja, anteckningen tom och ordningen 10, 20 … 510 i portalens ordning. Första publiceringen
-- ändrar då inget för butikerna. ⚠️ Arbetsandelarna för inblåst lösull (0,45 och 0,5) är portalens ANTAGANDEN och
-- ger ROT: de ska bekräftas av Ekovilla före första publiceringen. `on conflict do nothing`: en körning till skriver
-- aldrig över det någon har ändrat.
--
-- ÅTKOMST
-- crm.article.manage (admin), samma nyckel som artikelsidan, i policyerna för select, insert och update. authenticated
-- får bara de tre rättigheterna: redigeringen upserter och tar aldrig bort (publish = nej räcker). service_role får
-- allt uttryckligen, eftersom default privileges gäller per databas (se 20260928053434). Publiceringen i fas 2b
-- (crm.portal.manage) får en egen policy i sin migrering.
--
-- Additiv: ett nytt objekt, inget befintligt ändras. Kan gå till prod före koden. Idempotent, kan köras om.

create table if not exists public.crm_portal_article_fields (
  article_number text primary key,
  customer_name text not null default '',
  -- null = inte vald än.
  category text,
  labor_share numeric(4,3) not null default 0,
  note text not null default '',
  sort_order integer not null default 0,
  publish boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.crm_portal_article_fields drop constraint if exists crm_portal_article_fields_updated_by_fkey;
alter table public.crm_portal_article_fields
  add constraint crm_portal_article_fields_updated_by_fkey
  foreign key (updated_by) references public.profiles(id) on delete set null;

alter table public.crm_portal_article_fields drop constraint if exists crm_portal_article_fields_article_number_check;
alter table public.crm_portal_article_fields
  add constraint crm_portal_article_fields_article_number_check check (
    char_length(article_number) between 1 and 50 and article_number = btrim(article_number)
  );

alter table public.crm_portal_article_fields drop constraint if exists crm_portal_article_fields_customer_name_check;
alter table public.crm_portal_article_fields
  add constraint crm_portal_article_fields_customer_name_check check (
    char_length(customer_name) <= 200 and customer_name = btrim(customer_name)
  );

-- Samma värden som portalens pricelist_articles.category.
alter table public.crm_portal_article_fields drop constraint if exists crm_portal_article_fields_category_check;
alter table public.crm_portal_article_fields
  add constraint crm_portal_article_fields_category_check check (
    category is null or category in ('losull', 'skivor', 'tatskikt', 'verktyg', 'etablering', 'ovrigt')
  );

alter table public.crm_portal_article_fields drop constraint if exists crm_portal_article_fields_labor_share_check;
alter table public.crm_portal_article_fields
  add constraint crm_portal_article_fields_labor_share_check check (labor_share between 0 and 1);

alter table public.crm_portal_article_fields drop constraint if exists crm_portal_article_fields_note_check;
alter table public.crm_portal_article_fields
  add constraint crm_portal_article_fields_note_check check (char_length(note) <= 500 and note = btrim(note));

alter table public.crm_portal_article_fields drop constraint if exists crm_portal_article_fields_sort_order_check;
alter table public.crm_portal_article_fields
  add constraint crm_portal_article_fields_sort_order_check check (sort_order >= 0);

-- En publicerad artikel har allt portalen kräver som bara finns här. Portalens kolumner är not null.
alter table public.crm_portal_article_fields drop constraint if exists crm_portal_article_fields_publish_check;
alter table public.crm_portal_article_fields
  add constraint crm_portal_article_fields_publish_check check (
    not publish or (customer_name <> '' and category is not null)
  );

drop trigger if exists crm_portal_article_fields_set_updated_at on public.crm_portal_article_fields;
create trigger crm_portal_article_fields_set_updated_at
  before update on public.crm_portal_article_fields
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------------------- åtkomst

alter table public.crm_portal_article_fields enable row level security;
revoke all on table public.crm_portal_article_fields from anon, authenticated;
grant select, insert, update on table public.crm_portal_article_fields to authenticated;
grant select, insert, update, delete on table public.crm_portal_article_fields to service_role;

drop policy if exists crm_portal_article_fields_select on public.crm_portal_article_fields;
create policy crm_portal_article_fields_select on public.crm_portal_article_fields
  for select to authenticated
  using ((select has_permission('crm.article.manage')));

drop policy if exists crm_portal_article_fields_insert on public.crm_portal_article_fields;
create policy crm_portal_article_fields_insert on public.crm_portal_article_fields
  for insert to authenticated
  with check ((select has_permission('crm.article.manage')));

drop policy if exists crm_portal_article_fields_update on public.crm_portal_article_fields;
create policy crm_portal_article_fields_update on public.crm_portal_article_fields
  for update to authenticated
  using ((select has_permission('crm.article.manage')))
  with check ((select has_permission('crm.article.manage')));

-- -------------------------------------------------------------------------------------------------------- ifyllnaden

insert into public.crm_portal_article_fields (article_number, customer_name, category, labor_share, sort_order, publish)
select v.article_number, v.customer_name, v.category, v.labor_share, v.sort_order, true
from (values
  ('2410509',  'Lösull på vinden', 'losull', 0.450, 10),
  ('2410510',  'Lösull i snedtak', 'losull', 0.500, 20),
  ('2410511',  'Lösull i vägg', 'losull', 0.500, 30),
  ('2410512',  'Lösull i golvbjälklag', 'losull', 0.500, 40),
  ('2410513',  'Lösull i mellanbjälklag, underifrån', 'losull', 0.500, 50),
  ('2410578',  'Lösull i mellanbjälklag, ovanifrån', 'losull', 0.500, 60),
  ('1095',     'Lösull av glasull på vinden', 'losull', 0.450, 70),
  ('1094',     'Lösull av glasull i snedtak, λ 0,036', 'losull', 0.500, 80),
  ('16767',    'Lösull av glasull i snedtak, λ 0,038', 'losull', 0.500, 90),
  ('1093',     'Lösull av glasull i vägg, λ 0,033', 'losull', 0.500, 100),
  ('16765',    'Lösull av glasull i vägg, λ 0,034', 'losull', 0.500, 110),
  ('16766',    'Lösull av glasull i vägg, λ 0,036', 'losull', 0.500, 120),
  ('2410521',  'Lösull av glasull i mellanbjälklag', 'losull', 0.500, 130),
  ('2410522',  'Lösull av glasull i golvbjälklag', 'losull', 0.500, 140),
  ('2410508',  'Cellulosaisolering i säck', 'losull', 0.000, 150),
  ('2410529',  'Cellulosa för efterfyllning, 10 kg', 'losull', 0.000, 160),
  ('1010',     'Etablering', 'etablering', 0.000, 170),
  ('2410528',  'Isoleringsskiva 30 mm, 9,8 m² per paket', 'skivor', 0.000, 180),
  ('13001',    'Isoleringsskiva 45 mm, 6,39 m² per paket', 'skivor', 0.000, 190),
  ('13003',    'Isoleringsskiva 70 mm, 3,93 m² per paket', 'skivor', 0.000, 200),
  ('13004',    'Isoleringsskiva 95 mm, 2,95 m² per paket', 'skivor', 0.000, 210),
  ('13005',    'Isoleringsskiva 120 mm, 2,46 m² per paket', 'skivor', 0.000, 220),
  ('13006',    'Isoleringsskiva 145 mm, 1,97 m² per paket', 'skivor', 0.000, 230),
  ('13007',    'Isoleringsskiva 195 mm, 1,47 m² per paket', 'skivor', 0.000, 240),
  ('2410537',  'Träfiberskiva 22 mm, pall om 139 m²', 'skivor', 0.000, 250),
  ('2410538',  'Träfiberskiva 35 mm, pall om 85,6 m²', 'skivor', 0.000, 260),
  ('1102',     'Träfiberskiva 40 mm, pall om 74,93 m²', 'skivor', 0.000, 270),
  ('2410546',  'Träfiberskiva 40 mm, 1,34 m²', 'skivor', 0.000, 280),
  ('4WCBTD60', 'Träfiberskiva 60 mm, pall om 48 m²', 'skivor', 0.000, 290),
  ('13201',    'Variabel ångbroms Smart 3 × 50 m', 'tatskikt', 0.000, 300),
  ('13202',    'Variabel ångbroms Smart 3 × 25 m, förvikt', 'tatskikt', 0.000, 310),
  ('13204',    'Variabel ångbroms Smart 3 × 25 m', 'tatskikt', 0.000, 320),
  ('13203',    'Variabel ångbroms Smart 1,5 × 50 m', 'tatskikt', 0.000, 330),
  ('13220',    'Variabel ångbroms Active 3 × 25 m', 'tatskikt', 0.000, 340),
  ('13205',    'Ångbroms 3 × 50 m', 'tatskikt', 0.000, 350),
  ('13206',    'Ångbroms 3 × 25 m, förvikt', 'tatskikt', 0.000, 360),
  ('13207',    'Ångbroms 3 × 25 m', 'tatskikt', 0.000, 370),
  ('13208',    'Ångbroms 1,5 × 50 m', 'tatskikt', 0.000, 380),
  ('13300',    'Underlagstakduk 1,5 × 50 m', 'tatskikt', 0.000, 390),
  ('13310',    'Vindskyddsduk 3 × 25 m', 'tatskikt', 0.000, 400),
  ('13210',    'Byggfolietejp 50 mm × 25 m', 'tatskikt', 0.000, 410),
  ('1AR02070', 'Byggfolietejp Tescon Vana 60 mm × 30 m', 'tatskikt', 0.000, 420),
  ('11251',    'Byggfolietejp Tescon Vana 150 mm × 30 m', 'tatskikt', 0.000, 430),
  ('1AR03694', 'Byggfolietejp Tescon Rapic 60 mm × 30 m', 'tatskikt', 0.000, 440),
  ('13215',    'Tejpplåster 190 × 190 mm, 200 st per rulle', 'tatskikt', 0.000, 450),
  ('13450',    'Spiktätningsband 50 mm × 25 m', 'tatskikt', 0.000, 460),
  ('2410566',  'Drev 50 × 8–10 mm, 30 m', 'tatskikt', 0.000, 470),
  ('2410567',  'Stosar 5–160 mm, 5-pack', 'tatskikt', 0.000, 480),
  ('13400',    'Primer, spray 500 ml', 'tatskikt', 0.000, 490),
  ('13102',    'Isoleringssåg', 'verktyg', 0.000, 500),
  ('13103',    'Skärställning för isoleringsskivor', 'verktyg', 0.000, 510)
) as v(article_number, customer_name, category, labor_share, sort_order)
on conflict (article_number) do nothing;

-- ------------------------------------------------------------------------------------------------------ efterkontroll

-- Pröva effekten, inte hur grantsen råkar vara skrivna: anon når ingenting, authenticated exakt select, insert och
-- update (och kan köra has_permission, som policyerna anropar), service_role allt, och RLS är på.
do $$
declare
  tbl constant text := 'public.crm_portal_article_fields';
  priv text;
begin
  if not (select c.relrowsecurity from pg_class c where c.oid = tbl::regclass) then
    raise exception 'portalfälten: RLS är inte på';
  end if;
  if has_table_privilege('anon', tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'portalfälten: anon har rättigheter';
  end if;
  -- En kommaseparerad lista svarar sant om NÅGON finns; varje rättighet prövas därför för sig.
  foreach priv in array array['SELECT', 'INSERT', 'UPDATE'] loop
    if not has_table_privilege('authenticated', tbl, priv) then
      raise exception 'portalfälten: authenticated saknar %', priv;
    end if;
  end loop;
  if has_table_privilege('authenticated', tbl, 'DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
    raise exception 'portalfälten: authenticated har mer än select, insert och update';
  end if;
  foreach priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', tbl, priv) then
      raise exception 'portalfälten: service_role saknar %', priv;
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.has_permission(text)', 'EXECUTE') then
    raise exception 'portalfälten: authenticated kan inte köra has_permission, som policyerna anropar';
  end if;
end $$;
