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
-- Rapporterna bär arbetsdagen (ops_segment_reports.report_day), så avstämningen går att räkna rätt:
-- saldo = räknat + leveranser från och med räkningsdagen − förbrukning från och med räkningsdagen.
--
-- ⚠️ RÄKNINGEN GÄLLER VID DAGENS BÖRJAN. Förbrukning som rapporteras FÖR räkningsdagen dras av
-- efteråt. Räknade man i själva verket EFTER dagens arbete blir saldot en dags förbrukning för lågt
-- — det ofarliga hållet: något för mycket beställt, aldrig en bil utan material. Samma regel för
-- leveranser: en leverans på räkningsdagen läggs på.
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
-- ADDITIV. Ingen befintlig tabell, policy eller funktion rörs. Ordningen mot koden är fri åt ETT håll:
-- ⚠️ SQL FÖRE KOD. Den nya koden läser tabellen i lagerberäkningen, och den läsningen failar stängt —
-- saknas tabellen dör HELA lagervyn och bristbanderollen med den (PostgREST 400 på saknad relation).
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
-- Bara select och insert: utan grant på update/delete finns det inget för en policy att släppa in.
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
-- 2. Ingen grant på update/delete. Frågan ska bara lista SELECT och INSERT:
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
