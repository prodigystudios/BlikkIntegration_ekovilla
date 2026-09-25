-- KMA-planer på arbetsordern — Kvalitet, Miljö och Arbetsmiljö, skapade ur ordern på begäran.
--
-- VARFÖR
-- Beställare (byggbolag, fastighetsbolag) begär en KMA-plan vid projektstart. Den har gjorts för
-- hand i Word: huvuddokument plus åtta bilagor, där projekt, kund, ordernummer, fastighet,
-- organisation och besättning skrivs in varje gång. Nu skapas den från arbetsordern, förifylld,
-- och justeras i en dialog innan PDF:en tas ut (lib/domains/crm/kmaPlans/).
--
-- Entreprenören i planen är ALLTID Isoleringslandslaget AB, 559022-5800 (Williams beslut
-- 2026-09-24) — inte Ekovilla, som resten av appen känner. Bolagsblocket bor i koden, inte här.
--
-- EN RAD = EN REVISION. Planen går till kunden, så det kunden fick måste gå att ta fram igen:
--   * `input`    — formulärets värden. Läses vid "Revidera" (nästa revision börjar där den förra
--                  slutade) och som förifyllnad av organisationsblocket på nästa order.
--   * `document` — HELA dokumentet som renderas, inklusive de fasta policytexterna i bilaga 2-5.
--                  PDF-routen renderar ur den här kolumnen, aldrig ur dagens mall i koden. Ändras
--                  en policytext senare påverkar det bara NYA planer; en omladdning av en gammal
--                  plan visar samma innehåll som kunden fick.
--
-- ⚠️ VAD SOM MEDVETET INTE FINNS HÄR — läs innan du "kompletterar" tabellen
--
--   * INGEN UPDATE OCH INGEN DELETE — varken grant eller policy. Ett dokument som gått till kund
--     skrivs aldrig om under läsarens fötter; ett fel rättas med en ny revision. Både-eller-ingen-
--     regeln gäller (grant utan policy är lika fel som policy utan grant — repot brändes av det i
--     20260629_crm_work_order_comments_update_grant.sql). En plan på fel order tas bort av admin i
--     SQL-editorn, inte från appen.
--
--   * INGA PDF-BYTES OCH INGEN FILLAGRING. Bytesen hade hamnat i den delade bucketen, och
--     /api/storage/* har ingen behörighetsgrind alls (vilken inloggad som helst kan lista och ladda
--     ned). Planen bär personalens namn, telefon och e-post. Innehållet garanteras i stället av att
--     `document` sparas. pdf-lib ger aldrig byte-identiska filer mellan två renderingar
--     (slumpade resursnycklar) — text och struktur är det som är garanterat, och ett fryst
--     fixturtest i tests/crm/kmaPdf.test.ts vaktar det. Behövs exakta bytes någon gång är det en
--     additiv bytea-kolumn, fortfarande under RLS.
--
--   * INGEN BESÄTTNINGSGREN (is_user_on_work_order). I PR 1 är planen ett kontorsdokument. Behöver
--     fältet se den senare är det en additiv gren i select-policyn.
--
--   * INGEN NY BEHÖRIGHETSNYCKEL. Läsning = crm.workorder.read (samma som följesedeln och
--     orderbekräftelsen: sälj, admin, konsult, ekonomi). Skapande = crm.workorder.write (sälj,
--     admin — samma som etapperna och framdriftens kontorsgren).
--
-- ⚠️ `document` byggs av RUTTEN ur validerad indata och kodens mall. En direkt PostgREST-insert
-- förbi rutten kan skriva vad som helst i kolumnen — men bara den som har crm.workorder.write, som
-- redan kan skriva vad som helst i dialogen. PDF-routen validerar dokumentets form innan den
-- renderar, så ett trasigt dokument ger ett felmeddelande och inte en halv PDF.
--
-- DEPLOY-ORDNING: KÖR DEN HÄR FILEN FÖRE KODEN.
-- Helt additiv — ny tabell, inga ändringar på befintliga objekt, ingen befintlig policy rörs — så
-- den kan köras när som helst. Men den måste ligga före koden: utan tabellen svarar KMA-kortet på
-- arbetsordern med ett laddfel och "Skapa KMA-plan" med 500.
--
-- Kör i Supabase SQL editor. Idempotent (kör den två gånger innan du litar på påståendet).
--
-- ⚠️ INGA EMOJI UTANFÖR BMP I DEN HÄR FILEN — se tests/planning/sqlNoAstralChars.test.ts.

-- ---------------------------------------------------------------------------
-- Tabell
-- ---------------------------------------------------------------------------

create table if not exists public.crm_work_order_kma_plans (
  id              uuid primary key default gen_random_uuid(),

  -- Sätts ur RUTT-PARAMETERN, aldrig ur kroppen. Samma regel som framdriften och säckboken.
  work_order_id   uuid not null references public.crm_work_orders(id) on delete cascade,

  -- 1, 2, 3 ... per order. Visas som "Revision N" — "Version 2.0" i planhuvudet är MALLENS version
  -- och står fast (Williams beslut 2026-09-24).
  --
  -- Räknas fram i rutten som max + 1. Två som sparar samtidigt krockar på det unika indexet nedan,
  -- och rutten svarar 409 i stället för att någon tyst får samma nummer.
  revision        integer not null,

  -- Utgivningsdatumet som står i dokumentet (svensk kalenderdag, stockholmTodayISO).
  issued_on       date not null,

  -- Snapshot till listan på kortet, så den inte behöver läsa hela jsonb-dokumentet.
  project_name    text not null,

  input           jsonb not null,
  document        jsonb not null,

  -- on delete set null: en avslutad anställning ska inte hindra radering av profilen, och planen
  -- ska överleva. `created_by_name` bär visningen vidare.
  created_by      uuid references public.profiles(id) on delete set null,

  -- SNAPSHOT, INTE EN JOIN: profiles är self-read-only, så en join mot profiles!created_by ger null
  -- för alla utom en själv. Samma mönster som crm_work_order_progress_reports.created_by_name.
  created_by_name text not null,

  created_at      timestamptz not null default now(),

  constraint crm_wo_kma_revision_chk check (revision >= 1),
  constraint crm_wo_kma_project_name_chk check (btrim(project_name) <> ''),
  constraint crm_wo_kma_created_by_name_chk check (btrim(created_by_name) <> ''),
  constraint crm_wo_kma_input_chk check (jsonb_typeof(input) = 'object'),
  constraint crm_wo_kma_document_chk check (jsonb_typeof(document) = 'object'),
  constraint crm_wo_kma_revision_uniq unique (work_order_id, revision)
);

-- ---------------------------------------------------------------------------
-- Index
-- ---------------------------------------------------------------------------

-- Listfrågan (where work_order_id = $1 order by revision desc) och "ordens senaste plan" går på
-- det unika indexet ovan — inget eget behövs.

-- "Min senaste plan" (förifyllnaden av organisationsblocket på en ny order).
create index if not exists crm_wo_kma_created_by_idx
  on public.crm_work_order_kma_plans (created_by, created_at desc);

-- "Bolagets senaste plan" (reserven när man själv aldrig skapat en).
create index if not exists crm_wo_kma_created_at_idx
  on public.crm_work_order_kma_plans (created_at desc);

alter table public.crm_work_order_kma_plans enable row level security;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- En radpolicy gör INGENTING utan tabellprivilegiet. Bara SELECT och INSERT — se huvudet.
grant select, insert on public.crm_work_order_kma_plans to authenticated;

-- ---------------------------------------------------------------------------
-- Policyer
-- ---------------------------------------------------------------------------

-- SELECT: den som har läsnyckeln för arbetsordrar. `created_by = auth.uid()` står först så att den
-- som just skapat en plan alltid kan läsa tillbaka den — insertens `.select()` hade annars kunnat
-- ge 0 rader och rutten sett ut att ha misslyckats fast raden ligger där.
drop policy if exists crm_wo_kma_select on public.crm_work_order_kma_plans;
create policy crm_wo_kma_select
  on public.crm_work_order_kma_plans
  for select
  to authenticated
  using (
    created_by = auth.uid()
    or public.has_permission('crm.workorder.read')
  );

-- INSERT: alltid som sig själv, och bara med skrivnyckeln. `work_order_id` sätts ur
-- rutt-parametern; predikatet här är ANDRA spärren om rutten skulle sluta kontrollera.
drop policy if exists crm_wo_kma_insert on public.crm_work_order_kma_plans;
create policy crm_wo_kma_insert
  on public.crm_work_order_kma_plans
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.has_permission('crm.workorder.write')
  );

-- ---------------------------------------------------------------------------
-- Verifiering (kör efter applicering)
-- ---------------------------------------------------------------------------
--
-- 1. Kolumnerna, med rätt nullbarhet. Förväntat nullbart: BARA created_by.
--
--      select column_name, data_type, is_nullable
--      from information_schema.columns
--      where table_schema = 'public' and table_name = 'crm_work_order_kma_plans'
--      order by ordinal_position;
--
-- 2. Exakt två policyer (select + insert), RLS på:
--
--      select policyname, cmd from pg_policies
--      where schemaname = 'public' and tablename = 'crm_work_order_kma_plans'
--      order by cmd, policyname;
--
--      select relrowsecurity from pg_class where oid = 'public.crm_work_order_kma_plans'::regclass;
--
-- 3. Grants ska vara exakt INSERT och SELECT för authenticated — inget UPDATE, inget DELETE:
--
--      select privilege_type from information_schema.role_table_grants
--      where table_schema = 'public' and table_name = 'crm_work_order_kma_plans'
--        and grantee = 'authenticated'
--      order by 1;
--
-- 4. Samma revision två gånger på samma order ska NEKAS (23505, crm_wo_kma_revision_uniq), och en
--    tom projekttext likaså (crm_wo_kma_project_name_chk). Rulla tillbaka:
--
--      begin;
--      insert into public.crm_work_order_kma_plans
--        (work_order_id, revision, issued_on, project_name, input, document, created_by_name)
--      values ('<work_order_id>', 1, current_date, 'Test', '{}', '{}', 'Test');
--      insert into public.crm_work_order_kma_plans
--        (work_order_id, revision, issued_on, project_name, input, document, created_by_name)
--      values ('<work_order_id>', 1, current_date, 'Test', '{}', '{}', 'Test');
--      rollback;
--
-- 5. En installatör (member, utan crm.workorder.read) ska se NOLL rader. Impersonera enligt
--    metoden i 20260811_crm_work_order_rls_perf_probe.sql — rollbytet, frågan och avläsningen MÅSTE
--    ligga i EN sats:
--
--      select count(*) from public.crm_work_order_kma_plans;
