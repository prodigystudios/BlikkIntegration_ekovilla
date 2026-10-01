-- Den nya butikens egen prislista när inbjudan gått fram.
--
-- BAKGRUND
-- RESELLER_PORTAL_CRM_PLAN.md, 10b3. Williams beslut 2026-10-01:
--   - En ny partner vars kundkort har en egen lista i Fortnox får sin lista automatiskt när inbjudan gått fram, med den
--     senaste publiceringens giltighetsdatum.
--   - Det görs av ett steg i portalens cron (också "Skicka väntande nu"; testmiljön har ingen cron), EFTER att inbjudan
--     gått fram: kortet läses i Fortnox en gång per ny butik.
--   - Listan läggs till i den senaste publiceringen (samma löpnummer och datum), i butikens egen ordning i kön.
--   - Den byggs på den publicerade lista 160 med kortets grundpriser ovanpå, inte på 160 som den ser ut nu.
--
-- KOLUMNERNA (på inbjudan, eftersom det är inbjudans leverans som utlöser steget)
--   pricelist_settled_at    när steget var klart med butiken: listan köad, eller inget att göra (ingen publicering än,
--                           butiken redan med i den senaste, kortet på den gemensamma listan). Sätts på alla butikens
--                           inbjudningar som inte redan har värdet, så att ett nytt försök inte gör om det.
--   pricelist_attempted_at  senaste försöket som föll (Fortnox, databasen). Nästa försök tidigast 15 minuter senare.
--   pricelist_error         det försökets fel, för loggar och felsökning. Rensas när steget blir klart.
--
-- ÅTKOMST
-- Oförändrad. Sessionen läser inbjudningarna (select på hela tabellen, som omfattar de nya kolumnerna) men skriver dem
-- aldrig; servern (service_role) skriver. Efterkontrollen nedan prövar det.
--
-- Additiv: tre nya kolumner som får vara null. Kan gå till prod före koden. Idempotent, kan köras om.

set lock_timeout = '5s';

alter table public.crm_portal_reseller_invites add column if not exists pricelist_settled_at timestamptz;
alter table public.crm_portal_reseller_invites add column if not exists pricelist_attempted_at timestamptz;
alter table public.crm_portal_reseller_invites add column if not exists pricelist_error text;

alter table public.crm_portal_reseller_invites drop constraint if exists crm_portal_reseller_invites_pricelist_error_check;
alter table public.crm_portal_reseller_invites
  add constraint crm_portal_reseller_invites_pricelist_error_check check (
    pricelist_error is null or char_length(pricelist_error) <= 500
  );

reset lock_timeout;

-- ------------------------------------------------------------------------------------------------ efterkontroll

-- Pröva effekten: sessionen läser men skriver inte, anon når ingenting, servern läser och skriver.
do $$
declare
  inv constant text := 'public.crm_portal_reseller_invites';
  col text;
begin
  foreach col in array array['pricelist_settled_at', 'pricelist_attempted_at', 'pricelist_error'] loop
    if not has_column_privilege('authenticated', inv, col, 'SELECT') then
      raise exception 'inbjudans lista: authenticated kan inte läsa %', col;
    end if;
    if has_column_privilege('authenticated', inv, col, 'INSERT') or has_column_privilege('authenticated', inv, col, 'UPDATE') then
      raise exception 'inbjudans lista: authenticated kan skriva %', col;
    end if;
    if has_column_privilege('anon', inv, col, 'SELECT') or has_column_privilege('anon', inv, col, 'UPDATE') then
      raise exception 'inbjudans lista: anon har rättigheter på %', col;
    end if;
    if not has_column_privilege('service_role', inv, col, 'SELECT') or not has_column_privilege('service_role', inv, col, 'UPDATE') then
      raise exception 'inbjudans lista: service_role kan inte läsa eller skriva %', col;
    end if;
  end loop;
end $$;
