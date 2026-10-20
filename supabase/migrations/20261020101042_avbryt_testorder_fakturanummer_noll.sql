-- Testordern AO-20260819-9B8DD9 (prod) stämplades Avslutad med fakturanummer "0" av felet som #337 lagade:
-- en ofakturerad Fortnox-order svarar InvoiceReference "0", och "Fakturera allt" läste det som en faktura.
-- Ingen faktura finns. William bekräftade 2026-10-20 att det är en testorder från tiden före testmiljön, och
-- att Fortnox-order 45 redan är makulerad i Fortnox: bara CRM behöver rättas.
--
-- Den sätts till Avbruten, så att den försvinner ur omsättningen (avbrutna order räknas inte) och ur
-- listorna, och det falska fakturanumret töms. Avbruten stämmer med Fortnox, där ordern är makulerad.
-- Avslutad är en status systemet äger, så appen kan inte ändra den; därför en migrering, och inte en
-- ändring för hand i databasen.
--
-- Bara data, bara den raden, och bara så länge den bär just felet: på en databas utan raden (lokalt,
-- testmiljön) gör satsen ingenting, och den kan köras om utan verkan. Inga nya objekt, alltså inga grants.
-- Samma spärr som appens avbrytande (workOrderInvoicingStarted): en order vars fakturering börjat — en
-- delfakturarunda eller partial_invoicing_started_at — avbryts inte, för då försvinner riktiga belopp ur
-- rapporterna. Då rör satsen ingenting, och efterkontrollen nedan säger ifrån.
--
-- Triggarna på crm_work_orders: set_timestamp sätter updated_at; crm_work_orders_mark_portal_job markerar
-- bara portaljobb med den här ordern (den har inget); crm_work_orders_guard_planned_days släpper igenom
-- eftersom planeringsdatumen inte ändras.

update public.crm_work_orders wo
   set status = 'cancelled',
       fortnox_invoice_number = null,
       fortnox_invoiced_at = null,
       fortnox_invoice_sync_status = 'not_synced'
 where wo.order_number = 'AO-20260819-9B8DD9'
   and wo.status = 'invoiced'
   and wo.fortnox_invoice_number ~ '^\s*0+\s*$'
   and wo.partial_invoicing_started_at is null
   and not exists (select 1 from public.crm_work_order_invoices i where i.work_order_id = wo.id);

-- Efterkontroll: finns ordern får den inte längre bära "0". Utan den hade en sats som inte träffade något
-- (raden såg annorlunda ut än väntat) registrerats som körd i tysthet, med ordern kvar som Avslutad.
-- På en databas utan ordern finns inget att pröva.
do $$
begin
  if exists (
    select 1 from public.crm_work_orders
     where order_number = 'AO-20260819-9B8DD9'
       and fortnox_invoice_number ~ '^\s*0+\s*$'
  ) then
    raise exception 'testordern AO-20260819-9B8DD9 bär fortfarande fakturanummer "0" — raden såg inte ut som väntat (status, delfakturering?)';
  end if;
end $$;
