-- Efterkalkylens två inställningar: timkostnaden och materialens kostnadsartiklar.
--
-- BAKGRUND
-- CRM:et har hittills bara kunnat visa FÖRKALKYL: quoteMargin() i lib/domains/crm/pricing.ts
-- räknar TG på offerten ur artiklarnas inköpspris. Sedan säckrapporteringen (20260820) och /tid
-- (fas 4) är i drift finns i stället VERKLIGT utfall per arbetsorder:
--
--   ops_segment_reports  vad som faktiskt blåstes, per material och placering
--   crm_time_entries     vad som faktiskt arbetades, per person
--
-- Ur de två går efterkalkylen att räkna: TB1 = intäkt − material, TB2 = TB1 − arbete. Båda
-- termerna behöver en prislapp som INTE finns i någon av tabellerna, och det är det den här filen
-- lägger till.
--
-- VAD FILEN GÖR
-- Två nya tabeller. Ingen befintlig tabell, kolumn eller policy rörs.
--
-- DEPLOY-ORDNING
-- Additiv, alltså valfri ordning mot koden. Körs den EFTER koden svarar PostgREST 400 på en saknad
-- relation och efterkalkylkortet visar sitt felmeddelande — inget går sönder, men kortet är tomt
-- tills filen är körd. Kör den gärna först.
--
-- Kör i Supabase SQL editor. Idempotent (kör den två gånger innan du litar på påståendet).
--
-- ⚠️ INGA EMOJI UTANFÖR BMP I DEN HÄR FILEN. Ett surrogatpar får Supabase-editorns
-- offsetmatematik att kapa en `--`-kommentar mitt i raden, resten av raden blir en körbar sats och
-- HELA migreringen rullas tillbaka (belagt 2026-08-20, se
-- 20260820_ops_segment_reports_sack_reporting.sql). ⚠️ och ✅ ligger i BMP och är ofarliga.

-- ---------------------------------------------------------------------------
-- 1. crm_calc_settings — timkostnaden
-- ---------------------------------------------------------------------------
-- SINGLETON. `id boolean primary key default true check (id)` är husets sätt att göra en tabell
-- till exakt en rad: enda tillåtna värdet är true, och primärnyckeln hindrar en andra.
--
-- ⚠️ INGEN HISTORIK, MED FLIT — och det är ett beslut, inte en förenkling. William valde "alla jobb
-- får nya satsen" (2026-08-28). Följden är att en höjning av satsen SKRIVER OM historiken: ett jobb
-- som var lönsamt i fjol kan bli olönsamt nästa gång någon öppnar det. Det är acceptabelt så länge
-- efterkalkylen läses som en ögonblicksruta på ett färdigt jobb, men INTE om talen någon gång ska
-- jämföras över år. Ska det ändras är vägen `valid_from date` + en rad per revision, och då måste
-- uppslaget nyckla på jobbets utförandedatum — inte på dagens datum.
--
-- ⚠️ SATSEN ÄR PER PERSON OCH TIMME, INTE PER TEAM. Lönsamhetsmodellen räknar 1 300 kr/h för ett
-- team om två, alltså 650 kr per man-timme. Efterkalkylen summerar varje persons faktiska minuter
-- ur crm_time_entries och multiplicerar med den här satsen — blandas de två ihop blir
-- arbetskostnaden dubbelt eller hälften utan att något ser trasigt ut.
create table if not exists public.crm_calc_settings (
  id                   boolean primary key default true check (id),
  labor_cost_per_hour  numeric(10, 2) not null check (labor_cost_per_hour >= 0),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.profiles(id) on delete set null
);

-- Seed: modellens 650 kr/h per person. `on conflict do nothing` så en omkörning ALDRIG skriver
-- tillbaka en sats någon har justerat i inställningarna.
insert into public.crm_calc_settings (id, labor_cost_per_hour)
values (true, 650)
on conflict (id) do nothing;

alter table public.crm_calc_settings enable row level security;
grant select, insert, update on public.crm_calc_settings to authenticated;

-- Läsning för alla CRM-användare, skrivning för admin. Själva efterkalkylrutten läser med
-- service-role (se app/api/crm/work-orders/[id]/after-calculation/route.ts och skälet där), så
-- policyerna nedan gatar i praktiken skrivvägen och eventuella direktläsningar.
drop policy if exists crm_calc_settings_select on public.crm_calc_settings;
create policy crm_calc_settings_select on public.crm_calc_settings
  for select to authenticated
  using (public.has_permission('crm.access'));

drop policy if exists crm_calc_settings_insert on public.crm_calc_settings;
create policy crm_calc_settings_insert on public.crm_calc_settings
  for insert to authenticated
  with check (public.has_permission('crm.admin'));

drop policy if exists crm_calc_settings_update on public.crm_calc_settings;
create policy crm_calc_settings_update on public.crm_calc_settings
  for update to authenticated
  using (public.has_permission('crm.admin'))
  with check (public.has_permission('crm.admin'));

-- INGEN DELETE-POLICY: singletonen ska inte gå att ta bort. Utan rad faller efterkalkylen tillbaka
-- på "timkostnad saknas" och visar TB1 utan TB2 — rätt beteende, men inte ett läge någon ska kunna
-- hamna i av misstag.

-- ---------------------------------------------------------------------------
-- 2. crm_material_cost_articles — material → kostnadsartikel
-- ---------------------------------------------------------------------------
-- Vilket artikelnummer i Fortnox som bär INKÖPSPRISET för ett material.
--
-- ⚠️ DET ÄR INTE SAMMA ARTIKEL SOM OFFERTEN SÄLJER PÅ. Offertraden bär försäljningsartikeln, och
-- den artikeln har (belagt 2026-08-28) fel inköpspris. Kostnadsartiklarna är separata:
--
--   EKOVILLA        2410508
--   KNAUF SUPAFIL   16443
--   ROCKWOOL        2410577
--
-- ⚠️ PRISET ÄR PER SÄCK. Det är hela skälet till att efterkalkylen kan vara exakt: rapporten från
-- fältet är redan i säckar, så materialkostnaden är `rapporterade säckar × purchase_price` rakt av
-- — ingen densitet, ingen omräkning, ingen avrundning som konkurrerar med sacksFor().
--
-- ⚠️ SAMMA ENHETSANTAGANDE GÄLLER INTE OFFERTENS TG. pricing.ts gör `purchasePrice * quantity` där
-- quantity är m³. Är priset per säck är den förkalkylen fel i drift redan i dag. Det är en EGEN
-- ändring med ett eget beslut och rör inte den här filen — men det är känt härifrån och framåt.
--
-- `material` är samma kanoniska kortkod som ops_segment_reports.material och
-- ops_depot_deliveries.material, alltså en `short` ur MATERIALS i lib/domains/crm/materials.ts
-- (EKOVILLA, KNAUF SUPAFIL, ISOCELL/ISECO, HUNTON NATIVO, PAROC). Identiteten är HÅRD: stämmer den
-- inte tecken för tecken möts rapport och prislapp aldrig, och materialkostnaden blir tyst noll.
--
-- ⚠️ INGEN CHECK PÅ `material`, av exakt samma skäl som systertabellerna: vokabulären bor i koden
-- och valideras i Zod på ETT ställe. En CHECK här hade blivit en fjärde kopia av listan som ingen
-- kommer ihåg att utöka när en ny leverantör tillkommer — och till skillnad från depåflödet är en
-- felstavning här harmlös: raden matchar då bara ingen rapport, och kortet säger "kostnadsartikel
-- saknas" i stället för att gissa.
create table if not exists public.crm_material_cost_articles (
  material        text primary key,
  article_number  text not null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id) on delete set null
);

-- Seed: de tre kostnadsartiklar William tog fram 2026-08-28.
--
-- ROCKWOOL finns INTE i MATERIALS och kan alltså inte rapporteras i fält än. Raden seedas ändå så
-- den ligger rätt den dag materialet läggs till — vilket rör både materials.ts och en CHECK i
-- databasen, och därför är en egen ändring. Tills dess matchar raden ingenting, vilket är ofarligt.
--
-- `on conflict do nothing` så en omkörning inte skriver tillbaka en artikel någon har rättat.
insert into public.crm_material_cost_articles (material, article_number)
values
  ('EKOVILLA',      '2410508'),
  ('KNAUF SUPAFIL', '16443'),
  ('ROCKWOOL',      '2410577')
on conflict (material) do nothing;

alter table public.crm_material_cost_articles enable row level security;
grant select, insert, update, delete on public.crm_material_cost_articles to authenticated;

drop policy if exists crm_material_cost_articles_select on public.crm_material_cost_articles;
create policy crm_material_cost_articles_select on public.crm_material_cost_articles
  for select to authenticated
  using (public.has_permission('crm.access'));

drop policy if exists crm_material_cost_articles_insert on public.crm_material_cost_articles;
create policy crm_material_cost_articles_insert on public.crm_material_cost_articles
  for insert to authenticated
  with check (public.has_permission('crm.admin'));

drop policy if exists crm_material_cost_articles_update on public.crm_material_cost_articles;
create policy crm_material_cost_articles_update on public.crm_material_cost_articles
  for update to authenticated
  using (public.has_permission('crm.admin'))
  with check (public.has_permission('crm.admin'));

-- DELETE finns för att kunna KOPPLA BORT ett material igen. Raden är en mappning, inte historik —
-- tas den bort säger efterkalkylen "kostnadsartikel saknas" för det materialet, vilket är samma
-- läge som innan den lades till.
drop policy if exists crm_material_cost_articles_delete on public.crm_material_cost_articles;
create policy crm_material_cost_articles_delete on public.crm_material_cost_articles
  for delete to authenticated
  using (public.has_permission('crm.admin'));

-- ---------------------------------------------------------------------------
-- Index — medvetet inga
-- ---------------------------------------------------------------------------
-- Båda tabellerna läses i sin helhet vid varje efterkalkyl (en rad respektive en handfull) och har
-- primärnyckel på uppslagskolumnen. Ett extra index hade bara kostat vid skrivning.

-- ---------------------------------------------------------------------------
-- Verifiering (kör efter applicering)
-- ---------------------------------------------------------------------------
--
-- 1. Båda tabellerna finns med rätt kolumner:
--
--      select table_name, column_name, data_type, is_nullable
--      from information_schema.columns
--      where table_schema = 'public'
--        and table_name in ('crm_calc_settings', 'crm_material_cost_articles')
--      order by table_name, ordinal_position;
--
-- 2. Seeden ligger inne — EN sats och TRE material:
--
--      select * from public.crm_calc_settings;
--      select * from public.crm_material_cost_articles order by material;
--
--    Förväntat: 650.00 kr/h. EKOVILLA 2410508, KNAUF SUPAFIL 16443, ROCKWOOL 2410577.
--
-- 3. Singletonen släpper inte in en andra rad (ska ge fel båda gångerna):
--
--      insert into public.crm_calc_settings (id, labor_cost_per_hour) values (false, 700);
--      insert into public.crm_calc_settings (id, labor_cost_per_hour) values (true, 700);
--
-- 4. Kostnadsartiklarna finns i artikelcachen och bär ett inköpspris. Saknas priset visar
--    efterkalkylen "inköpspris saknas" i stället för en kostnad — och DÅ är det den här frågan som
--    svarar varför:
--
--      select a.article_number, a.description, a.purchase_price, a.unit, a.active
--      from public.fortnox_articles_cache a
--      where a.article_number in ('2410508', '16443', '2410577');
--
--    ⚠️ `unit` är informativ här. Efterkalkylen ANTAR per säck (Williams besked 2026-08-28) och
--    läser inte kolumnen. Står det något annat än säck/st där är det det antagandet som ska
--    omprövas, inte koden som ska böja sig för fältet.
--
-- 5. RLS gatar skrivningen. Impersonera en sales-användare enligt metoden i
--    20260811_crm_work_order_rls_perf_probe.sql (rollbyte, fråga och avläsning i EN sats):
--
--      update public.crm_calc_settings set labor_cost_per_hour = 700 where id;
--
--    Förväntat: 0 rader berörda för sales/konsult, 1 för admin.
--    ⚠️ En UPDATE som RLS blockerar svarar `error: null` och noll rader — inte ett fel. Räkna
--    raderna, lita inte på att anropet "gick igenom".
