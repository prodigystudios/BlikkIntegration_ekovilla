-- Förkalkylens saknade ingång: hur fort vi blåser.
--
-- BAKGRUND
-- Efterkalkylen (20260828_crm_cost_settings.sql) räknar på UTFALL och behöver därför ingen
-- uppskattning: säckarna är rapporterade och tiden är rapporterad. Offerten har varken. Materialet
-- klarar sig ändå — offerten räknar redan fram planerat antal säckar per rad (lineItemSacks, samma
-- tal som står i arbetsbeskrivningen) och kostnadsartikeln bär priset per säck. Det som saknas är
-- ARBETSTIDEN, och den här filen lägger till underlaget för att uppskatta den.
--
-- VAD FILEN GÖR
-- En ny tabell (produktivitet per konstruktion och material) plus en kolumn på den befintliga
-- singletonen (teamstorlek). Ingen befintlig kolumn ändras, ingen policy rörs.
--
-- DEPLOY-ORDNING
-- Additiv, alltså valfri ordning mot koden — men det gäller BARA för att koden är skriven för att
-- tåla att filen inte är körd, och den försiktigheten var inte gratis:
--
--   * `getCalcSettings` läser med `select('*')` i stället för en kolumnlista. Med en namngiven
--     `team_size` hade PostgREST svarat med ett fel på okänd kolumn, felet bubblat genom
--     computeAfterCalculations, och EFTERKALKYLEN PÅ VARJE ARBETSORDER slutat fungera i drift tills
--     någon körde den här filen. Verifierat lokalt 2026-08-29 — kedjan är inte teoretisk.
--   * calc-settings-rutten fäller inte hela svaret när produktivitetstabellen saknas.
--
-- Utan filen körd: teamstorleken faller tillbaka på 2, rutnätet i inställningarna säger att
-- tabellen saknas, och offertens uppskattade TB2 uteblir. Allt annat fungerar.
--
-- ⚠️ Rör man den försiktigheten återvänder beroendet. Byt inte `select('*')` mot en kolumnlista.
--
-- Kör i Supabase SQL editor. Idempotent.
--
-- ⚠️ INGA EMOJI UTANFÖR BMP. Se 20260820_ops_segment_reports_sack_reporting.sql för vad ett
-- surrogatpar gör med editorns offsetmatematik. ⚠️ och ✅ är BMP och ofarliga.

-- ---------------------------------------------------------------------------
-- 1. crm_calc_settings.team_size — hur många som är på jobbet
-- ---------------------------------------------------------------------------
-- ⚠️ DEN HÄR KOLUMNEN ÄR FAKTOR 2, GJORD SYNLIG. Produktivitetstalen nedan är per TEAM (så mäts de:
-- "22 m³ i timmen" är vad ett lag hinner), medan timkostnaden är per PERSON (650 kr/man-timme).
-- Man-timmar = team-timmar × teamstorlek. Blandas de ihop blir varje TB2 dubbelt eller hälften utan
-- att något ser trasigt ut — talet är fortfarande ett rimligt tal. Lönsamhetsmodellens 1 300 kr/h
-- är just 2 × 650, och att den tvåan legat implicit i en formel är precis hur felet uppstår.
--
-- Default 2: modellens antagande, och det normala laget.
alter table public.crm_calc_settings
  add column if not exists team_size integer not null default 2 check (team_size >= 1);

-- ---------------------------------------------------------------------------
-- 2. crm_productivity_rates — m³ per timme och team
-- ---------------------------------------------------------------------------
-- En rad per kombination av konstruktion och material. Frånvaro betyder INGEN UPPSKATTNING, inte
-- noll: en kombination utan tal ska få offerten att säga "produktivitet saknas för Vägg × PAROC" i
-- stället för att gissa en tid.
--
-- ⚠️ TALEN SÄTTS I INSTÄLLNINGARNA, INTE I KODEN — och det är ett medvetet val. Lönsamhetsmodellens
-- PDF har tre olösta frågor som annars hade behövt avgöras här: snedtaket står med två motstridiga
-- rader (22 respektive 19 m³/h, etiketterna "Låglutande snedtak 15–30°" och "Snedtak <30°
-- (brantare)" motsäger varandra), PAROC saknas helt medan Rockwool har en full kolumn, och Isocell
-- har inga tal alls. Som DATA blir de tre frågorna ifyllnad i stället för affärsbeslut i en
-- migrering — och de går att rätta den dag utfallet säger något annat.
--
-- INGEN SEED, av samma skäl. Ett tal från februari som ingen valt är farligare än en tom ruta:
-- det tomma syns, det inaktuella gör det inte.
--
-- ⚠️ `construction` har en CHECK men `material` har det INTE. Skillnaden är avsiktlig och följer
-- systertabellerna: konstruktionsvokabulären är fem fasta värden som redan har en CHECK på
-- ops_segment_reports, medan materiallistan bor i koden (lib/domains/crm/materials.ts) och växer
-- när en ny leverantör tillkommer. En CHECK på material här hade blivit en femte kopia av listan
-- som ingen kommer ihåg att utöka.
create table if not exists public.crm_productivity_rates (
  construction    text not null,
  material        text not null,
  m3_per_hour     numeric(10, 2) not null check (m3_per_hour > 0),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id) on delete set null,
  primary key (construction, material)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_productivity_rates_construction_chk') then
    alter table public.crm_productivity_rates
      add constraint crm_productivity_rates_construction_chk
      check (construction in ('vagg', 'snedtak', 'vind', 'golv', 'mellanbjalklag'));
  end if;
end $$;

alter table public.crm_productivity_rates enable row level security;
grant select, insert, update, delete on public.crm_productivity_rates to authenticated;

-- Samma delning som kalkylinställningarna: läsning för CRM-användare, skrivning för admin.
drop policy if exists crm_productivity_rates_select on public.crm_productivity_rates;
create policy crm_productivity_rates_select on public.crm_productivity_rates
  for select to authenticated
  using (public.has_permission('crm.access'));

drop policy if exists crm_productivity_rates_insert on public.crm_productivity_rates;
create policy crm_productivity_rates_insert on public.crm_productivity_rates
  for insert to authenticated
  with check (public.has_permission('crm.admin'));

drop policy if exists crm_productivity_rates_update on public.crm_productivity_rates;
create policy crm_productivity_rates_update on public.crm_productivity_rates
  for update to authenticated
  using (public.has_permission('crm.admin'))
  with check (public.has_permission('crm.admin'));

-- DELETE finns för att kunna TÖMMA en ruta igen. Att ta bort raden är hur man säger "vi har ingen
-- uppskattning för den här kombinationen längre" — samma modell som materialens kostnadsartiklar.
drop policy if exists crm_productivity_rates_delete on public.crm_productivity_rates;
create policy crm_productivity_rates_delete on public.crm_productivity_rates
  for delete to authenticated
  using (public.has_permission('crm.admin'));

-- ---------------------------------------------------------------------------
-- Index — medvetet inga
-- ---------------------------------------------------------------------------
-- Tabellen är som mest fem konstruktioner gånger en handfull material och läses i sin helhet vid
-- varje offertberäkning. Primärnyckeln räcker.

-- ---------------------------------------------------------------------------
-- Verifiering (kör efter applicering)
-- ---------------------------------------------------------------------------
--
-- 1. Kolumnen och tabellen finns:
--
--      select column_name, data_type, column_default
--      from information_schema.columns
--      where table_schema = 'public' and table_name = 'crm_calc_settings'
--      order by ordinal_position;
--
--      select column_name, data_type, is_nullable
--      from information_schema.columns
--      where table_schema = 'public' and table_name = 'crm_productivity_rates'
--      order by ordinal_position;
--
--    Förväntat: crm_calc_settings har team_size integer default 2.
--
-- 2. Befintlig rad har fått teamstorleken utan att satsen rörts:
--
--      select labor_cost_per_hour, team_size from public.crm_calc_settings;
--
--    Förväntat: satsen oförändrad, team_size = 2.
--
-- 3. CHECK:arna nekar. Alla tre ska ge fel:
--
--      insert into public.crm_productivity_rates (construction, material, m3_per_hour)
--      values ('tak', 'EKOVILLA', 20);                      -- okänd konstruktion
--
--      insert into public.crm_productivity_rates (construction, material, m3_per_hour)
--      values ('vind', 'EKOVILLA', 0);                      -- noll timtakt
--
--      update public.crm_calc_settings set team_size = 0;   -- tomt lag
--
-- 4. Tabellen är TOM efter körning — det är meningen. Talen fylls i under
--    Inställningar -> Kalkyl, och en tom ruta betyder "ingen uppskattning":
--
--      select count(*) from public.crm_productivity_rates;
--
-- 5. RLS gatar skrivningen. Impersonera en sales-användare enligt metoden i
--    20260811_crm_work_order_rls_perf_probe.sql (rollbyte, fråga och avläsning i EN sats):
--
--      insert into public.crm_productivity_rates (construction, material, m3_per_hour)
--      values ('vind', 'EKOVILLA', 22);
--
--    Förväntat: nekas för sales/konsult, går igenom för admin.
--    ⚠️ En blockerad UPDATE svarar `error: null` och noll rader — räkna raderna, lita inte på att
--    anropet "gick igenom".
