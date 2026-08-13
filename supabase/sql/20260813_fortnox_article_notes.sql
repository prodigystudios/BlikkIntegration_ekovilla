-- Artikelns beskrivning (Fortnox `Note`) i artikelcachen.
--
-- PROBLEMET DEN LÖSER: säljaren ser inte vad en artikel egentligen innehåller när den väljs i
-- offerten. Beskrivningen finns i Fortnox och visas redan på CRM:s artikelsida — men den sidan
-- hämtar EN artikel live (`GET /articles/{nr}`). Offertens artikelväljare läser cachen, och cachen
-- fylls av `GET /articles` (listan) som INTE returnerar `Note`. Vid mätning 2026-08-13 hade 0 av
-- 289 cachade artiklar fältet. Samma lucka som kundernas `Type` (brist 1) och artiklarnas
-- `HouseworkType` (brist 4): fältet finns bara på enskild-GET.
--
-- VARFÖR TVÅ KOLUMNER. `note_synced_at` skiljer "artikeln har ingen beskrivning" från "vi har
-- aldrig frågat". Utan den går det inte att veta vilka artiklar som återstår, och synken skulle
-- fråga om alla 289 varje gång — ~100 sekunder per körning i stället för bara första gången.
--
-- BESKRIVNINGEN ÄR INTERN. Den visas för säljaren i offertformuläret och skrivs aldrig in på
-- offertraden, så den kan inte nå Fortnox. Radens `Description` kommer från `article_name` och
-- radtexten från `line_note` — två fält som inget av detta rör.
--
-- ⚠️ DEPLOY-ORDNING: KÖR SQL:EN FÖRE KODEN.
--
-- Migreringen är additiv i den meningen att inget befintligt ändras, men koden är det INTE:
-- `ARTICLE_CACHE_SELECT` i lib/domains/fortnox/articles.ts begär `note`, och PostgREST svarar 400
-- ("column ... does not exist") på ett select mot en kolumn som saknas — den returnerar inte null.
-- Deployas koden först slutar därför ALLA artikelläsningar att fungera: offertens artikelväljare
-- får inga träffar och artikelsidan (server-renderad) kraschar helt.
--
-- Additiv i schemat ≠ ofarlig ordning. Kör i Supabase SQL editor. Idempotent.

alter table public.fortnox_articles_cache
  add column if not exists note           text,
  add column if not exists note_synced_at timestamptz;

-- Synken frågar efter artiklar som ännu inte har hämtats (`note_synced_at is null`). Partiellt
-- index: efter första fulla körningen är mängden tom eller mycket liten, och då ska frågan inte
-- behöva läsa hela tabellen.
create index if not exists fortnox_articles_cache_note_pending_idx
  on public.fortnox_articles_cache (article_number)
  where note_synced_at is null;

-- ── Verifiering (kör efter applicering) ──────────────────────────────────────
--
-- 1. Kolumnerna finns och är nullbara.
--
--      select column_name, data_type, is_nullable
--      from information_schema.columns
--      where table_schema = 'public' and table_name = 'fortnox_articles_cache'
--        and column_name in ('note', 'note_synced_at');
--
-- 2. Före första synken: alla artiklar väntar på hämtning.
--
--      select count(*) filter (where note_synced_at is null) as vantar,
--             count(*) filter (where note_synced_at is not null) as hamtade,
--             count(*) filter (where coalesce(btrim(note), '') <> '') as med_beskrivning
--      from public.fortnox_articles_cache;
--
-- 3. Efter en synk ska `vantar` vara 0. Är `med_beskrivning` då oväntat lågt ligger texten i ett
--    annat Fortnox-fält än `Note` — kontrollera mot en artikel i CRM:s artikelflik innan något
--    byggs om.
