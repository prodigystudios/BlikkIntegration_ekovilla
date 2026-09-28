-- Butikens kundkort, kopplat för hand på en portalorder.
--
-- BAKGRUND
-- RESELLER_PORTAL_CRM_PLAN.md, fas 3c. Ett jobb från portalen utan kundnummer, eller med ett nummer som inte finns i
-- CRM:et, blir en arbetsorder utan kund, och når inte Fortnox. Den som har ordern (eller en admin) kopplar då butikens
-- kundkort på arbetsordern. Kopplingen gäller också butikens nästa jobb när portalens nummer saknas eller är okänt;
-- ett nummer som finns i CRM:et vinner alltid (William 2026-09-28). Butiken är kunden: det är butiken Ekovilla
-- fakturerar, och butiken fakturerar i sin tur sin kund.
--
--   customer_id           finns sedan fas 3a: kortet som gäller för butiken.
--   customer_linked_by/at satta = kortet kopplades för hand. Intaget låter då bli att nolla customer_id när portalens
--                         nummer saknas, och ger jobbet kortet. Ett nummer som finns i CRM:et ersätter kopplingen och
--                         nollar de här två.
--
-- Skrivs bara av service-rollen (kopplingen på arbetsordern och intaget). Ingen check mot customer_id: tas kortet bort
-- blir customer_id null (on delete set null) och en check hade stoppat borttagningen; intaget kräver båda.
--
-- ÅTKOMST
-- Tabellens läsning för crm.portal.manage (fas 3a) omfattar de nya kolumnerna. Sessionen får fortfarande bara ändra
-- säljaren (kolumngrant), aldrig kopplingen. Inga nya grants behövs; efterkontrollen nedan prövar det.
--
-- Additiv: två nya kolumner, inget befintligt ändras. Kan gå till prod före koden. Idempotent, kan köras om.

alter table public.crm_portal_resellers add column if not exists customer_linked_by uuid;
alter table public.crm_portal_resellers add column if not exists customer_linked_at timestamptz;

alter table public.crm_portal_resellers drop constraint if exists crm_portal_resellers_customer_linked_by_fkey;
alter table public.crm_portal_resellers
  add constraint crm_portal_resellers_customer_linked_by_fkey
  foreign key (customer_linked_by) references public.profiles(id) on delete set null;

-- ------------------------------------------------------------------------------------------------ efterkontroll

-- Pröva effekten: sessionen kan inte ändra kopplingen (bara säljaren, som förut); service_role kan.
do $$
declare
  col text;
begin
  foreach col in array array['customer_id', 'customer_linked_by', 'customer_linked_at'] loop
    if has_column_privilege('authenticated', 'public.crm_portal_resellers', col, 'UPDATE,INSERT') then
      raise exception 'butikens koppling: authenticated kan skriva crm_portal_resellers.%', col;
    end if;
    if has_column_privilege('anon', 'public.crm_portal_resellers', col, 'SELECT,UPDATE,INSERT') then
      raise exception 'butikens koppling: anon har rättigheter på crm_portal_resellers.%', col;
    end if;
    if not has_column_privilege('service_role', 'public.crm_portal_resellers', col, 'UPDATE') then
      raise exception 'butikens koppling: service_role kan inte skriva crm_portal_resellers.%', col;
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.crm_portal_resellers', 'seller_user_id', 'UPDATE') then
    raise exception 'butikens koppling: sessionen har tappat rätten att sätta säljaren';
  end if;
end $$;
