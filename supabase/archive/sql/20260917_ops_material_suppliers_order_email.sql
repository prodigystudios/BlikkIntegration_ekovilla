-- Beställningsmailets mall, per leverantör: språk, ämne och text.
--
-- BAKGRUND
-- Beställningsmailet till fabriken (etapp 4) hade en fast svensk text. Vissa leverantörer är
-- engelskspråkiga (Williams besked 2026-09-17), och texten runt beställningen skiljer sig mellan
-- fabriker. Beslut: mallen bor PÅ leverantören, och den är fri text med platshållare.
--
--   order_email_language  'sv' eller 'en'. Styr också systemets delar av mailet — orderraderna,
--                         datum och enheter ("4 pall (216 säck)" / "4 pallets (216 bags)").
--   order_email_subject   Ämnet, med platshållare. null = standardtexten för språket.
--   order_email_body      Texten, med platshållare. null = standardtexten för språket.
--
-- ⚠️ STANDARDTEXTERNA BOR I KODEN, inte här (lib/domains/planning/materialOrderEmail.ts). null betyder
-- "använd standard", så en rättad standardtext når alla leverantörer som inte anpassat sin — och ingen
-- backfill behövs. Ämne och text är antingen BÅDA null eller BÅDA satta: en halvt anpassad mall hade
-- blandat en egen text med ett standardämne på fel språk utan att någon valt det.
--
-- ⚠️ PLATSHÅLLARNA VALIDERAS I KODEN, inte här (samma skäl som materialkoderna: vokabulären bor på ETT
-- ställe). Databasen vaktar bara formen: längd, att ämnet är EN rad (ett radbrytningstecken i ämnet
-- är en header-injektion) och att båda är satta eller ingen.
--
-- ⚠️ LÄSBARHETEN ÄR OFÖRÄNDRAD. Kolumnerna ligger på ops_material_suppliers, vars SELECT redan kräver
-- planning.depot.manage. planning_supply_terms() delar raden med schedule.read men väljer uttryckligen
-- id, materials och lead_time_days — mallen följer INTE med dit, och ska aldrig göra det. Tabellen är
-- inte publicerad i supabase_realtime (se 20260910_ops_material_suppliers.sql), och det ändras inte.
--
-- DEPLOY-ORDNING
-- ⚠️ DEN HÄR MÅSTE KÖRAS FÖRE KODEN. Leverantörsläsningen väljer de nya kolumnerna; saknas de svarar
-- PostgREST 400 och Leverantörer-fliken visar "Leverantörsregistret kunde inte hämtas". Tabellen
-- påverkas inte i övrigt: kolumnerna är additiva, befintliga rader får 'sv' och null (= svensk
-- standardtext), och ingen befintlig kod skriver till dem.
--
-- Kör EFTER 20260910_ops_material_suppliers.sql (tabellen måste finnas).
--
-- Kör i Supabase SQL editor. Idempotent — kör den TVÅ gånger innan du litar på påståendet.
-- Inga tecken utanför BMP i den här filen.

alter table public.ops_material_suppliers
  add column if not exists order_email_language text not null default 'sv',
  add column if not exists order_email_subject text,
  add column if not exists order_email_body text;

-- Egna satser med eget `drop ... if exists`: en CHECK inline i `add column if not exists` hoppas över
-- vid andra körningen när kolumnen redan finns, och tabellen står då utan sin constraint.
alter table public.ops_material_suppliers
  drop constraint if exists ops_material_suppliers_order_email_language_check;
alter table public.ops_material_suppliers
  add constraint ops_material_suppliers_order_email_language_check
  check (order_email_language in ('sv', 'en'));

alter table public.ops_material_suppliers
  drop constraint if exists ops_material_suppliers_order_email_subject_check;
alter table public.ops_material_suppliers
  add constraint ops_material_suppliers_order_email_subject_check
  check (
    order_email_subject is null
    or (
      char_length(order_email_subject) between 1 and 200
      and position(chr(10) in order_email_subject) = 0
      and position(chr(13) in order_email_subject) = 0
    )
  );

alter table public.ops_material_suppliers
  drop constraint if exists ops_material_suppliers_order_email_body_check;
alter table public.ops_material_suppliers
  add constraint ops_material_suppliers_order_email_body_check
  check (order_email_body is null or char_length(order_email_body) between 1 and 5000);

alter table public.ops_material_suppliers
  drop constraint if exists ops_material_suppliers_order_email_pair_check;
alter table public.ops_material_suppliers
  add constraint ops_material_suppliers_order_email_pair_check
  check ((order_email_subject is null) = (order_email_body is null));

-- ---------------------------------------------------------------------------
-- Verifiering (kör efter applicering)
-- ---------------------------------------------------------------------------
--
-- 1. Kolumnerna finns, språket är not null med default 'sv':
--
--    select column_name, is_nullable, column_default
--    from information_schema.columns
--    where table_schema = 'public' and table_name = 'ops_material_suppliers'
--      and column_name like 'order_email_%'
--    order by column_name;
--
-- 2. Fyra constraints:
--
--    select conname from pg_constraint
--    where conrelid = 'public.ops_material_suppliers'::regclass and conname like '%order_email%'
--    order by conname;
--
-- 3. Befintliga leverantörer står på svensk standardtext:
--
--    select name, order_email_language, order_email_subject is null as standard
--    from public.ops_material_suppliers order by name;
--
-- 4. Formen vaktas. Kör EN rad i taget, alltid inom begin/rollback — varje update ska fela, men skulle
--    en constraint saknas hade den annars skrivit över samtliga leverantörer:
--
--    begin; update public.ops_material_suppliers set order_email_language = 'fi'; rollback;
--    begin; update public.ops_material_suppliers set order_email_subject = 'a' || chr(10) || 'b', order_email_body = 'x'; rollback;
--    begin; update public.ops_material_suppliers set order_email_subject = 'bara ämne'; rollback;
--    begin; update public.ops_material_suppliers set order_email_subject = '', order_email_body = ''; rollback;
--
-- 5. Mallen följer inte med till schedule.read. Kolumnlistan ska vara exakt supplier_id, materials,
--    lead_time_days:
--
--    select pg_get_function_result(p.oid)
--    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'planning_supply_terms';
