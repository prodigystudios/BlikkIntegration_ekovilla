-- Framdriftsrapportering från fältet — meter landgång, antal brandmattor, "Hus A".
--
-- VARFÖR
-- Fältet kan i dag bara rapportera SÄCKAR. Ett jobb som bygger landgångar har ingen väg att säga
-- "vi byggde 45 m i dag, på Hus A": kontoret får antingen prosa i en kommentar eller ingenting.
-- Orderns antals- och meterrader (`pricing_mode: 'item'` — landgång, brandmatta, sarg runt lucka)
-- bär ett PLANERAT antal och en enhet ur artikelregistret, men ingenting rapporteras mot dem.
--
-- Den planerade sidan är dessutom PÅLITLIG här, till skillnad från säckarnas. `quantity` skrivs av
-- säljaren och är det som faktureras, medan säckradens `construction` är en regexgissning på
-- artikelnamnet. "45 av 120 m" är alltså ett exakt tal från dag ett.
--
-- ⚠️ VARFÖR EN EGEN TABELL OCH INTE TVÅ KOLUMNER I ops_segment_reports
-- `sacks_blown` summeras BLINT av fyra läsare:
--   * reportedSacksByWorkOrder  → orderns snabböversikt ("Säckar (rapporterat)")
--   * sackTotalsForWorkOrders   → planeringstavlans säckbadge
--   * deriveConsumptionRows     → depåsaldot (lib/domains/planning/depotStock.ts)
--   * calculateAfterCalculation → materialkostnaden i TB1/TB2
-- En meterrad i den tabellen blir tysta säckar i depån och fel materialkostnad i marginalen, och
-- felet syns inte som ett fel utan bara som ett för högt tal. Varje läsare hade behövt lära sig
-- filtrera, och varje framtida läsare hade behövt minnas det. Med en egen tabell är felmoden
-- OMÖJLIG i stället för bevakad.
--
-- ⚠️ VAD SOM MEDVETET INTE FINNS HÄR — läs innan du "kompletterar" tabellen mot sin syskontabell
--
--   * INGEN `kind` OCH INGEN SUPERSEDE-REGEL. Säckboken har den för att egenkontrollen är jobbets
--     fulla sanning och måste SLÄCKA delrapporterna (30 + 25 delrapporterat + 91 på egenkontrollen
--     är 91, inte 146). Egenkontrollen frågar aldrig om landgång, så det finns ingen final som
--     ersätter något här. Raderna summeras rakt, och det är hela regeln.
--
--   * INGET `segment_id`. Säckraden bär segmentet för att DEPÅN ska veta vilken bils lager som ska
--     debiteras. Framdrift debiterar ingen depå. Utan kolumnen slipper rutten både den eleverade
--     uppslagningen mot ops_segments (som besättningen inte får läsa) och säckruttens 400-svar
--     "jobbet har ingen planerad dag att koppla rapporten till" — en rapport som ÄR sann ska inte
--     avvisas för att planeringen hunnit ändras. Behöver någon dag-till-segment senare går den att
--     lösa vid läsning ur `report_day`, utan att en kolumn står och blir fel i mellantiden.
--
--   * INGEN UPDATE — varken grant eller policy. En felskriven rad tas bort och skrivs om, aldrig
--     skrivs den om under läsarens fötter. Både-eller-ingen-regeln gäller: ett grant utan policy är
--     lika fel som en policy utan grant, och repot brändes av exakt det en gång
--     (20260629_crm_work_order_comments_update_grant.sql — varje kommentarsredigering gav 500 i
--     drift). Vill man ha UPDATE senare är det en egen liten fil med BÅDA.
--
-- DEPLOY-ORDNING: KÖR DEN HÄR FILEN FÖRE KODEN.
-- Helt additiv — ny tabell, inga ändringar på befintliga objekt, ingen befintlig policy rörs, ingen
-- rad skrivs om — så den kan köras när som helst. Men den måste ligga före koden: utan tabellen
-- svarar både listningen och sparningen "relation does not exist", och felet möter installatören
-- först efter att hen skrivit in dagens siffra.
--
-- Kör i Supabase SQL editor. Idempotent (kör den två gånger innan du litar på påståendet).
--
-- ⚠️ INGA EMOJI UTANFÖR BMP I DEN HÄR FILEN. Ett tecken utanför BMP är ett surrogatpar i UTF-16,
-- och bryts paret på väg in i SQL-editorn kapas en `--`-kommentar mitt i raden — resten av raden
-- blir en körbar sats och HELA migreringen rullas tillbaka, med ett felmeddelande som pekar på en
-- rad där ingenting ser konstigt ut. Belagt 2026-08-20. ⚠️, ✅ och ⛔ ligger i BMP och är ofarliga;
-- tests/planning/sqlNoAstralChars.test.ts är den mekaniska vakten.

-- ---------------------------------------------------------------------------
-- Tabell
-- ---------------------------------------------------------------------------

create table if not exists public.crm_work_order_progress_reports (
  id              uuid primary key default gen_random_uuid(),

  -- RLS gatar på det här fältet, och rutten sätter det ur RUTT-PARAMETERN — aldrig ur kroppen.
  -- Samma regel som säckrapporteringen: en klient som fick välja order själv hade valt en hen är
  -- besättning på och skrivit framdrift där.
  work_order_id   uuid not null references public.crm_work_orders(id) on delete cascade,

  report_day      date not null,

  -- Vilken av orderns rader momentet hör till.
  --
  -- TEXT och ingen främmande nyckel: orderns rader bor i en JSONB-array (crm_work_orders.line_items)
  -- med klientgenererade id:n, så det finns ingen tabell att peka på.
  --
  -- ⚠️ null ÄR ETT SVAR, och det är signalen kontoret ska läsa: momentet finns inte på ordern,
  -- alltså är det rapporterat men inte sålt — avvikelsen. Ingen egen tabell och ingen egen radsort
  -- behövs för det fallet; det faller ut av att jämföra rapporten mot ordern.
  --
  -- ⚠️ Referensen kan bli HÄNGANDE: raden kan tas bort ur ordern efter att den rapporterats. Därför
  -- är `work_item` not null även när en rad är vald — snapshoten bär rapporten vidare och det enda
  -- som faller bort är jämförelsen mot planerat.
  line_item_id    text,

  -- Etiketten som visas: snapshot av orderradens `article_name` när en rad valts, annars fältets
  -- egen fritext.
  --
  -- ⚠️ Tom sträng måste vara OMÖJLIG. För ett fritextmoment ÄR etiketten radens identitet — utan
  -- den går raden varken att gruppera eller läsa, och den blir en siffra utan påstående. (Motsatt
  -- fälla mot ops_segment_reports.construction, där '' avvisas av en CHECK och koden i stället
  -- måste normalisera '' till null.)
  work_item       text not null,

  -- Samma form som ops_segment_reports.sacks_blown: numeric(10,2), aldrig negativ.
  --
  -- 0 ÄR TILLÅTET MED FLIT. "Vi var på Hus C men kom inte in" är en rapport, och med Williams val
  -- att avvikelsen bara ska vara synlig på ordern är en nollrad med en notering precis den
  -- rapporten. Till skillnad från säckarnas nolla räknar INGENTING nedströms på den här (säckarnas
  -- prissätts i efterkalkylen som "0 kr med säkerhet") — här är den ren historik, och en spärr hade
  -- avvisat en sann rad.
  quantity        numeric(10, 2) not null,

  -- Enheten. VISNING ENDAST — ingenting räknar eller matchar på strängen.
  --
  -- Ingen CHECK, av samma skäl som ops_segment_reports.material saknar en: vokabulären bor i koden.
  -- Men RISKEN är en annan och mindre här. Materialet måste stämma TECKEN FÖR TECKEN mot
  -- ops_depot_deliveries.material, annars möts leverans och förbrukning aldrig och depåsaldot står
  -- kvar för högt; `unit` möter ingen systertabell alls.
  --
  -- ⚠️ För en VALD orderrad snapshotas enheten UR RADEN (article_unit_name) och får inte komma från
  -- klienten. Annars kan en rapport säga "45 st" mot en orderrad som säljer 120 m, och kontorets
  -- "45 av 120" blir ett tal utan betydelse. Fritextmoment är enda fallet där fältet väljer enhet.
  unit            text,

  -- "Hus A". Fritext med flit: kontoret vet inte alltid vad byggnaderna heter innan jobbet startar,
  -- och en lista per order hade krävt en egen redigeringsyta på ordern innan fältet kunde rapportera
  -- alls.
  --
  -- ⚠️ NORMALISERINGEN SKER VID GRUPPERING I KODEN, inte här. "hus a", "Hus A" och " Hus A " måste
  -- hamna i samma hink när kontoret summerar per plats, men RADEN ska bära det installatören faktiskt
  -- skrev. En generated column hade låst en regel som visningen ändå måste kunna ändra, och
  -- normaliserad lagring hade skrivit om hens text.
  location        text,

  note            text,

  -- on delete set null: en avslutad anställning ska inte hindra radering av profilen, och
  -- rapporten ska överleva. `created_by_name` bär visningen vidare.
  created_by      uuid references public.profiles(id) on delete set null,

  -- ⚠️ SNAPSHOT, INTE EN JOIN. `profiles` är self-read-only (profiles_select_self är enda
  -- SELECT-policyn), så en PostgREST-join `profiles!created_by` ger null för alla utom en själv.
  -- Och husets vanliga reserv fungerar inte här: listAssignableCrmUsers filtrerar
  -- role in ('sales','admin','konsult') och saknar alltså installatörerna — exakt de som
  -- rapporterar. Samma mönster och samma skäl som crm_work_order_files.created_by_name,
  -- ops_segment_reports.created_by_name och app_tickets.reporter_name.
  --
  -- Passar dessutom en historikbok bättre än en join: namnet fryses som det var när rapporten
  -- skrevs, så en namnändring inte skriver om historiken.
  created_by_name text not null,

  created_at      timestamptz not null default now(),

  constraint crm_wo_progress_quantity_chk check (quantity >= 0),
  constraint crm_wo_progress_work_item_chk check (btrim(work_item) <> '')
);

-- ---------------------------------------------------------------------------
-- Index
-- ---------------------------------------------------------------------------

-- Listfrågan, och den enda: where work_order_id = $1 order by created_at desc.
create index if not exists crm_work_order_progress_work_order_idx
  on public.crm_work_order_progress_reports (work_order_id, created_at desc);

-- Stöder policy-predikatet created_by = auth.uid() (SELECT + DELETE).
create index if not exists crm_work_order_progress_created_by_idx
  on public.crm_work_order_progress_reports (created_by);

-- MEDVETET INGET UNIKT INDEX PÅ (work_order_id, report_day, line_item_id). Två besättningar på
-- samma jobb samma dag är normalt, och ett återbesök till samma moment likaså — summan är just
-- poängen. Dubbeltrycket i dålig mottagning (som gav dubbel säcktotal 2026-08-24) hanteras av
-- DELETE-policyn nedan: rapportören kan ta bort sin egen rad.

alter table public.crm_work_order_progress_reports enable row level security;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- En radpolicy gör INGENTING utan tabellprivilegiet: PostgreSQL nekar satsen innan RLS ens
-- utvärderas. Ingen UPDATE här, och därför heller ingen UPDATE-policy — se huvudet.
grant select, insert, delete on public.crm_work_order_progress_reports to authenticated;

-- ---------------------------------------------------------------------------
-- Policyer
-- ---------------------------------------------------------------------------
-- Grenordning: billigast först. Kolumnjämförelse (gratis) → has_permission (ett svar per fråga) →
-- is_user_on_work_order (slår i ops_segments/ops_*_crew och utvärderas per rad). Samma princip som
-- 20260811_time_entries_rls.sql och crm_wo_files_*.
--
-- ⚠️ NYCKELN ÄR crm.workorder.*, INTE planning.schedule.*. Säckboken ärvde planeringens nycklar
-- eftersom tabellen är planeringens (ops_segment_reports, skapad för tavlan). Den här datan hör
-- till ARBETSORDERN: den rapporteras på ordern, läses på ordern och jämförs mot orderns rader. I
-- praktiken är det samma personer (admin + sales bär båda), men nyckeln blir ärlig — och konsult,
-- som är läsbehörig i hela CRM men saknar .write, kan läsa utan att kunna rapportera eller radera.
--
-- Hjälpfunktionen public.is_user_on_work_order(uuid, uuid) finns sedan
-- 20260810_crm_work_order_crew_access.sql och definieras INTE om här.

-- SELECT: kontoret ser allt, besättningen ser sitt eget jobbs rader.
--
-- INGEN "intern"-gren, till skillnad från crm_work_order_files. Framdriften har ingen intern sort:
-- hela poängen är överlämningen till nästa team, så besättningen ska se ALLT på sitt jobb, även
-- rader kontoret skrivit. `created_by = auth.uid()` står först ändå — den som just skrivit en rad
-- måste kunna läsa tillbaka den även om besättningsuppslaget skulle svara nej (insert:ens
-- `.select()` hade annars gett 0 rader och rutten sett ut att ha misslyckats fast raden ligger där).
drop policy if exists crm_wo_progress_select on public.crm_work_order_progress_reports;
create policy crm_wo_progress_select
  on public.crm_work_order_progress_reports
  for select
  to authenticated
  using (
    created_by = auth.uid()
    or public.has_permission('crm.workorder.read')
    or public.is_user_on_work_order(auth.uid(), work_order_id)
  );

-- INSERT: alltid som sig själv, och antingen med kontorets skrivnyckel eller som besättning på just
-- det jobbet.
--
-- `work_order_id` sätts server-side ur rutt-parametern; predikatet här är ANDRA spärren — en
-- handskriven POST med någon annans work_order_id avvisas av databasen även om rutten skulle sluta
-- kontrollera.
drop policy if exists crm_wo_progress_insert on public.crm_work_order_progress_reports;
create policy crm_wo_progress_insert
  on public.crm_work_order_progress_reports
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and (
      public.has_permission('crm.workorder.write')
      or public.is_user_on_work_order(auth.uid(), work_order_id)
    )
  );

-- DELETE: kontoret rättar vad som helst på ordern, rapportören tar bort sin EGEN rad.
--
-- ⚠️ Besättningsgrenen kräver BÅDE ägarskap OCH att man fortfarande är på jobbet — samma villkor
-- som ops_segment_reports_delete_own_partial, och av samma skäl: den som lyfts ur besättningen
-- efteråt får kontoret hjälpa, och det är rätt ordning. Ägarskapet ensamt räcker inte, till
-- skillnad från crm_work_order_files (där en egen uppladdning alltid ska gå att ångra).
--
-- ⚠️ Att syskonpolicyns tredje villkor `kind = 'partial'` SAKNAS här är inte en glömska. Där bär
-- det hela säkerheten: raderas säckbokens sista final släpps delrapporterna fram som total igen, så
-- en borttagning som ser ut att sänka siffran HÖJER den. Den här boken har ingen final och ingen
-- supersede — en borttagen rad sänker summan med exakt sitt eget belopp, alltid.
drop policy if exists crm_wo_progress_delete on public.crm_work_order_progress_reports;
create policy crm_wo_progress_delete
  on public.crm_work_order_progress_reports
  for delete
  to authenticated
  using (
    public.has_permission('crm.workorder.write')
    or (
      created_by = auth.uid()
      and public.is_user_on_work_order(auth.uid(), work_order_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Verifiering (kör efter applicering)
-- ---------------------------------------------------------------------------
--
-- 1. Kolumnerna, med rätt nullbarhet:
--
--      select column_name, data_type, is_nullable, column_default
--      from information_schema.columns
--      where table_schema = 'public' and table_name = 'crm_work_order_progress_reports'
--      order by ordinal_position;
--
--    Förväntat nullbart: line_item_id, unit, location, note, created_by.
--    Förväntat not null: work_order_id, report_day, work_item, quantity, created_by_name, created_at.
--
-- 2. Tre policyer, RLS på, och INGEN update-policy (den ska saknas):
--
--      select policyname, cmd from pg_policies
--      where schemaname = 'public' and tablename = 'crm_work_order_progress_reports'
--      order by cmd, policyname;
--
--      select relrowsecurity from pg_class
--      where oid = 'public.crm_work_order_progress_reports'::regclass;
--
-- 3. Grants ska vara exakt SELECT/INSERT/DELETE för authenticated — inget UPDATE:
--
--      select privilege_type from information_schema.role_table_grants
--      where table_schema = 'public' and table_name = 'crm_work_order_progress_reports'
--        and grantee = 'authenticated'
--      order by 1;
--
-- 4. Båda CHECK:arna ska NEKA. Förväntat: fel om crm_wo_progress_work_item_chk respektive
--    crm_wo_progress_quantity_chk:
--
--      insert into public.crm_work_order_progress_reports
--        (work_order_id, report_day, work_item, quantity, created_by_name)
--      values ('<work_order_id>', current_date, '   ', 10, 'Test');
--
--      insert into public.crm_work_order_progress_reports
--        (work_order_id, report_day, work_item, quantity, created_by_name)
--      values ('<work_order_id>', current_date, 'Landgång', -1, 'Test');
--
--    Och nollraden ska GÅ IGENOM (rulla tillbaka efteråt) — se kommentaren vid quantity:
--
--      begin;
--      insert into public.crm_work_order_progress_reports
--        (work_order_id, report_day, work_item, quantity, note, created_by_name)
--      values ('<work_order_id>', current_date, 'Landgång', 0, 'Kom inte in i norra delen', 'Test');
--      rollback;
--
-- 5. Hjälpfunktionen som båda besättningsgrenarna vilar på ska svara. true för besättningen på
--    jobbet, false för alla andra (samma punktprov som 20260810 och 20260820):
--
--      select p.full_name, public.is_user_on_work_order(p.id, '<work_order_id>') as pa_jobbet
--      from public.profiles p
--      order by pa_jobbet desc, p.full_name;
--
-- 6. Installatören ska se sitt eget jobbs rader och INGA andras. Impersonera enligt metoden i
--    20260811_crm_work_order_rls_perf_probe.sql — rollbytet, frågan och avläsningen MÅSTE ligga i
--    EN sats:
--
--      select work_order_id, count(*) from public.crm_work_order_progress_reports group by 1;
--
--    Kontoret ska se alla arbetsordrar, installatören bara dem hen är besättning på.
--
-- 7. Punktprovet på borttagningen. ⚠️ Läs `returning`-utfallet, inte frånvaron av fel: en DELETE som
--    RLS nekar är INTE ett fel — den svarar "0 rader" och ser i loggen ut precis som en lyckad
--    borttagning av en rad som redan var borta. Det är samma fälla som gör att routen måste läsa
--    tillbaka raden den raderade.
--
--      begin;
--      -- som installatören: den egna raden ska försvinna
--      delete from public.crm_work_order_progress_reports where id = '<egen rad>' returning id;
--      -- som installatören: kollegans rad ska ge NOLL rader
--      delete from public.crm_work_order_progress_reports where id = '<kollegans rad>' returning id;
--      rollback;
