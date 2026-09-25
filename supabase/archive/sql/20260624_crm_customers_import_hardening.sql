-- Härdar Fortnox-kundimporten (2026-06-24).
--
-- 1. Relaxar identitets-constraintet. Fortnox har bara ETT Name-fält, så en
--    importerad privatkund kan legitimt sakna efternamn (enordsnamn). Det gamla
--    kravet "first_name OCH last_name" välte hela bulk-inserten på sådana rader.
--    Det striktare för-+efternamn-kravet ligger kvar i app-lagret (Zod) för
--    MANUELLT skapade privatkunder – DB-backstoppet behöver bara garantera att
--    raden har någon identitet alls.
--
-- 2. Lägger till customer_type_verified. Importen klassar företag-vs-privat via
--    en org.nr-heuristik (snabb, inga per-kund-anrop → ingen rate limit) och
--    sätter false; ett throttlat bakgrundspass hämtar Fortnox auktoritativa Type
--    och sätter true. Default true → befintliga + manuellt skapade kunder är
--    redan "verifierade" och rörs inte.

alter table public.crm_customers
  drop constraint if exists crm_customers_identity_check;

alter table public.crm_customers
  add constraint crm_customers_identity_check check (
    company_name is not null or first_name is not null or last_name is not null
  );

alter table public.crm_customers
  add column if not exists customer_type_verified boolean not null default true;

-- Index för att snabbt plocka overifierade kunder i verifieringspasset.
create index if not exists crm_customers_type_unverified_idx
  on public.crm_customers (fortnox_customer_id)
  where customer_type_verified = false;
