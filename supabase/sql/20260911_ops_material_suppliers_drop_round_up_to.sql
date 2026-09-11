-- Ångrar round_up_to: pallstorleken hör till MATERIALET, inte till leverantören.
--
-- BAKGRUND
-- 20260911_ops_material_suppliers_round_up_to.sql la en kolumn `round_up_to` på leverantören, med
-- antagandet att pallstorleken är ett kommersiellt villkor per fabrik. Det antagandet var fel.
--
-- ⚠️ PALLSTORLEKEN ÄR PACKNINGSFAKTA PER MATERIAL. Ekovilla packar 54 säckar à 14 kg (756 kg/pall),
-- Knauf 24 à 15,5 kg (372 kg/pall) — en pall bär alltså varken ett givet antal eller en given vikt,
-- och talet går inte att härleda ur säckvikten. Det följer MATERIALET oavsett vem som säljer det.
-- (Williams besked 2026-09-11.)
--
-- En leverantör kan bära flera material (kolumnen `materials` är en array), så EN siffra per
-- leverantör kunde aldrig bli rätt för mer än ett av dem. Talet bor nu i materialkatalogen
-- (lib/domains/crm/materials.ts, `sacksPerPallet`), bredvid säckvikten och lambdavärdet.
--
-- ⛔ ETT FULLT LASS MODELLERAS INTE, varken här eller i koden. Antalet pallar på en bil varierar,
-- och bilen kan dessutom ta med andra produkter — "fullt lass" är kapacitet, inte en
-- beställningsenhet. Att avgöra om bilen ska fyllas resten av vägen är ett mänskligt beslut.
--
-- LEDTIDEN STANNAR på ops_material_suppliers. Den ÄR ett villkor per fabrik.
--
-- DEPLOY-ORDNING
-- Kör EFTER 20260911_ops_material_suppliers_round_up_to.sql (det är dess kolumn som tas bort) och
-- EFTER 20260911_planning_supply_terms.sql, vars funktion returnerar kolumnen och därför måste
-- skrivas om i samma svep — `drop column` skulle annars lämna funktionen trasig vid nästa anrop.
-- Filen gör båda sakerna, i rätt ordning.
--
-- ⚠️ ORDNINGEN MOT KODEN ÄR FRI, men bara åt ett håll: den nya koden skickar INTE round_up_to och
-- läser inte fältet ur RPC:n, så den fungerar före som efter. Körs den här filen medan GAMMAL kod
-- är ute failar däremot varje leverantörssparning (PostgREST 400 på en kolumn som försvunnit).
-- Kör alltså filen SAMTIDIGT MED eller EFTER att koden är ute — inte före.
--
-- DESTRUKTIV, till skillnad från allt annat i den här serien: kolumnen och dess värden försvinner.
-- Det är ofarligt här och nu — kolumnen är ett dygn gammal, har aldrig lästs av kod i drift, och
-- registret innehåller en handfull rader. Kontrollera ändå punkt 1 nedan innan du kör.
--
-- Kör i Supabase SQL editor. Idempotent — kör den TVÅ gånger innan du litar på påståendet.
-- Inga tecken utanför BMP i den här filen.

-- ---------------------------------------------------------------------------
-- 1. Funktionen först: den namnger kolumnen och måste sluta göra det
-- ---------------------------------------------------------------------------
--
-- `create or replace` med ändrad returtyp kräver att den gamla släpps först — Postgres tillåter inte
-- att en OUT-kolumn försvinner i en replace. `drop function if exists` är därför inte städning utan
-- ett krav, och den måste komma före `drop column` så att inget anrop hinner träffa en funktion som
-- läser en kolumn som inte finns.
drop function if exists public.planning_supply_terms();

create function public.planning_supply_terms()
returns table (
  supplier_id    uuid,
  materials      text[],
  lead_time_days integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Board-nivå, till skillnad från tabellen: prognosen visas för alla som får se schemat, medan
  -- namn, mailadress, kontaktperson och telefon stannar bakom planning.depot.manage.
  --
  -- ⚠️ ALDRIG MED SERVICE-ROLE-KLIENTEN. has_permission nycklar allt på auth.uid(), som är null
  -- under service-role — grinden skulle då alltid neka. Sessionsklienten, alltid.
  if not public.has_permission('planning.schedule.read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Bara AKTIVA: en avvecklad leverantörs ledtid får inte styra en ny beställning.
  return query
    select s.id, s.materials, s.lead_time_days
    from public.ops_material_suppliers s
    where s.active;
end $$;

revoke all on function public.planning_supply_terms() from public;
grant execute on function public.planning_supply_terms() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Sedan kolumnen och dess constraint
-- ---------------------------------------------------------------------------

-- Constrainten först, explicit: `drop column` tar visserligen med sig den, men att skriva ut det
-- gör filen läsbar bakifrån — och en constraint som överlever en misslyckad kolumnborttagning är
-- svår att förstå senare.
alter table public.ops_material_suppliers
  drop constraint if exists ops_material_suppliers_round_up_to_check;

alter table public.ops_material_suppliers
  drop column if exists round_up_to;

-- ---------------------------------------------------------------------------
-- Verifiering (kör efter applicering)
-- ---------------------------------------------------------------------------
--
-- 1. FÖRE du kör: se vad som går förlorat. Är någon rad satt till något annat än 1 har någon
--    hunnit fylla i den, och värdet ska då flyttas till materialkatalogen i koden först:
--
--    select id, name, materials, round_up_to
--    from public.ops_material_suppliers where round_up_to is distinct from 1;
--
-- 2. Kolumnen är borta. Frågan ska ge noll rader:
--
--    select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'ops_material_suppliers'
--      and column_name = 'round_up_to';
--
-- 3. Funktionen returnerar TRE kolumner, och round_up_to är inte en av dem:
--
--    select p.proargnames
--    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'planning_supply_terms';
--    -- {supplier_id,materials,lead_time_days}
--
-- 4. ⚠️ Att ANROPA funktionen i SQL-editorn ska fortfarande fela med 'forbidden' (42501) — editorn
--    kör utan JWT, så auth.uid() är null och grinden nekar. Det är rätt svar, inte ett problem:
--
--    select * from public.planning_supply_terms();   -- ERROR: forbidden
--
-- 5. Ledtiden lever kvar på leverantören:
--
--    select id, name, lead_time_days from public.ops_material_suppliers order by name;
