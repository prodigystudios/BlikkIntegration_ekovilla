-- När kundsynken mot Fortnox senast gick hela vägen.
--
-- BAKGRUND
-- Fortnox kundlista (GET /customers) har bara tio fält; omvänd moms, betalningsvillkor, prislista m.m. finns bara på
-- kundkortet (GET /customers/{nr}). Massynken läser därför listan och köar kunder för kortpasset, som hämtar ett kort
-- i taget under Fortnox anropsgräns. Att köa alla 1 658 kunder vid varje synk tar en kvart; att köa bara nya kunder
-- (som förut) gör att en ändring i Fortnox aldrig når CRM:et.
--
-- Listan kan filtreras på `lastmodified`. Den här kolumnen är tidpunkten att filtrera från:
--
--   customers_synced_at   när den senaste massynken STARTADE, sparad först när den gått klart utan att någon köad rad
--                         misslyckats. Null = okänt — då köas alla kunder, vilket också är vad första körningen efter
--                         2026-10-21 ska göra: reparera de fält som de gamla omsynkarna nollat. Raden försvinner när
--                         Fortnox kopplas från, och tidpunkten med den; nästa synk köar då alla igen.
--
-- ÅTKOMST
-- Oförändrad. Bara servern (service_role) läser och skriver raden; den har grant på hela tabellen, och det gäller den nya
-- kolumnen också. Efterkontrollen nedan prövar det.
--
-- Additiv: en ny kolumn som får vara null. Kan gå till prod före koden; koden köar alla kunder om kolumnen inte går att
-- läsa. Idempotent, kan köras om.

set lock_timeout = '5s';

alter table public.fortnox_integrations add column if not exists customers_synced_at timestamptz;

comment on column public.fortnox_integrations.customers_synced_at is
  'När den senaste hela kundsynken mot Fortnox startade. Null = köa alla kunder för kortpasset. Se lib/domains/fortnox/customers.ts.';

reset lock_timeout;

-- ------------------------------------------------------------------------------------------------ efterkontroll

do $$
begin
  if not has_column_privilege('service_role', 'public.fortnox_integrations', 'customers_synced_at', 'SELECT')
     or not has_column_privilege('service_role', 'public.fortnox_integrations', 'customers_synced_at', 'UPDATE') then
    raise exception 'kundsynken: service_role kan inte läsa eller skriva customers_synced_at';
  end if;
end $$;
