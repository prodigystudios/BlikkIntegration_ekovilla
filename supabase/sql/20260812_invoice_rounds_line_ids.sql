-- Delfakturering: nyckla fakturarundornas rader på radens id i stället för dess arrayposition.
--
-- VARFÖR. Varje runda sparar vad den fakturerade som `line_quantities: [{index, quantity}]`, där
-- index är radens plats i arbetsorderns `line_items`. Det gjorde positionen bärande: lade man till,
-- tog bort eller flyttade en rad pekade en redan utställd fakturas antal tyst på fel artikel. Därför
-- låstes hela artikeleditorn vid första delfakturan — ett trubbigt skydd som i praktiken betyder att
-- en order inte går att rätta mitt i ett projekt, vilket är precis när den behöver rättas.
--
-- Raderna har redan ett stabilt UUID (`line_items[].id`, obligatoriskt i quoteLineItemSchema, och
-- identiskt mellan `line_items` och `line_items_invoicing_snapshot`). Rundorna använde bara fel
-- nyckel. Med `line_id` blir positionen betydelselös och låset onödigt.
--
-- ⚠️ DEN HÄR MIGRERINGEN RÖR FAKTURAUNDERLAG. En felmappning pekar om en utställd fakturas antal
-- till fel artikel. Därför:
--   • `legacy_index` sparas kvar i varje post, så mappningen går att granska i efterhand.
--   • Rader vars id INTE går att slå upp lämnas orörda (behåller `index`), och läskoden faller
--     tillbaka på index för dem. Migreringen tappar hellre en rad än gissar fel.
--   • Verifieringsfrågan sist visar exakt vad som mappades.
--
-- Idempotent: poster som redan har `line_id` rörs inte. Kör den två gånger innan du litar på den.

begin;

-- ── 1. Mappa index → line_id ─────────────────────────────────────────────────
-- Basen är samma lista som beräkningen av återstående alltid har använt: den frysta snapshoten när
-- den finns, annars de levande raderna. `->` med heltal indexerar jsonb-arrayen, och `->>'id'` ger
-- null om raden saknas — vilket är hela poängen med coalesce-grenen nedan.
-- ⚠️ EXPANDERA ALLA POSTER, inte bara de omigrerade. UPDATE:en nedan ersätter HELA
-- line_quantities-arrayen, så filtrerar man här försvinner varje post som inte kom med. En rad som
-- delvis migrerats (någon post fick line_id, någon annan kunde inte slås upp) hade då förlorat de
-- migrerade posternas antal vid nästa körning — alltså exakt vid den omkörning headern uppmanar
-- till, och på fakturaunderlag. Urvalet av VILKA rader som skrivs sker i stället på rad-nivå sist.
with expanded as (
  select
    inv.id                                   as invoice_row_id,
    q.ordinality                             as pos,
    q.value                                  as entry,
    (q.value ->> 'quantity')::numeric        as quantity,
    (q.value ->> 'index')::int               as legacy_index,
    -- Behöver den här posten migreras alls?
    (q.value ? 'index' and not (q.value ? 'line_id')) as needs_migration,
    coalesce(wo.line_items_invoicing_snapshot, wo.line_items) as basis
  from public.crm_work_order_invoices inv
  join public.crm_work_orders wo on wo.id = inv.work_order_id
  cross join lateral jsonb_array_elements(coalesce(inv.line_quantities, '[]'::jsonb))
       with ordinality as q(value, ordinality)
),
resolved as (
  select
    invoice_row_id,
    pos,
    entry,
    quantity,
    legacy_index,
    needs_migration,
    case when needs_migration then basis -> legacy_index ->> 'id' end as line_id
  from expanded
),
rebuilt as (
  select
    invoice_row_id,
    -- Sant bara om MINST en post faktiskt kunde migreras. Rader där ingenting ändras skrivs inte
    -- alls, så en omkörning är en ren no-op i stället för en omskrivning.
    bool_or(needs_migration and line_id is not null) as changed,
    jsonb_agg(
      case
        when needs_migration and line_id is not null
          then jsonb_build_object('line_id', line_id, 'quantity', quantity, 'legacy_index', legacy_index)
        -- Redan migrerad, eller ingen träff på id:t: posten lämnas EXAKT som den var. Läskoden
        -- hanterar index-formen, och en gissning på fakturaunderlag är aldrig värd risken.
        else entry
      end
      order by pos
    ) as line_quantities
  from resolved
  group by invoice_row_id
)
update public.crm_work_order_invoices inv
set line_quantities = rebuilt.line_quantities
from rebuilt
where rebuilt.invoice_row_id = inv.id
  and rebuilt.changed;

commit;

-- ── Verifiering (kör efter applicering) ──────────────────────────────────────
--
-- 1. Varje post ska nu ha line_id. Kommer något tillbaka med `har_line_id = false` betyder det att
--    radens id inte gick att slå upp — granska den ordern för hand INNAN någon redigerar dess
--    artiklar, för den rundan faller tillbaka på arrayposition.
--
--      select inv.id, wo.order_number, inv.round_number,
--             q.value ? 'line_id' as har_line_id,
--             q.value ->> 'legacy_index' as gammalt_index,
--             q.value ->> 'line_id' as line_id
--      from public.crm_work_order_invoices inv
--      join public.crm_work_orders wo on wo.id = inv.work_order_id
--      cross join lateral jsonb_array_elements(coalesce(inv.line_quantities, '[]'::jsonb)) as q(value)
--      order by wo.order_number, inv.round_number;
--
-- 2. Kontrollera att varje line_id FAKTISKT finns på sin arbetsorder. Noll rader = allt stämmer.
--    Kommer något tillbaka pekar en faktura på en rad som inte finns, och det måste redas ut.
--
--      select wo.order_number, inv.round_number, q.value ->> 'line_id' as saknat_line_id
--      from public.crm_work_order_invoices inv
--      join public.crm_work_orders wo on wo.id = inv.work_order_id
--      cross join lateral jsonb_array_elements(coalesce(inv.line_quantities, '[]'::jsonb)) as q(value)
--      where q.value ? 'line_id'
--        and not exists (
--          select 1
--          from jsonb_array_elements(coalesce(wo.line_items_invoicing_snapshot, wo.line_items, '[]'::jsonb)) as li(value)
--          where li.value ->> 'id' = q.value ->> 'line_id'
--        );
--
-- 3. Summorna ska vara oförändrade — migreringen byter nyckel, aldrig antal.
--
--      select wo.order_number, inv.round_number, inv.amount,
--             (select sum((x.value ->> 'quantity')::numeric)
--              from jsonb_array_elements(inv.line_quantities) as x(value)) as summa_antal
--      from public.crm_work_order_invoices inv
--      join public.crm_work_orders wo on wo.id = inv.work_order_id
--      order by wo.order_number, inv.round_number;
