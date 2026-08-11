-- ROT-ordrar som saknar fastighetsbeteckning — READ ONLY, ändrar ingenting.
--
-- Grinden i `createCrmWorkOrderFromQuote` (V3, 2026-08-11) gäller bara ordrar som skapas FRÅN OCH
-- MED nu. Den här frågan listar de som redan fanns: ROT är påslaget, men varken fastighetsbeteckning
-- eller BRF org.nr är ifyllt, så den som slutför fakturan i Fortnox har inget att skriva in i
-- husarbete-dialogen (fältet går inte att sätta via API:t — se FORTNOX_INTEGRATION.md 4b).
--
-- Läs `källa`: pushen läser ROT-uppgifterna från den KOPPLADE OFFERTEN (`linkedQuote.rot_details` i
-- orders.ts), inte från ordern. En order vars egen kopia är tom men vars offert har beteckningen är
-- alltså i sin ordning — därför särskiljs de.
--
-- Åtgärd per rad: fyll i beteckningen på offerten och spara om den (då re-synkas Fortnox-offerten),
-- eller skriv in den för hand i Fortnox innan fakturan slutförs. Ordrar som redan är fakturerade är
-- historik — kontrollera bara att ROT gick igenom.

select
  wo.order_number,
  wo.client_name,
  wo.status,
  wo.fortnox_order_number,
  wo.fortnox_invoice_number,
  wo.created_at::date as skapad,
  q.id as offert_id,
  case
    when q.id is null then 'ordern har ingen offert (standalone) — ROT pushas aldrig, kontrollera manuellt'
    else 'offertens rot_details saknar både beteckning och BRF org.nr'
  end as kalla,
  case
    when wo.fortnox_invoice_number is not null then 'FAKTURERAD — kontrollera om ROT gick igenom'
    when wo.fortnox_order_number is not null then 'LIGGER I FORTNOX — fyll i före fakturering'
    else 'EJ PUSHAD — fyll i på offerten och spara om'
  end as atgard
from public.crm_work_orders wo
left join public.crm_quotes q on q.id = wo.quote_id
where wo.status <> 'cancelled'
  -- ROT påslaget någonstans: på ordern (kopian) eller på offerten (det pushen faktiskt läser).
  and (coalesce(wo.rot_details->>'enabled', 'false') = 'true' or coalesce(q.rot_details->>'enabled', 'false') = 'true')
  -- ...och ingen av identifieringarna finns, varken på offerten eller på ordern.
  and coalesce(nullif(btrim(coalesce(q.rot_details->>'property_designation', '')), ''), '') = ''
  and coalesce(nullif(btrim(coalesce(q.rot_details->>'brf_org_number', '')), ''), '') = ''
  and coalesce(nullif(btrim(coalesce(wo.rot_details->>'property_designation', '')), ''), '') = ''
  and coalesce(nullif(btrim(coalesce(wo.rot_details->>'brf_org_number', '')), ''), '') = ''
order by
  (wo.fortnox_invoice_number is not null) desc,
  (wo.fortnox_order_number is not null) desc,
  wo.created_at desc;
