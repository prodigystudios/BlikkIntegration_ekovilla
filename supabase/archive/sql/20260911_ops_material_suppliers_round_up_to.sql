-- Beställningsstorlek per leverantör: material beställs i hela pallar, inte i lösa säckar.
--
-- BAKGRUND
-- Prognosen (etapp 3) räknar fram `suggested_sacks` som det största underskottet över horisonten —
-- ett exakt tal, t.ex. 187 säck. Fabriken levererar i pallar, så ett exakt tal är en siffra någon
-- ändå måste räkna om för hand varje gång. Pallstorleken skiljer sig mellan leverantörer (Williams
-- besked 2026-09-10), så den hör hemma som DATA på leverantören, inte som en konstant i koden.
--
-- ⚠️ AVRUNDNINGEN SKER EFTER `worst_deficit`, ALDRIG FÖRE. Underskottet är sanningen om behovet;
-- pallen är en leveransform. Avrundas varje dags delbehov för sig staplas felen uppåt och förslaget
-- växer med antalet händelser i stället för med behovet.
--
-- ⚠️ 1 MÅSTE FUNGERA och är default. En leverantör som säljer lösa säckar ska gå att lägga upp, och
-- en ny rad ska inte tyst börja avrunda. `round_up_to = 1` betyder "ingen avrundning" — inte ett
-- saknat värde.
--
-- DEPLOY-ORDNING
-- ⚠️ DEN HÄR MÅSTE KÖRAS FÖRE KODEN. Till skillnad från 20260910_ops_material_suppliers.sql är den
-- INTE ordningsfri: leverantörspanelen skickar hela raden vid varje sparning (useEntityCrud
-- toPayload), så så fort koden är ute innehåller varje PATCH fältet `round_up_to`. Saknas kolumnen
-- svarar PostgREST 400 (PGRST204, "column does not exist") och DÅ GÅR INGEN LEVERANTÖR ATT SPARA
-- ALLS — inte heller namn, adress eller material. Kör den här filen först, verifiera, deploya sedan.
--
-- Kör EFTER 20260910_ops_material_suppliers.sql (tabellen måste finnas).
--
-- Kör i Supabase SQL editor. Idempotent — kör den TVÅ gånger innan du litar på påståendet.
-- Inga tecken utanför BMP i den här filen.

-- `add column if not exists` bär defaulten, så befintliga rader får 1 i samma svep — ingen backfill
-- behövs, och ingen rad blir kvar med null. Taket är inte kosmetiskt: talet multiplicerar upp en
-- beställning, och en felskrivning som 10000 hade gjort varje förslag till ett helt lastbilslass.
alter table public.ops_material_suppliers
  add column if not exists round_up_to integer not null default 1;

-- Egen sats, med eget `drop ... if exists`: en CHECK som läggs inline i `add column if not exists`
-- hoppas över helt vid andra körningen om kolumnen redan finns, och då står tabellen utan sin
-- constraint trots att filen ser ut att ha lagt den. Samma fälla som `create policy` utan
-- `drop policy if exists`.
alter table public.ops_material_suppliers
  drop constraint if exists ops_material_suppliers_round_up_to_check;
alter table public.ops_material_suppliers
  add constraint ops_material_suppliers_round_up_to_check
  check (round_up_to >= 1 and round_up_to <= 1000);

-- ---------------------------------------------------------------------------
-- Verifiering (kör efter applicering)
-- ---------------------------------------------------------------------------
--
-- 1. Kolumnen finns, är not null och har default 1:
--
--    select column_name, data_type, is_nullable, column_default
--    from information_schema.columns
--    where table_schema = 'public' and table_name = 'ops_material_suppliers'
--      and column_name = 'round_up_to';
--
-- 2. Befintliga rader fick 1, inte null. Frågan ska ge noll rader:
--
--    select id, name from public.ops_material_suppliers where round_up_to is null or round_up_to < 1;
--
-- 3. Taket och golvet biter. Båda ska fela med 23514:
--
--    update public.ops_material_suppliers set round_up_to = 0 where true;      -- ska fela
--    update public.ops_material_suppliers set round_up_to = 10000 where true;  -- ska fela
--
--    En giltig ändring ska gå igenom:
--
--    update public.ops_material_suppliers set round_up_to = 24 where name = '<en leverantör>';
--
-- 4. INGEN ny policy behövs — kolumnen ärver tabellens fyra policyer, som alla gatar på
--    planning.depot.manage. Kontrollera ändå att antalet är oförändrat (fyra):
--
--    select count(*) from pg_policies
--    where schemaname = 'public' and tablename = 'ops_material_suppliers';
