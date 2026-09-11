-- Avstämning av depålagret: "den här dagen stod det X säckar på depån".
--
-- BAKGRUND
-- Saldot är levererat − förbrukat. Båda halvorna går bara åt ETT håll att rätta idag: en leverans
-- kan bara vara positiv (check sacks > 0), det finns ingen väg att ändra eller ta bort en, och
-- förbrukningen räknas fram ur säckrapporterna. Visade en depå för FÅ säckar gick det att fylla på
-- med en registrerad leverans. Visade den för MÅNGA gick det inte att rätta alls.
--
-- För många är det vanliga felet, inte ett undantag: blåsta säckar som aldrig rapporterats ger för
-- låg förbrukning och alltså för högt saldo. Och ett för högt saldo tystar bristbanderollen — den
-- farliga riktningen.
--
-- Ekovilla inventerar redan i ett annat system (Williams besked 2026-09-11). Den här tabellen är
-- alltså inte en inventering utan en AVSTÄMNING: siffran förs över hit, och saldot rättas efter den.
--
-- ⚠️ AVSTÄMNING, INTE JUSTERING — OCH SKILLNADEN ÄR INTE AKADEMISK. En justering skriver in skillnaden
-- mellan räknat och bokfört som en delta-rad. Då räknas säckarna DUBBELT när en rapport för arbete
-- FÖRE räkningen kommer in efteråt:
--
--     måndag morgon räknas 400.  I fredags blåstes 50, rapporten skickas på tisdag.
--       justering:   saldo 400 -> på tisdag dras 50 igen -> 350, fast det står 400 på depån
--       avstämning:  saldot räknas FRÅN räkningen; fredagens 50 syns redan i de 400 -> stannar på 400
--
-- saldo = räknat + leveranser EFTER räkningsdagen − förbrukning från och med räkningsdagen.
--
-- ⚠️ FÖRBRUKNINGEN RÄKNAS INTE MED ETT DATUMFILTER. Säckrapporteringen har en supersede-regel: finns en
-- egenkontroll gäller BARA den, och den ersätter delrapporterna. Förbrukningen efter en räkning är
-- därför "det huvudboken säger nu, minus det den sa i räkningsögonblicket" (consumptionAfterCounts i
-- lib/domains/planning/depotStock.ts). Och för att avgöra om en EGENKONTROLL fanns vid räkningen
-- används dess created_at, inte dess report_day — den report_day är jobbets FÖRSTA dag (förifylld ur
-- tidigaste segmentet), så varje pågående jobb hade annars hamnat "före räkningen". Två versioner av
-- koden gick fel på just det, båda åt det farliga hållet.
--
-- ⚠️ RÄKNINGSDAGEN ÄR MED FLIT ASYMMETRISK, så att ett fel alltid hamnar åt SAMMA håll:
--   förbrukning PÅ räkningsdagen  -> dras av  (räknas som EFTER)   fel = saldo för lågt
--   leverans    PÅ räkningsdagen  -> läggs INTE på (räknas som FÖRE)  fel = saldo för lågt
-- Kom leveransen på morgonen innan man räknade står den redan i antalet; att lägga på den igen gav ett
-- för HÖGT saldo, som tystar bristbanderollen. En tidigare version hade "samma regel åt båda håll" —
-- det gjorde leveransfelet farligt. För lågt betyder något för mycket beställt, aldrig en bil utan
-- material.
--
-- BARA TILLÄGG. Ingen UPDATE, ingen DELETE: den senaste räkningen per depå och material gäller, och en
-- felaktig räkning rättas med en ny. Historiken lagras därmed redan — en historikvy senare är bara en
-- vy, ingen migrering. `created_by_name` snapshottas av samma skäl: profiles är self-read-only, så ett
-- namn som inte skrevs vid inmatningen går aldrig att hämta i efterhand.
--
-- DEPLOY-ORDNING
-- Kör EFTER 20260612_ops_depots.sql (FK), 20260611_planning_permissions.sql (policyerna anropar
-- has_permission) och auth_roles_setup.sql (FK -> profiles).
--
-- ADDITIV. Ingen befintlig tabell, policy eller funktion rörs. Men ordningen mot koden är INTE fri:
-- ⚠️ SQL FÖRE KOD, av två skäl som båda slår bredare än funktionen själv:
--   1. Lagerberäkningen läser tabellen och failar stängt — saknas den dör HELA lagervyn och
--      bristbanderollen (PostgREST 400 på saknad relation).
--   2. Tavlan prenumererar på tabellen i en DELAD realtime-kanal (planning-board-sync) tillsammans med
--      alla andra ops-tabeller. Saknas tabellen i publikationen kan hela kanalen misslyckas — och då
--      slutar livesynken för SCHEMAT, inte bara för lagret, utan att något felmeddelande syns.
--
-- Kör i Supabase SQL editor. Idempotent — kör den TVÅ gånger innan du litar på påståendet.
-- Inga tecken utanför BMP i den här filen.

-- ---------------------------------------------------------------------------
-- Tabell
-- ---------------------------------------------------------------------------

create table if not exists public.ops_depot_stock_counts (
  id              uuid primary key default gen_random_uuid(),
  -- RESTRICT, inte CASCADE: en räkning är revision över vad som faktiskt stod på depån och ska inte
  -- försvinna tyst med den. Samma val som ops_expected_deliveries. Avveckling sker via ops_depots.active.
  depot_id        uuid not null references public.ops_depots(id) on delete restrict,
  -- Kanonisk kortkod ur MATERIAL_SHORTS. Ingen CHECK, av samma skäl som systertabellerna: vokabulären
  -- bor i koden och valideras i Zod på ett ställe. Identiteten är hård — stämmer strängen inte tecken
  -- för tecken möter räkningen aldrig sina leveranser och sin förbrukning.
  material        text not null,
  -- >= 0, inte > 0: en tom depå är ett svar, och ett av de viktigaste. Att räkna till noll är precis
  -- det som ska tända bristbanderollen på en depå som systemet trodde var full.
  counted_sacks   integer not null check (counted_sacks >= 0),
  counted_on      date not null,
  note            text,
  created_by      uuid references public.profiles(id) on delete set null,
  -- Nullbar trots ny tabell: getCurrentUser kan returnera en användare utan full_name, och en räkning
  -- får inte nekas för att någon saknar ett visningsnamn.
  created_by_name text,
  created_at      timestamptz not null default now()
);

-- "Senaste räkningen per depå och material" är den enda frågan tabellen besvarar. Sorteringen i
-- indexet matchar den: nyast räkningsdag först, och vid två räkningar samma dag den senast inmatade.
create index if not exists ops_depot_stock_counts_latest_idx
  on public.ops_depot_stock_counts (depot_id, material, counted_on desc, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- SELECT är board-nivå (planning.schedule.read): raden bär depå, material, antal och datum — samma
-- uppgifter som saldot den ingår i, och saldot är board-nivå. Ingenting om leverantörer eller pris.
--
-- INSERT kräver planning.depot.manage. ⚠️ Känsligare än att registrera en leverans (schedule.write):
-- en för högt räknad siffra TYSTAR bristbanderollen, och en räkning kan dessutom dölja svinn. Det är
-- ett beslut om vad som står på depån, inte lagerarbete.
--
-- Ingen UPDATE och ingen DELETE. En felaktig räkning rättas med en ny.

alter table public.ops_depot_stock_counts enable row level security;
-- ⚠️ `grant select, insert` ENSAMT BEGRÄNSAR INGENTING. En tabell som skapas i Supabase SQL-editorn
-- får projektets default privileges — `grant all ... to anon, authenticated` — så authenticated har
-- redan UPDATE och DELETE när raden nedan körs. Att bara lägga till select och insert tar inte bort
-- något. Därför en uttrycklig revoke. (RLS hade ändå nekat, eftersom ingen update- eller delete-policy
-- finns — men "bara tillägg" ska vara sant på båda nivåerna, inte hänga på att ingen någonsin lägger
-- till en policy.)
revoke update, delete, truncate on public.ops_depot_stock_counts from authenticated, anon;
revoke all on public.ops_depot_stock_counts from anon;
grant select, insert on public.ops_depot_stock_counts to authenticated;

drop policy if exists ops_depot_stock_counts_select on public.ops_depot_stock_counts;
create policy ops_depot_stock_counts_select on public.ops_depot_stock_counts
  for select to authenticated
  using (public.has_permission('planning.schedule.read'));

-- ⚠️ DATUMTAKET SITTER HÄR, INTE BARA I ZOD. En framtidsdaterad räkning blir baslinje DIREKT (den
-- senaste gäller) och stryker all förbrukning före sitt datum — saldot fryses på ett tal som ingen har
-- räknat. Samma felklass som den framtidsdaterade leveransen i etapp 0. Zod-grinden räcker inte, för
-- en direkt PostgREST-skrivning går förbi routen; policyn gör det inte. Svensk kalenderdag, inte UTC:
-- mellan midnatt och 02:00 är de olika dagar.
drop policy if exists ops_depot_stock_counts_insert on public.ops_depot_stock_counts;
create policy ops_depot_stock_counts_insert on public.ops_depot_stock_counts
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.has_permission('planning.depot.manage')
    and counted_on <= (now() at time zone 'Europe/Stockholm')::date
  );

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
--
-- Publicerad, så att tavlans bristbanderoll räknas om hos kollegor när en räkning förs in — samma
-- skäl som ops_depot_deliveries. Raden bär ett visningsnamn, men samma exponering finns redan i
-- ops_activity_events (actor_name), som är publicerad och läses med samma nyckel.
--
-- Ingen `replica identity full`: tabellen är bara-tillägg, så det kommer aldrig UPDATE- eller
-- DELETE-händelser som skulle behöva den gamla raden.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ops_depot_stock_counts'
  ) then
    alter publication supabase_realtime add table public.ops_depot_stock_counts;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Verifiering (kör efter applicering)
-- ---------------------------------------------------------------------------
--
-- 1. RLS på, och exakt TVÅ policyer (select, insert) — ingen update, ingen delete:
--
--    select relrowsecurity from pg_class where oid = 'public.ops_depot_stock_counts'::regclass;
--    select policyname, cmd from pg_policies
--    where schemaname = 'public' and tablename = 'ops_depot_stock_counts' order by policyname;
--
-- 2. Ingen grant på update/delete/truncate för authenticated. Frågan ska lista SELECT och INSERT
--    (och möjligen REFERENCES/TRIGGER från default privileges, som är ofarliga här) — men ALDRIG
--    UPDATE, DELETE eller TRUNCATE. Står någon av dem där har revoke-raden inte körts.
--
--    select privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'ops_depot_stock_counts'
--      and grantee = 'authenticated' order by privilege_type;
--
-- 3. Tabellen ligger i realtime-publikationen. En rad:
--
--    select 1 from pg_publication_tables
--    where pubname = 'supabase_realtime' and schemaname = 'public'
--      and tablename = 'ops_depot_stock_counts';
--
-- 4. CHECK:en på antalet biter (körs som postgres i editorn, alltså förbi RLS — det är CHECK:en som
--    prövas här, inte policyn):
--
--    insert into public.ops_depot_stock_counts (depot_id, material, counted_sacks, counted_on)
--    values ((select id from public.ops_depots limit 1), 'EKOVILLA', -1, current_date);
--    -- ska fela (23514)
--
-- 5. ⚠️ DATUMTAKET prövas INTE i editorn. Policyn gäller rollen authenticated, och editorn kör som
--    postgres, som går förbi RLS. Taket prövas genom att försöka spara en räkning daterad i morgon i
--    appen — formuläret stoppar det, och en direkt skrivning mot PostgREST nekas av policyn.
