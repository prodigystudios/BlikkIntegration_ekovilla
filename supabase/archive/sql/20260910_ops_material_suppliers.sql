-- Leverantörsregistret: vem materialet beställs FRÅN.
--
-- BAKGRUND
-- Materialbeställningen till fabriken görs idag för hand — någon räknar ut vilka depåer som behöver
-- material, skriver ihop ett mail och skickar det. Systemet äger redan indatan (bokade jobb,
-- säckantal, material, depåkoppling) men vet ingenting om MOTTAGAREN. Den här tabellen är den
-- saknade halvan: namn, adress och vilka material leverantören levererar.
--
-- Registret är fristående och läses inte av något ännu. Prognosen (etapp 3) använder
-- lead_time_days för att datera förslaget, och beställningsmailet (etapp 4) slår upp adressen HÄR
-- i stället för att ta emot den från klienten.
--
-- ⚠️ ADRESSEN FÅR ALDRIG KOMMA FRÅN KLIENTEN. Orderbekräftelsens route tar ett fritt
-- recipient_email och mailar dit oförändrat. Kopieras det mönstret till materialbeställningen blir
-- företagets inköpsflöde en öppen relä, och auditbeviset blir angriparens egen inmatning. Skälet
-- att registret finns är att supplier_id ska vara det enda klienten skickar.
--
-- ⚠️ materials BESTÄMMER VILKEN FABRIK MAILET GÅR TILL. Strängarna är kanoniska koder ur
-- MATERIAL_SHORTS (lib/domains/crm/materials.ts) och identiteten är hård: stämmer strängen inte
-- tecken för tecken hittas ingen mottagare — eller, värre, fel mottagare. Ingen CHECK i SQL, av
-- samma skäl som systertabellerna: vokabulären bor i koden och valideras i Zod på ETT ställe.
-- tests/planning/materialSuppliers.test.ts vaktar att listan och koden inte glider isär.
--
-- DEPLOY-ORDNING
-- Kör EFTER 20260608_permissions_model.sql och 20260611_planning_permissions.sql (policyerna
-- anropar has_permission på planning.depot.manage) samt auth_roles_setup.sql (FK -> profiles).
-- Ingen ordning mot 20260910_ops_expected_deliveries.sql — filerna rör inte varandra.
--
-- ADDITIV. Inget befintligt rörs, ingen befintlig behörighet ändras, ingen befintlig tabell
-- ändras. Ordningen mot koden är alltså fri: körs koden först svarar PostgREST 400 på saknad
-- relation, och Leverantörer-fliken visar en felruta ("Leverantörsregistret kunde inte hämtas").
-- Det löftet vilar på `loadError` i app/crm/planering/useEntityCrud.ts — utan den grenen renderades
-- felet i stället som "Inga leverantörer upplagda än", alltså ett påstående om verkligheten byggt
-- på att vi inte vet. Tas grenen bort blir den här raden en lögn.
--
-- Kör i Supabase SQL editor. Idempotent — kör den TVÅ gånger innan du litar på påståendet.
-- Inga tecken utanför BMP i den här filen.

-- ---------------------------------------------------------------------------
-- Tabell
-- ---------------------------------------------------------------------------

create table if not exists public.ops_material_suppliers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  -- NOT NULL med flit. En rad utan adress kan inte ta emot en beställning, och en leverantör som
  -- inte kan ta emot en beställning är ingen leverantör i det här registret utan en kontakt.
  -- Att lägga upp den ändå hade gett en post som syns i väljaren och failar först vid utskicket.
  email          text not null,
  contact_name   text,
  phone          text,
  -- Kanoniska kortkoder ur MATERIAL_SHORTS. Se filhuvudet om varför det inte finns en CHECK.
  --
  -- En tom lista är tillåten i schemat men vägras i Zod: en leverantör utan material matchar aldrig
  -- ett behov och blir alltså osynlig i mottagarvalet, utan att något säger ifrån.
  materials      text[] not null default '{}',
  -- Ledtiden som DATA, inte kod. Styr hur många dagar före run-out prognosen daterar leveransen
  -- (suggested_date = max(today, run_out_day - lead_time_days)), och sätts per leverantör i UI:t.
  --
  -- Taket är inte kosmetiskt: siffran går rakt in i en datumuträkning, och en felskrivning som
  -- 3650 klampar varje förslag till "beställ idag" utan att något ser fel ut. 365 räcker vida för
  -- en fabriksledtid.
  lead_time_days integer not null default 0 check (lead_time_days >= 0 and lead_time_days <= 365),
  note           text,
  -- Avveckling sker genom avaktivering, inte radering: en leverantör som levererat ska gå att se i
  -- efterhand. Inaktiva rader ligger kvar i registret men får aldrig bli mottagare — den regeln
  -- bärs av suppliersForMaterial i domänlagret.
  active         boolean not null default true,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- Ett namn per AKTIV leverantör. Namnet är vad som står i mottagarväljaren, så två rader med samma
-- namn och olika adresser är ett val mellan två fabriker som ser identiska ut — och felet upptäcks
-- när fel fabrik fått beställningen.
--
-- Partiellt på `active`: en avvecklad leverantör håller inte namnet gisslan, men att aktivera en
-- dubblett nekas. btrim + lower eftersom " Ekovilla AB" och "ekovilla ab" är samma fabrik för den
-- som läser listan.
create unique index if not exists ops_material_suppliers_name_uniq
  on public.ops_material_suppliers (lower(btrim(name))) where active;

-- Inget index på materials. Uppslaget "vilka leverantörer har det här materialet" görs i koden över
-- hela den inlästa listan (suppliersForMaterial) — registret är en handfull fabriker, och en GIN
-- över en array i en tabell med tio rader är ren dekoration. Skulle registret någon gång filtreras
-- i databasen med .contains() är det HÄR indexet ska in.

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- ⚠️ SELECT ÄR depot.manage, INTE schedule.read. Frestelsen är att kopiera ops_depots-mallen rakt
-- av — men den ger board-nivå på SELECT, och rollen `konsult` håller planning.schedule.read
-- (20260611_planning_permissions.sql:30). "Administrera"-knappen i planeringen har dessutom ingen
-- egen grind, och Lager-området i modalen är show: true. Med schedule.read hade alltså varje
-- konsult kunnat läsa fabrikernas mailadresser och kontaktpersoner.
--
-- Beställnings*raderna* (etapp 4-5) är en annan sak: de bär bara depå, material, antal och datum
-- och ska kunna visas på tavlan. Chipet på tavlan får aldrig bära leverantörsnamnet.
--
-- Alla fyra operationerna på samma nyckel: att lägga upp, ändra, avaktivera eller ta bort en
-- leverantör är samma sak — ett besked om vem vi handlar av. Samma inköpsgräns som resten av
-- beställningsspåret.

alter table public.ops_material_suppliers enable row level security;
grant select, insert, update, delete on public.ops_material_suppliers to authenticated;

drop policy if exists ops_material_suppliers_select on public.ops_material_suppliers;
create policy ops_material_suppliers_select on public.ops_material_suppliers
  for select to authenticated
  using (public.has_permission('planning.depot.manage'));

drop policy if exists ops_material_suppliers_insert on public.ops_material_suppliers;
create policy ops_material_suppliers_insert on public.ops_material_suppliers
  for insert to authenticated
  with check (created_by = auth.uid() and public.has_permission('planning.depot.manage'));

drop policy if exists ops_material_suppliers_update on public.ops_material_suppliers;
create policy ops_material_suppliers_update on public.ops_material_suppliers
  for update to authenticated
  using (public.has_permission('planning.depot.manage'))
  with check (public.has_permission('planning.depot.manage'));

drop policy if exists ops_material_suppliers_delete on public.ops_material_suppliers;
create policy ops_material_suppliers_delete on public.ops_material_suppliers
  for delete to authenticated
  using (public.has_permission('planning.depot.manage'));

-- ⚠️ TVÅ MEDVETNA LUCKOR I UPDATE-POLICYN, båda prövade och valda bort — ändra inte utan att läsa
-- det här först.
--
-- 1. `created_by` går att skriva om. En policy väljer RADER, aldrig KOLUMNER, så att frysa fältet
--    kräver en BEFORE UPDATE-trigger (mönstret finns: ops_expected_deliveries_forward_only). Den är
--    inte värd sitt underhåll här: `created_by` är ren proveniens, ingenting läser den, och den som
--    kan skriva den håller redan planning.depot.manage. Bär fältet någon gång ett BESLUT — inte
--    bara "vem la upp raden" — är det triggern som ska in, inte en kolumngrind i policyn.
--
-- 2. En ändrad `email` lämnar inget spår. Det följer av att registret medvetet INTE loggar till
--    ops_activity_events: loggen läses med planning.schedule.read och hade blivit en andra läsväg
--    förbi RLS ovan (se noten i app/api/crm/planering/material-suppliers/route.ts).
--
--    Spåret som faktiskt betyder något ligger på beställningen, inte här: ops_material_orders
--    (etapp 4) snapshottar `recipient_email` vid skicktillfället, så varje avsänd order bär vart
--    den GICK — oberoende av vad registret säger idag. En rättad adress får inte skriva om vad en
--    skickad beställning påstår sig ha skickats till. Faller den snapshoten bort ur etapp 4 blir
--    den här luckan verklig, och då behöver registret ett eget spår.

-- ---------------------------------------------------------------------------
-- Realtime: NEJ
-- ---------------------------------------------------------------------------
--
-- ⚠️ TABELLEN LÄGGS MEDVETET INTE I supabase_realtime. postgres_changes skickar HELA den nya raden
-- vid INSERT oavsett RLS — publicering hade alltså skickat email och contact_name till varje
-- ansluten klient, inklusive de som inte får läsa tabellen alls. Det är precis den skillnaden mot
-- ops_expected_deliveries (depå, material, antal, datum — ingenting känsligt) som gör att DEN är
-- publicerad och den här inte.
--
-- Följden är att en nyupplagd leverantör inte dyker upp live hos en kollega som har modalen öppen.
-- Acceptabelt: registret ändras sällan, och listan läses om varje gång panelen öppnas.
--
-- Blocket står här som en uttalad NEJ-rad, inte som ett glapp. Lägg inte till tabellen senare utan
-- att först flytta adressen ur raden.

-- ---------------------------------------------------------------------------
-- Verifiering (kör efter applicering)
-- ---------------------------------------------------------------------------
--
-- 1. RLS är på och fyra policyer finns:
--
--    select relrowsecurity from pg_class where oid = 'public.ops_material_suppliers'::regclass;
--    select policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename = 'ops_material_suppliers' order by policyname;
--
-- 2. INGEN av policyerna nämner schedule.read (se noten ovan — det är hela poängen):
--
--    select policyname, qual, with_check from pg_policies
--    where schemaname = 'public' and tablename = 'ops_material_suppliers';
--    -- ska bara innehålla planning.depot.manage
--
-- 3. Tabellen ligger INTE i realtime-publikationen. Frågan ska ge noll rader:
--
--    select 1 from pg_publication_tables
--    where pubname = 'supabase_realtime' and schemaname = 'public'
--      and tablename = 'ops_material_suppliers';
--
-- 4. Dubblettnamn nekas bland aktiva, men inte mot en avvecklad. Andra insert ska fela med 23505,
--    tredje ska gå igenom:
--
--    insert into public.ops_material_suppliers (name, email, materials, created_by)
--    values ('Testfabriken', 'test@example.com', array['EKOVILLA'], auth.uid());
--    insert into public.ops_material_suppliers (name, email, materials, created_by)
--    values ('  testfabriken  ', 'annan@example.com', array['EKOVILLA'], auth.uid());  -- ska fela
--    update public.ops_material_suppliers set active = false where name = 'Testfabriken';
--    insert into public.ops_material_suppliers (name, email, materials, created_by)
--    values ('Testfabriken', 'annan@example.com', array['EKOVILLA'], auth.uid());      -- ska gå
--
--    delete from public.ops_material_suppliers where name ilike 'testfabriken';
--
-- 5. Ledtidstaket biter:
--
--    insert into public.ops_material_suppliers (name, email, lead_time_days, created_by)
--    values ('Ledtidstest', 'lt@example.com', 3650, auth.uid());  -- ska fela (23514)
