-- Testordern AO-20260819-9B8DD9 (prod) stämplades Avslutad med fakturanummer "0" av felet som #337 lagade:
-- en ofakturerad Fortnox-order svarar InvoiceReference "0", och "Fakturera allt" läste det som en faktura.
-- Ingen faktura finns. William bekräftade 2026-10-20 att det är en testorder från tiden före testmiljön.
--
-- Den sätts till Avbruten, så att den försvinner ur omsättningen (avbrutna order räknas inte) och ur
-- listorna, och det falska fakturanumret töms. Avslutad är en status systemet äger, så appen kan inte
-- ändra den; därför en migrering, och inte en ändring för hand i databasen.
--
-- Bara data, bara den raden, och bara så länge den bär just felet: på en databas utan raden (lokalt,
-- testmiljön) gör satsen ingenting, och den kan köras om utan verkan. Inga nya objekt, alltså inga grants.
-- Fortnox rörs inte: står order 45 öppen i Fortnox makuleras den där för hand.
--
-- Triggarna på crm_work_orders: set_timestamp sätter updated_at; crm_work_orders_mark_portal_job markerar
-- bara portaljobb med den här ordern (den har inget); crm_work_orders_guard_planned_days släpper igenom
-- eftersom planeringsdatumen inte ändras.

update public.crm_work_orders
   set status = 'cancelled',
       fortnox_invoice_number = null,
       fortnox_invoiced_at = null,
       fortnox_invoice_sync_status = 'not_synced'
 where order_number = 'AO-20260819-9B8DD9'
   and status = 'invoiced'
   and fortnox_invoice_number ~ '^\s*0+\s*$';
