-- Säckrapportering från fältet — huvudboken får sina saknade kolumner och en dörr för besättningen.
--
-- BAKGRUND
-- ops_segment_reports (20260611_ops_segment_reports.sql) ÄR redan huvudboken för blåsta säckar.
-- Läsvägen finns (reportedSacksByWorkOrder i lib/domains/planning/reports.ts betjänar både
-- planeringstavlan och arbetsorderns snabböversikt) och depåförbrukningen härleds ur den
-- (deriveConsumptionRows i lib/domains/planning/depotStock.ts). Tabellen har aldrig fått en
-- SKRIVARE: ingen rutt anropar createSegmentReport, så den står tom och båda summeringarna ger 0.
--
-- Det som faktiskt rapporteras i drift i dag når inte hit:
--   * Egenkontrollens strukturerade skrivning är villkorad på blikkProjectId
--     (app/egenkontroll/page.tsx) — en CRM-order får bara fritextkommentaren "Antal säckar: N".
--   * planning_project_meta.actual_bags_used är en UPSERT per projekt: andra besöket skriver ÖVER
--     det första, så legacy-vägen kan inte ens representera två besök.
--
-- VAD DEN HÄR FILEN GÖR
-- Fyra additiva kolumner + två additiva RLS-policys. Inga befintliga objekt ändras, ingen befintlig
-- policy rörs, ingen rad skrivs om. Efter den här filen kan en installatör skriva i boken; VAD som
-- skrivs bestäms av koden som kommer efter (dörr 1 = egenkontrollen, dörr 2 = delrapport i fältvyn).
--
-- MODELLEN — läs den här innan du rör kolumnerna, annars ser `kind` ut som en onödig flagga.
-- En rad per rapporterad dag, aldrig subtraktion någonstans. Regeln är EN mening:
--
--     FINNS EN `final` ÄR DEN JOBBETS SANNING; ANNARS SUMMAN AV `partial`.
--
--   Besök 1   partial  vind  30     boken:  30
--   Besök 2   partial  vind  25     boken:  55
--   Besök 3   blåser 36 till, egenkontroll skrivs på TOTALEN
--             final    vind  91     boken:  91
--
-- 55 delrapporterat + 36 sista besöket = 91. Naiv summering hade gett 146 — det är den summan
-- regeln finns för att omöjliggöra. Differensmodellen (delrapporterna dras från egenkontrollen) är
-- prövad och förkastad: `check (sacks_blown >= 0)` nedan golvar en negativ differens till 0, så en
-- nedåtkorrigering hade varit omöjlig och boken stått kvar för högt. Föreslå den inte igen.
--
-- Regeln implementeras EN gång som ren funktion i lib/domains/planning och anropas från BÅDA
-- summeringsställena — reportedSacksByWorkOrder och deriveConsumptionRows. Glöms depån drar den
-- partial + final och dubbeldebiterar lagret.
--
-- DEPLOY-ORDNING
-- Additiv, så den kan köras när som helst FÖRE koden — dagens kod känner inte till kolumnerna och
-- påverkas inte. Men den MÅSTE ligga före: utan kolumnerna dör varje insert från dörr 1 och 2 på
-- "column does not exist", och dörr 1 sitter mitt i installatörens egenkontrollsparning.
--
-- Kör i Supabase SQL editor. Idempotent (kör den två gånger innan du litar på påståendet).
--
-- ⚠️ INGA EMOJI UTANFÖR BMP I DEN HÄR FILEN — BELAGT 2026-08-20, INTE EN STILREGEL.
-- Den här filen skrevs först med ⚠️ (U+1F9E8), som ligger utanför BMP och alltså är ett
-- SURROGATPAR i UTF-16. Supabase SQL-editor delar upp skriptet i satser med offsetmatematik som
-- inte klarar det: offseten driver, en `--`-kommentar kapas mitt i raden, och resten av raden blir
-- en körbar sats. Utfallet blev att verifieringsfrågan längst ner kördes utan sin from-rad
-- (ERROR 42703: column "column_name" does not exist) — och eftersom hela skriptet körs i EN
-- transaktion rullades HELA migreringen tillbaka utan att en enda kolumn lades till. Felet pekade
-- alltså på en rad som inte ens var körbar, medan orsaken låg 200 rader bort.
--
-- ⚠️ och ✅ är däremot ofarliga: de ligger i BMP och finns i 21 migreringar som körts skarpt.
-- Regeln är BMP, inte "inga emoji". Kolla en ny symbol innan du använder den.

-- ---------------------------------------------------------------------------
-- 1. kind — partial | final
-- ---------------------------------------------------------------------------
-- `not null default 'partial'` backfillar eventuella befintliga rader till dagens beteende: de
-- summeras, precis som de gör i dag. Det är rätt val även om tabellen är tom — defaulten är den
-- SÄKRA sidan, en rad som råkar sakna kind ska räknas med, inte tysta ut alla andra rader på jobbet.
--
-- ⚠️ FLERA final-RADER PER ARBETSORDER ÄR NORMALT. Egenkontrollen skriver en final-rad PER ETAPPRAD
-- (en per placering/material), så det finns medvetet INGET unikt index på (work_order_id) where
-- kind = 'final'. "Finns en final" i regeln ovan betyder "finns minst en" — och sanningen är då
-- SUMMAN AV ALLA final-rader, inte den senaste.
--
-- Ersättningen mellan två egenkontroller nycklas därför på ARBETSORDERN och är MÄNGDVIS: en ny
-- egenkontroll tar bort orderns tidigare final-rader och skriver sin egen uppsättning. Partials
-- ligger kvar (de ska synas som ersatta i spåret, inte försvinna).
alter table public.ops_segment_reports
  add column if not exists kind text not null default 'partial';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ops_segment_reports_kind_chk') then
    alter table public.ops_segment_reports
      add constraint ops_segment_reports_kind_chk
      check (kind in ('partial', 'final'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. material — vilket material som faktiskt gick åt
-- ---------------------------------------------------------------------------
-- Löser en dokumenterad brist i depotStock.ts: materialShortFromLineItems returnerar bara FÖRSTA
-- igenkända materialet på ordern, så ett jobb med två material debiterar allt på det ena. Med
-- materialet på rapportraden debiteras det som blåstes.
--
-- ⚠️ INGEN CHECK, med flit — men identiteten är HÅRD. Värdet är en `short` ur MATERIAL_SHORTS
-- (EKOVILLA, KNAUF SUPAFIL, …) och måste stämma TECKEN FÖR TECKEN med ops_depot_deliveries.material,
-- annars möts leverans och förbrukning aldrig i computeDepotBalances och saldot står kvar för högt
-- utan att något felar. Systertabellen har av samma skäl ingen CHECK: vokabulären bor i koden
-- (lib/domains/crm/materials.ts) och valideras i Zod på ETT ställe (app/api/crm/planering/_lib.ts).
-- En CHECK här hade blivit en fjärde kopia av listan som ingen kommer ihåg att utöka när en ny
-- leverantör läggs till.
--
-- Nullbar: egenkontrollen kan mappa en etapprad vars material inte går att lösa ur artikelnamnet.
-- Då är null rätt svar — raden räknas fortfarande i huvudboken (säckarna blåstes ju), men faller
-- ur depåavdraget i stället för att debitera fel material.
--
-- ⚠️ Egenkontrollens `materialUsed` är en NYCKEL i MATERIALS ("Ekovilla Cellulosa Lösull CE
-- ETA-09/0081"), INTE en short. Dörr 1 måste mappa nyckel → short innan insert. Skrivs nyckeln rakt
-- in hamnar den här som ett material depån aldrig sett en leverans av.
alter table public.ops_segment_reports
  add column if not exists material text;

-- ---------------------------------------------------------------------------
-- 3. construction — VAR det blåstes
-- ---------------------------------------------------------------------------
-- Samma fält och samma vokabulär som offertradens `construction`. Avsiktligt inte en egen lista:
-- installatören LÄSER redan de här orden i arbetsbeskrivningen (måttblocket skriver
-- "Vägg – 100 m² × 200 mm @ 45 kg/m³ – 53 säck"), och två vokabulärer för samma sak i samma vy är
-- hur man bygger in en felöversättning.
--
-- Fem värden: vagg | snedtak | vind är i drift, golv | mellanbjalklag är nya här.
--
-- ⚠️ CHECK:en nedan avvisar TOMMA STRÄNGEN. Offertraden lagrar '' för "inte satt"
-- (createEmptyLineItem), så koden som mappar en etapprad till en rapportrad MÅSTE normalisera
-- '' → null. Görs det inte dör insert:en — och för dörr 1 sitter den insert:en mitt i
-- installatörens egenkontrollsparning. Att constrainten är hård är avsikten: det är billigare att
-- upptäcka en femte stavning här än att läsa fel i depåsaldot i ett halvår.
--
-- Nullbar: den PLANERADE sidan är en gissning (inferConstructionFromArticle, regex på
-- Fortnox-artikelnamnet) och det finns ingen mänsklig väljare på offertraden i dag. Rader
-- gissningen inte klarade får null och redovisas som "Ospecificerad" — de räknas fullt ut i
-- totalen, det är bara placeringen som saknas.
alter table public.ops_segment_reports
  add column if not exists construction text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ops_segment_reports_construction_chk') then
    alter table public.ops_segment_reports
      add constraint ops_segment_reports_construction_chk
      check (construction is null or construction in ('vagg', 'snedtak', 'vind', 'golv', 'mellanbjalklag'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. created_by_name — VEM som rapporterade
-- ---------------------------------------------------------------------------
-- Utan snapshot blir "vem" TOMT i orderns säckrapportkort. `profiles` är self-read-only
-- (profiles_select_self i auth_roles_setup.sql är enda SELECT-policyn), så en PostgREST-join
-- profiles!created_by ger null för alla utom en själv.
--
-- ⚠️ Och husets vanliga fix FUNGERAR INTE här: att slå upp namnet ur
-- /api/crm/work-orders/assignees går bet därför att listAssignableCrmUsers filtrerar
-- role in ('sales','admin','konsult') — installatörer saknas i den listan, alltså exakt de som
-- rapporterar. Samma mönster som crm_work_order_files.created_by_name, app_tickets.reporter_name
-- och ops_truck_crew.member_name, och av precis samma skäl.
--
-- Passar en append-only huvudbok bättre än en join ändå: namnet fryses som det var när rapporten
-- skrevs, så en namnändring eller en avslutad anställning inte skriver om historiken.
--
-- NULLBAR, till skillnad från crm_work_order_files.created_by_name (not null). Kolumnen läggs på en
-- BEFINTLIG tabell och kan inte sättas not null utan att först backfilla rader vi inte kan läsa
-- namnen till. Rutterna sätter den alltid; visningen faller tillbaka på "Okänd".
alter table public.ops_segment_reports
  add column if not exists created_by_name text;

-- ---------------------------------------------------------------------------
-- Index — medvetet inga nya
-- ---------------------------------------------------------------------------
-- ops_segment_reports_work_order_idx (work_order_id) finns sedan 20260611 och bär båda de nya
-- läsvägarna: supersede-summeringen (`in (work_order_ids)`) och säckrapportkortet på ordern. Ett
-- jobb har en handfull rapportrader, så sorteringen på created_at och partitioneringen på kind
-- sker på en trivial mängd — ett (work_order_id, created_at desc) hade bara lagt skrivkostnad på en
-- append-only-tabell utan att spara en mätbar millisekund.

-- ---------------------------------------------------------------------------
-- RLS — två additiva policyer för besättningen
-- ---------------------------------------------------------------------------
-- Problemet: installatörer (role = member) saknar BÅDE planning.schedule.read och .write —
-- 20260611_planning_permissions.sql delar ut dem till admin/sales (read+write) och konsult (read),
-- member finns inte i seeden alls. De fyra befintliga policyerna kräver exakt de nycklarna, så en
-- installatör kan varken skriva en rapport eller se den hen nyss skrev. Skrivvägen kan därför
-- omöjligt ligga på planeringstavlan.
--
-- Lösningen är samma som fältcutoverns: härled "är den här personen på det här jobbet" ur
-- planeringens besättningstabeller via public.is_user_on_work_order(uuid, uuid)
-- (20260810_crm_work_order_crew_access.sql — definieras INTE om här). PostgreSQL OR-kombinerar
-- permissiva policyer, så inget som fungerar i dag ändras. Members får fortfarande INGA
-- planning.*-nycklar — det här är en smal, datahärledd rättighet på deras eget jobb.
--
-- ⚠️ VARFÖR RÄTTIGHETEN INTE ÄR FÖR VID: get_my_crm_jobs bygger fältfeeden ur ops_segments med
-- generate_series(start_day, end_day), gated på samma is_user_on_work_order. EN DAG SOM INGET
-- SEGMENT TÄCKER EXISTERAR INTE I /mina-jobb — installatören kan varken öppna jobbet eller
-- tidrapportera på det. Att hen står här och rapporterar BEVISAR alltså att ett täckande segment
-- finns och att hen är besättning på det. Återbesök planeras alltid, just för att planeringen är
-- det tidrapporten hänger på.
--
-- Tabellgrants (select, insert, update, delete till authenticated) finns sedan 20260611 — en policy
-- utan grant gör ingenting alls, men här behövs inget nytt grant.

-- SELECT: se rapporterna på ditt eget jobb. Utan den här kan installatören skriva en rad och sedan
-- inte läsa tillbaka den — insert:ens `.select()` returnerar 0 rader och rutten ser ut att ha
-- misslyckats fast raden ligger där. Hela överlämningen till nästa team bygger dessutom på att
-- besättningen ser vad föregående besök rapporterade.
drop policy if exists ops_segment_reports_select_crew on public.ops_segment_reports;
create policy ops_segment_reports_select_crew
  on public.ops_segment_reports
  for select
  to authenticated
  using (public.is_user_on_work_order(auth.uid(), work_order_id));

-- INSERT: alltid som sig själv, alltid på ett jobb man är besättning på. Kolumnjämförelsen står
-- först — den är gratis och slipper funktionsanropet för den vanligaste avvisningen (samma
-- grenordning som crm_wo_files_insert och 20260811_time_entries_rls.sql).
--
-- work_order_id är INTE något klienten får hitta på: rutten slår upp det ur segmentet server-side.
-- Predikatet här är andra spärren — en handskriven POST med någon annans work_order_id avvisas av
-- databasen även om rutten skulle sluta kontrollera.
drop policy if exists ops_segment_reports_insert_crew on public.ops_segment_reports;
create policy ops_segment_reports_insert_crew
  on public.ops_segment_reports
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.is_user_on_work_order(auth.uid(), work_order_id)
  );

-- INGEN UPDATE- OCH INGEN DELETE-POLICY FÖR BESÄTTNINGEN, med flit.
--
-- Huvudboken är append-only från fältet: en felskriven delrapport rättas med en ny rad, inte genom
-- att historiken skrivs om. Spåret på ordern är hela poängen med tabellen.
--
-- Mängdersättningen i dörr 1 (ny egenkontroll tar bort orderns tidigare final-rader) är därför inte
-- en användaråtgärd utan ett serverstyrt steg som körs ELEVERAT i rutten, efter att rutten redan
-- avgjort att användaren får spara egenkontrollen för ordern. Skulle det någon gång behöva bli en
-- radpolicy i stället är det en egen liten fil — och den ska nycklas på kind = 'final', aldrig ge
-- besättningen delete på partials.
--
-- Kontorets befintliga ops_segment_reports_update / _delete (planning.schedule.write) rörs inte.

-- ---------------------------------------------------------------------------
-- Verifiering (kör efter applicering)
-- ---------------------------------------------------------------------------
--
-- 1. Fyra nya kolumner, rätt defaultar och nullbarhet:
--
--      select column_name, data_type, is_nullable, column_default
--      from information_schema.columns
--      where table_schema = 'public' and table_name = 'ops_segment_reports'
--      order by ordinal_position;
--
--    Förväntat: kind text NO 'partial'::text · material text YES null ·
--               construction text YES null · created_by_name text YES null
--
-- 2. Sex policyer — de fyra befintliga PLUS de två nya. Ser du bara två har du ersatt i stället för
--    att lägga till, och kontoret har tappat tavlan:
--
--      select policyname, cmd from pg_policies
--      where schemaname = 'public' and tablename = 'ops_segment_reports'
--      order by cmd, policyname;
--
-- 3. CHECK:arna ska neka. Båda ska ge fel (den andra är '' -fällan från avsnitt 3):
--
--      insert into public.ops_segment_reports (segment_id, work_order_id, report_day, sacks_blown, kind)
--      values ('<segment_id>', '<work_order_id>', current_date, 1, 'slutlig');
--
--      insert into public.ops_segment_reports (segment_id, work_order_id, report_day, sacks_blown, construction)
--      values ('<segment_id>', '<work_order_id>', current_date, 1, '');
--
--    Och de fem giltiga ska gå igenom (rulla tillbaka efteråt):
--
--      begin;
--      insert into public.ops_segment_reports (segment_id, work_order_id, report_day, sacks_blown, construction)
--      select '<segment_id>', '<work_order_id>', current_date, 1, c
--      from unnest(array['vagg','snedtak','vind','golv','mellanbjalklag']) c;
--      rollback;
--
-- 4. Hjälpfunktionen som båda besättningspolicyerna vilar på ska svara. true för besättningen på
--    jobbet, false för alla andra (samma punktprov som 20260810 och 20260815):
--
--      select p.full_name, public.is_user_on_work_order(p.id, '<work_order_id>') as pa_jobbet
--      from public.profiles p
--      order by pa_jobbet desc, p.full_name;
--
-- 5. Installatören ska se sitt eget jobbs rapporter och INGA andras. Impersonera enligt metoden i
--    20260811_crm_work_order_rls_perf_probe.sql — rollbytet, frågan och avläsningen MÅSTE ligga i
--    EN sats:
--
--      select work_order_id, count(*) from public.ops_segment_reports group by 1;
--
--    Kontoret ska se alla arbetsordrar, installatören bara dem hen är besättning på.
--
-- 6. Befintliga rader (om några) ska ha blivit 'partial' och alltså räknas precis som förut:
--
--      select kind, count(*) from public.ops_segment_reports group by 1;
