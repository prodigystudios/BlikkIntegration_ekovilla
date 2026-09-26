-- Nya tabeller, sekvenser och funktioner i public är STÄNGDA för anon och authenticated tills en migrering
-- uttryckligen öppnar dem.
--
-- Supabase sätter default privileges så att allt rollen postgres skapar i public får ALLA rättigheter för anon,
-- authenticated och service_role, och Postgres ger dessutom EXECUTE till PUBLIC på varje ny funktion. En migrering
-- som glömmer sin revoke blir därför vidöppen, med bara den publika anon-nyckeln. Det har gett fyra hål på två
-- veckor: KMA-planen (#215), set_user_tags (#221), profiles.role (#226) och material_quality_samples (#233).
-- Efter den här filen är standarden den omvända: glömda grants ger "permission denied" lokalt, inte en öppen tabell
-- i prod.
--
-- * Tabeller, sekvenser och funktioner i public: anon och authenticated tas bort ur default privileges för postgres,
--   rollen som äger allt migreringarna skapar. service_role behåller allt; service-role-rutterna behöver det.
-- * EXECUTE till PUBLIC på nya funktioner är Postgres inbyggda standard och gäller ALLA scheman. En revoke per schema
--   når den inte (per-schema-värden läggs ovanpå de globala), så den tas bort globalt för postgres. Utanför public får
--   en ny postgres-funktion därmed ingen EXECUTE alls (inte heller service_role) förrän en migrering grantar den.
--   2026-09-26 äger postgres inga funktioner utanför public.
-- * Befintliga objekt rörs INTE; de har sina egna grants.
-- * supabase_admin:s default privileges rörs inte, och postgres kan inte ändra dem. Extensioner skapas av
--   supabase_admin och påverkas alltså inte: en ny extension i public är körbar för authenticated som förut (prövat).
--
-- Vad en ny migrering måste göra från och med nu (prövat lokalt 2026-09-26):
-- * Granta uttryckligen det sessionen behöver, t.ex. `grant select, insert on public.t to authenticated`. Vyer räknas
--   som tabeller och får inte heller något.
-- * EXECUTE till authenticated på varje ny funktion som sessionen utvärderar, direkt eller indirekt: RPC, RLS-policy,
--   kolumn-DEFAULT, CHECK, genererad kolumn, security_invoker-vy. Triggerfunktioner behöver ingen grant.
-- * drop + create av en vy eller funktion ger ett NYTT objekt utan grants (förr grantade standarden om det tyst).
--   `create or replace` behåller grantsen.
-- * identity-kolumner och uuid-default fungerar som förut. En serial/bigserial kräver
--   `grant usage on sequence ... to authenticated` för att sessionen ska kunna lägga in rader.
-- * `supabase db pull` tar inte med default privileges (baslinjen, pull:ad ur prod, har inga). En ny baslinje hade
--   tyst tappat den här filen; tests/supabase/migrationGrants.test.ts vaktar att kedjan fortfarande stänger, och
--   supabase/checks/parity.sql jämför default privileges mot prod.
--
-- Idempotent, kan köras om.

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;

-- Efterkontroll: skapa ett objekt av varje slag, pröva vad det faktiskt fick och ta bort det igen. Det prövar
-- effekten, inte hur pg_default_acl råkar vara skriven, och fångar också en grant som kommer den globala vägen eller
-- via PUBLIC. En kommaseparerad privilegielista svarar sant om NÅGOT av dem finns. Allt sker i migreringens
-- transaktion; misslyckas något finns inga provobjekt kvar.
do $$
declare
  who text;
begin
  if current_user <> 'postgres' then
    raise exception 'default privileges: körs som %, inte postgres — de gäller objekt som postgres skapar', current_user;
  end if;

  create table public.__default_acl_probe (id bigserial primary key);
  create view public.__default_acl_probe_v as select id from public.__default_acl_probe;
  create function public.__default_acl_probe_fn() returns int language sql as 'select 1';

  foreach who in array array['anon', 'authenticated'] loop
    if has_table_privilege(who, 'public.__default_acl_probe', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
      raise exception 'default privileges: en ny tabell ger fortfarande % rättigheter', who;
    end if;
    if has_table_privilege(who, 'public.__default_acl_probe_v', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') then
      raise exception 'default privileges: en ny vy ger fortfarande % rättigheter', who;
    end if;
    if has_sequence_privilege(who, 'public.__default_acl_probe_id_seq', 'USAGE,SELECT,UPDATE') then
      raise exception 'default privileges: en ny sekvens ger fortfarande % rättigheter', who;
    end if;
    if has_function_privilege(who, 'public.__default_acl_probe_fn()', 'EXECUTE') then
      raise exception 'default privileges: en ny funktion är fortfarande körbar för % (direkt eller via PUBLIC)', who;
    end if;
  end loop;

  if not has_table_privilege('service_role', 'public.__default_acl_probe', 'SELECT')
     or not has_table_privilege('service_role', 'public.__default_acl_probe', 'INSERT')
     or not has_table_privilege('service_role', 'public.__default_acl_probe_v', 'SELECT')
     or not has_sequence_privilege('service_role', 'public.__default_acl_probe_id_seq', 'USAGE')
     or not has_function_privilege('service_role', 'public.__default_acl_probe_fn()', 'EXECUTE') then
    raise exception 'default privileges: service_role har tappat rättigheter på nya objekt';
  end if;

  drop function public.__default_acl_probe_fn();
  drop view public.__default_acl_probe_v;
  drop table public.__default_acl_probe;
end $$;
