-- Prislistorna per butik: en publicering kan bära en egen lista för varje butik.
--
-- BAKGRUND
-- RESELLER_PORTAL_CRM_PLAN.md, 10b2 (William 2026-10-01). En butik vars kundkort i Fortnox har en egen prislista får
-- en egen lista i portalen: lista 160 med kortets avvikande priser. Alla listor publiceras samtidigt, med samma
-- giltighetsdatum. En publicering är alla rader med samma löpnummer: den gemensamma listan och en rad per butik.
--
--   reseller_id      null = den gemensamma listan, som förut. Annars butikens id i portalen (crm_portal_resellers).
--                    Ingen främmande nyckel: historiken står kvar om butiken tas bort.
--   price_list_code  listan i Fortnox som priserna kommer från: 160, eller kortets egen. null på rader före 10b2.
--   nyckeln          den gemensamma som förut, `pricelist-<datum>-<hash>-<löpnummer>`. En butiks rad har butikens id
--                    sist: `pricelist-<datum>-<hash>-<löpnummer>-<id>`. Samma nyckel som händelsen i kön.
--
-- ÅTKOMST
-- Oförändrad: sessionen har select och insert på hela tabellen (crm.portal.manage, bara i eget namn), och det gäller
-- de nya kolumnerna också. Inga nya grants behövs; efterkontrollen nedan prövar det.
--
-- Additiv i effekt: två nya kolumner som får vara null, och en nyckelcheck som godtar allt den gamla godtog (en rad
-- utan butik har samma form som förut). Kan gå till prod före koden. Idempotent, kan köras om.

alter table public.crm_portal_pricelist_publications add column if not exists reseller_id text;
alter table public.crm_portal_pricelist_publications add column if not exists price_list_code text;

-- Samma tecken som portalens id:n och crm_portal_resellers.
alter table public.crm_portal_pricelist_publications drop constraint if exists crm_portal_pricelist_publications_reseller_id_check;
alter table public.crm_portal_pricelist_publications
  add constraint crm_portal_pricelist_publications_reseller_id_check check (
    reseller_id is null or reseller_id ~ '^(?!\.+$)[A-Za-z0-9._~-]{1,100}$'
  );

alter table public.crm_portal_pricelist_publications drop constraint if exists crm_portal_pricelist_publications_price_list_code_check;
alter table public.crm_portal_pricelist_publications
  add constraint crm_portal_pricelist_publications_price_list_code_check check (
    price_list_code is null or char_length(btrim(price_list_code)) between 1 and 50
  );

alter table public.crm_portal_pricelist_publications drop constraint if exists crm_portal_pricelist_publications_idempotency_key_check;
alter table public.crm_portal_pricelist_publications
  add constraint crm_portal_pricelist_publications_idempotency_key_check check (
    idempotency_key ~ '^pricelist-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f]{64}-[1-9][0-9]{0,8}(-[A-Za-z0-9._~-]{1,100})?$'
    and idempotency_key = 'pricelist-' || substring(idempotency_key from 11 for 10) || '-' || content_hash || '-' || sequence::text
      || coalesce('-' || reseller_id, '')
  );

-- Vilka butiker som har haft en egen lista: de får en egen lista vid varje publicering, också när kortet gått tillbaka
-- till 160 (lib/domains/portal/pricelistBatch.ts).
create index if not exists crm_portal_pricelist_publications_reseller_id_idx
  on public.crm_portal_pricelist_publications (reseller_id)
  where reseller_id is not null;

-- ------------------------------------------------------------------------------------------------ efterkontroll

-- Pröva effekten: sessionen kan läsa och lägga till de nya kolumnerna men aldrig ändra en publicering; anon ingenting.
do $$
declare
  pub constant text := 'public.crm_portal_pricelist_publications';
  col text;
begin
  foreach col in array array['reseller_id', 'price_list_code'] loop
    if not has_column_privilege('authenticated', pub, col, 'SELECT') or not has_column_privilege('authenticated', pub, col, 'INSERT') then
      raise exception 'prislistan per butik: authenticated kan inte läsa eller lägga till %', col;
    end if;
    if has_column_privilege('authenticated', pub, col, 'UPDATE') then
      raise exception 'prislistan per butik: authenticated kan ändra %', col;
    end if;
    if has_column_privilege('anon', pub, col, 'SELECT,INSERT,UPDATE') then
      raise exception 'prislistan per butik: anon har rättigheter på %', col;
    end if;
  end loop;
end $$;
