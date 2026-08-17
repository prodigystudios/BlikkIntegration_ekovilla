-- Arbetsorder från VUNNEN offert: låt vilken säljare som helst skapa ordern, även när
-- offerten är någon annans.
--
-- Bakgrund. Ordern ärver offertens säljare (`assigned_to: quote.assigned_to`, se
-- createCrmWorkOrderFromQuote) så att offert → order → Fortnox "Vår referens" → topplistan
-- pekar på samma person hela vägen. Den gamla INSERT-policyn krävde samtidigt
-- `assigned_to = auth.uid()`, vilket gjorde de två kraven oförenliga: säljare B som tryckte
-- "Skapa arbetsorder" på säljare A:s vunna offert blockerades av RLS och fick en rå 500:a.
-- Är A sjukskriven stod ordern still tills en administratör hann göra den.
--
-- Ändringen. `assigned_to = auth.uid()` blir en av två grenar i stället för ett ovillkorligt
-- krav. Den andra grenen släpper igenom en order åt någon annan BARA när:
--   * ordern kommer från en offert (quote_id is not null),
--   * den offerten är vunnen, och
--   * ordern hamnar på exakt den offertens säljare.
-- Ingen kan alltså lägga en order på en godtycklig kollega — bara följa en vunnen offert dit
-- den redan pekar. `created_by = auth.uid()` och `crm.workorder.write` står kvar orörda.
--
-- Standalone-ordrar (quote_id null, 20260607_crm_work_orders_standalone.sql) matchar aldrig
-- exists-grenen och lyder därför fortfarande under `assigned_to = auth.uid()`. Oförändrat.
--
-- ⚠️ KÖR INTE FÖRE KODEN. Orderskapandet är två steg: raden skapas här, sedan skrivs
-- work_order_id tillbaka på offerten. Återlänkningen låg på sessionsklienten och stoppades av
-- offertens UPDATE-policy (assigned_to eller crm.admin) — idag onåbart eftersom INSERT:en faller
-- först. Öppnas INSERT:en medan återlänkningen fortfarande är sessionsscopad skapas ordern men
-- länkas aldrig: föräldralös order, offert som ser okonverterad ut, och nästa försök smäller på
-- unikhetsindexet på quote_id. Koden som flyttar återlänkningen till en elevated klient måste
-- vara ute först (eller i samma deploy).
--
-- Idempotent.

drop policy if exists crm_work_orders_insert_sales_or_admin on public.crm_work_orders;
create policy crm_work_orders_insert_sales_or_admin
  on public.crm_work_orders
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.has_permission('crm.workorder.write')
    and (
      assigned_to = auth.uid()
      or exists (
        select 1 from public.crm_quotes q
        where q.id = crm_work_orders.quote_id
          and q.status = 'won'
          -- Kvalificeringen är INTE kosmetisk: oskrivet binder `assigned_to` till q:s egen
          -- kolumn (inre scope vinner) och villkoret blir q.assigned_to = q.assigned_to — en
          -- tautologi som hade släppt igenom en order åt vem som helst.
          and q.assigned_to = crm_work_orders.assigned_to
      )
    )
  );

-- Not: exists-satsen läser crm_quotes som den anropande användaren, alltså genom offertens
-- egen SELECT-policy (`assigned_to = auth.uid() or crm.offer.read`). Varje roll som har
-- crm.workorder.write har också crm.offer.read i rollpaketet (20260608_permissions_model.sql),
-- så uppslaget är aldrig blint. Ingen security definer behövs.
