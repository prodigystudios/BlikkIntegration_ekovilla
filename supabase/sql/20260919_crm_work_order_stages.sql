-- Etapper på arbetsordern - en order som ska utföras i omgångar.
--
-- VARFÖR
-- Williams behov 2026-09-18: en order säljs som en helhet men utförs i etapper - etapp 1 väggarna
-- nu, etapp 2 snedtaket vid ett senare tillfälle. Planeringen kunde inte uttrycka det. Varje
-- placering ärvde HELA orderns rader, så tavlan visade hela orderns säckantal och hela ordervärdet
-- på en vecka där bara en del av jobbet skulle utföras.
--
-- ADDITIV. En ny tabell och en ny nullbar kolumn på ops_segments. Inga befintliga rader ändras,
-- ingen policy skrivs om. Ordningen mot koden är därmed fri - men kör den här FÖRE deployen:
-- läsvägen bäddar in tabellen i segmentfrågan, och en inbäddning av en tabell som inte finns gör
-- att HELA frågan failar. Tvärtom (tabellen finns, koden är inte deployad) är harmlöst.
--
-- Kör i Supabase SQL-editorn.

-- == ORDVALET ================================================================
--
-- ⚠️ "ETAPP" ÄR UPPTAGET I KODEN. I app/egenkontroll/page.tsx (etapperOpen/etapperClosed,
-- finalSackEntriesFromEtappRows) betyder "etapp" en KONSTRUKTIONSDEL - vind, vägg, snedtak - inte
-- en tidsetapp. De två har ingenting med varandra att göra: en tidsetapp kan innehålla flera
-- konstruktionsdelar, och samma konstruktionsdel kan delas mellan två tidsetapper.
--
-- Därför heter det `stage` i databasen och i koden, och "Etapp" bara i det användaren läser.
-- Blanda inte ihop dem; se lib/domains/crm/workOrderStages.ts som bär samma varning.

-- == MODELLEN ================================================================
--
-- En etapp äger en DELMÄNGD AV ORDERNS RADER, med antal - exakt samma form som delfakturans
-- rundor (crm_work_order_invoices.line_quantities, se lib/domains/fortnox/partialInvoices.ts).
-- Formen är beprövad och löser samma sorts fråga: "hur mycket av varje rad hör till den här
-- omgången", och "hur mycket är kvar".
--
-- ⚠️ EN EGEN TABELL, INTE EN JSONB-ARRAY PÅ crm_work_orders. Tre skäl, i fallande vikt:
--
--   1. ops_segments måste kunna peka på en etapp med en riktig främmande nyckel. Ett element i en
--      JSONB-array har inget FK-mål. Repot bär redan den skulden en gång - se huvudet i
--      20260916_crm_work_order_progress_reports.sql om varför line_item_id är text utan FK - och
--      att lägga till en andra hängande referens när en riktig tabell är möjlig är en försämring.
--   2. line_items skrivs som HELA arrayen av saveWorkOrderLineItems. Låg etapperna på samma rad
--      hade kontorets artikelredigering och en samtidig etappändring skrivit över varandra, tyst,
--      med sista skrivning som vinnare.
--   3. Backloggen behöver fråga "etapper UTAN täckande segment" - en anti-join mot ops_segments.
--      Med JSONB måste varje orders array hämtas hem och packas upp i klienten.
--
-- ⚠️ "RESTEN" ÄR IMPLICIT OCH LAGRAS ALDRIG. Ett segment med stage_id = null betyder "allt på
-- ordern som ingen etapp har tagit". På en order utan etapper är det hela ordern, alltså exakt
-- dagens beteende - det är gångjärnet som gör att de dryga hundra befintliga ordrarna inte ändras.
-- En LAGRAD rest hade behövt räknas om vid varje radredigering och blivit ett andra sanningsställe
-- att hålla i synk; det är precis felet som gjorde line_items_invoicing_snapshot till död historik.

create table if not exists public.crm_work_order_stages (
  id               uuid primary key default gen_random_uuid(),
  work_order_id    uuid not null references public.crm_work_orders(id) on delete cascade,

  -- "Etapp 2". ⚠️ ÅTERANVÄNDS ALDRIG. Talet står i orderbekräftelser och i aktivitetsloggen, så en
  -- raderad etapp 2 lämnar ett hål och nästa etapp blir 3. Sätts server-side som max+1; två
  -- samtidiga skapanden ger ett unique-brott som rutten gör om.
  stage_number     integer not null,

  -- Vad etappen kallas i listan: "Snedtak", "Plan 2". Fri text - se ordvalet ovan om varför den
  -- INTE är konstruktionsvokabulären från lib/domains/crm/constructions.ts.
  title            text not null,

  -- [{"line_id":"<uuid ur line_items[].id>","quantity":30}]
  --
  -- ⚠️ ANTALET ÄR I RADENS lineItemQuantity-ENHET, samma som delfakturans rundor: kubik för
  -- m3-rader (m2 x tjocklek / 1000), annars radens antal. Beskärningen i koden projicerar raden
  -- till pricing_mode 'item' med det antalet, varefter ALL befintlig radmatte - totalSacks,
  -- lineItemRowTotal, materialDemandFromLineItems - körs oförändrad på resultatet.
  --
  -- ⚠️ INGEN FK, OCH INGEN legacy_index-VÄG. Orderns rader bor i en JSONB-array med
  -- klientgenererade id:n, så det finns ingen tabell att peka på. Till skillnad från
  -- crm_work_order_invoices behövs ingen indexreserv: etapper är ett nytt begrepp, och
  -- quoteLineItemSchema har krävt `id` på varje rad vid varje sparning sedan länge. En rad utan id
  -- kan alltså inte ingå i en etapp, och ignoreras vid läsning.
  line_quantities  jsonb not null default '[]'::jsonb,

  -- Vad besättningen ska göra i just den här etappen ("snedtaket, börja från gaveln") och vilken
  -- sorts jobb det är. Williams val 2026-09-18.
  --
  -- ⚠️ ÄRVS TILL PLACERINGEN VID UTPLACERING, den läses inte parallellt. ops_segments bär redan
  -- work_description och job_type, och det är DEM fältvyn läser. Etappens värden kopieras in som
  -- startvärde när etappen placeras; segmentet går att ändra efteråt utan att etappen rörs. Att i
  -- stället låta fältvyn falla tillbaka på etappen hade gett två källor för samma text och krävt
  -- att varje läsare kände till båda.
  --
  -- job_type är fri text precis som ops_segments.job_type - den bär ops_job_types stabila `key`,
  -- och en nyckel som senare tas bort ska fortsätta rendera (resolveJobTypeFrom i jobTypes.ts).
  work_description text,
  job_type         text,

  created_by       uuid references public.profiles(id) on delete set null,
  -- Snapshot, inte join. profiles är self-read-only (profiles_select_self är enda SELECT-policyn),
  -- så profiles!created_by ger null för alla utom en själv. Samma skäl som crm_work_order_files och
  -- ops_segment_reports.created_by_name.
  created_by_name  text not null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (work_order_id, stage_number),
  constraint crm_wo_stages_title_chk  check (btrim(title) <> ''),
  constraint crm_wo_stages_number_chk check (stage_number > 0),
  constraint crm_wo_stages_lines_chk  check (jsonb_typeof(line_quantities) = 'array')
);

-- Listfrågan, och den enda: where work_order_id = $1 order by stage_number.
-- Unique-indexet ovan täcker den redan, så inget extra index behövs.

-- ⚠️ INGEN CONSTRAINT SOM HÅLLER "SUMMAN ÖVER ETAPPER <= RADENS ANTAL". Villkoret spänner över
-- flera rader i den här tabellen OCH en JSONB-array på en annan, och en CHECK ser bara en rad. En
-- trigger hade behövt summera syskonraderna och räkna lineItemQuantity (m2 x tjocklek / 1000) i
-- PL/pgSQL, alltså en andra implementation av radmatten i ett annat språk - precis det som
-- lib/domains/crm/pricing.ts förbjuder i sitt huvud.
--
-- Regeln bor därför i domänen (validateStageAllocation), och läs-sidan har ett TAK: beskärningen
-- returnerar aldrig mer än radens antal och resten golvas på noll. En kapplöpning mellan två
-- samtidiga etappskapanden kan alltså ge "resten = 0", men aldrig negativa tal och aldrig uppblåst
-- omsättning.

alter table public.crm_work_order_stages enable row level security;

-- == GRANTS ==================================================================
-- En radpolicy gör INGENTING utan tabellprivilegiet: PostgreSQL nekar satsen innan RLS ens
-- utvärderas. Grants och policys hör ihop parvis - ett grant utan policy gav 500 i drift en gång,
-- se 20260629_crm_work_order_comments_update_grant.sql.
grant select, insert, update, delete on public.crm_work_order_stages to authenticated;

-- == POLICYER ================================================================
--
-- SELECT speglar crm_work_orders_select_visible EXAKT (20260609_rls_permissions_crm_quotes_workorders):
-- den som får läsa ordern får läsa dess etapper, ingen bredare. Planeraren bär crm.workorder.read
-- (rollerna admin, konsult, sales - och sedan 20260918 även ekonomi), så ingen egen
-- planning.schedule.*-gren behövs. En sådan hade WIDGAT läsningen till installatörer.
drop policy if exists crm_wo_stages_select on public.crm_work_order_stages;
create policy crm_wo_stages_select
  on public.crm_work_order_stages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.crm_work_orders w
      -- ⚠️ KOLUMNEN ÄR KVALIFICERAD MED FLIT. Oskrivet (`w.id = work_order_id`) löser Postgres upp
      -- namnet mot den INRE tabellen först, och faller tillbaka på den yttre bara för att
      -- crm_work_orders råkar sakna en kolumn som heter work_order_id. crm_quotes HAR en sådan
      -- (20260530062211), så namnet är i bruk i samma schema. Lades det någon gång till på
      -- crm_work_orders skulle villkoret tyst bli `w.id = w.work_order_id` — nästan alltid falskt,
      -- och INGEN skulle kunna läsa en enda etapp. Fail-closed, men obegripligt.
      where w.id = public.crm_work_order_stages.work_order_id
        and (auth.uid() = w.assigned_to or public.has_permission('crm.workorder.read'))
    )
  );

-- INSERT/UPDATE/DELETE: KONTORET äger indelningen (Williams beslut 2026-09-18).
--
-- ⛔ INGEN assigned_to-GREN, till skillnad från SELECT ovan. Att vara tilldelad ordern ska inte ge
-- rätt att dela upp den - en installatör som råkar vara assigned_to hade annars kunnat skapa
-- etapper som styr vad tavlan säger att veckan omsätter.
drop policy if exists crm_wo_stages_insert on public.crm_work_order_stages;
create policy crm_wo_stages_insert
  on public.crm_work_order_stages
  for insert
  to authenticated
  with check (created_by = auth.uid() and public.has_permission('crm.workorder.write'));

drop policy if exists crm_wo_stages_update on public.crm_work_order_stages;
create policy crm_wo_stages_update
  on public.crm_work_order_stages
  for update
  to authenticated
  using (public.has_permission('crm.workorder.write'))
  with check (public.has_permission('crm.workorder.write'));

drop policy if exists crm_wo_stages_delete on public.crm_work_order_stages;
create policy crm_wo_stages_delete
  on public.crm_work_order_stages
  for delete
  to authenticated
  using (public.has_permission('crm.workorder.write'));

-- updated_at. Egen funktion i stället för en delad: repot har flera varianter och en omdefinierad
-- delad funktion hade rört tabeller den här migreringen inte handlar om.
create or replace function public.set_timestamp_crm_work_order_stages()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_timestamp_crm_work_order_stages on public.crm_work_order_stages;
create trigger set_timestamp_crm_work_order_stages
before update on public.crm_work_order_stages
for each row execute procedure public.set_timestamp_crm_work_order_stages();

-- == KOPPLINGEN TILL PLANERINGEN ============================================
--
-- Vilken etapp en placering utför. null = resten av ordern (se "RESTEN" ovan).
--
-- ⚠️ on delete SET NULL, inte CASCADE. En raderad etapp får ALDRIG tyst radera en placering ur
-- kalendern - då hade en bils dag tömts utan att någon märkte det. Vid borttagning ligger
-- placeringen kvar och blir rest-scopad, och kortets säckantal HOPPAR synligt. Rutten svarar
-- dessutom 409 när etappen har placeringar, så det kräver ett medvetet andra steg.
--
-- ⛔ Inte RESTRICT heller: crm_work_orders DELETE kaskaderar till etapperna, och ett restrict från
-- ops_segments hade då avbrutit hela orderraderingen med ett fel som pekar ut fel tabell.
alter table public.ops_segments
  add column if not exists stage_id uuid references public.crm_work_order_stages(id) on delete set null;

-- Stöder backloggens "etapper utan täckande segment" och uppslaget per placering.
create index if not exists ops_segments_stage_idx on public.ops_segments (stage_id);

-- == VERIFIERING =============================================================
--
--   -- Tabellen finns med sina fyra constraints:
--   select conname from pg_constraint
--   where conrelid = 'public.crm_work_order_stages'::regclass order by 1;
--   -- Förväntat: crm_wo_stages_lines_chk, crm_wo_stages_number_chk, crm_wo_stages_title_chk,
--   -- unique-indexet på (work_order_id, stage_number), plus PK och de två FK:erna.
--
--   -- Fyra policyer, och grants som matchar dem:
--   select polname, polcmd from pg_policy
--   where polrelid = 'public.crm_work_order_stages'::regclass order by 1;
--
--   -- Kolumnen finns på ops_segments och är NULLBAR:
--   select column_name, is_nullable from information_schema.columns
--   where table_name = 'ops_segments' and column_name = 'stage_id';
--   -- Förväntat: stage_id | YES
--
--   -- Ingen befintlig placering har rörts:
--   select count(*) from public.ops_segments where stage_id is not null;
--   -- Förväntat: 0 direkt efter körning.
