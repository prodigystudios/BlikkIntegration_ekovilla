-- Backfill: momsregnummer ur organisationsnumret för befintliga företagskunder.
--
-- BAKGRUND. Svenska momsnummer är deterministiska: SE + de tio siffrorna + 01. Härledningen
-- fanns bara i kundformulärens onChange och utlöstes därför bara när någon SKREV numret för
-- hand. Kom org.numret från Fortnox-importen eller tic-uppslaget hände ingenting, och det gör
-- det för nästan alla. Regeln bor numera i lib/domains/crm/orgNumber.ts och gäller på
-- skrivvägen, men den rättar bara NYA skrivningar — den här filen rättar beståndet.
--
-- SIMULERAT MOT PRODUKTIONSDATA 2026-09-02, två gånger:
--   1407  företagskunder totalt
--   1368  har org.nr men tomt momsnummer  (NULL *eller* tom sträng — åtta rader har '')
--   1364  av dem har ett kontrollsiffre-giltigt tiosiffrigt org.nr  <-- dessa uppdateras
--      4  hoppas över: ett nio-siffrigt, ett elva-siffrigt, två med fel kontrollsiffra
--     28  har redan ett momsnummer och rörs inte
--    587  av de 1364 är Fortnox-länkade
--
-- ⚠️ Den första simuleringen sa 1376 och var FEL: den räknade elva rader vars
-- organization_number är tom sträng (inte NULL) och missade åtta vars vat_number är ''.
-- Villkoren nedan är skrivna mot btrim() just därför. Kör steg 1 och jämför med 1364 innan
-- du kör steg 2 — stämmer det inte har beståndet ändrats sedan simuleringen.
--
-- ORDNING: spelar ingen roll. Filen är oberoende av koden — den nya regeln skriver aldrig
-- ovanpå ett ifyllt momsnummer, så den och den här filen kan inte trampa på varandra.
--
-- FORTNOX: den här filen pushar INGENTING. Den skriver bara i vår egen tabell. Notera att en
-- senare redigering av kunden heller inte pushar momsnumret, eftersom synk-jämförelsen bara
-- ser sitt eget before/after och båda då bär värdet. Fortnox får alltså numret först när
-- någon redigerar just momsfältet. Williams beslut 2026-09-02: CRM först, Fortnox separat.
--
-- Kör i Supabase SQL-editorn.

-- ── Luhn-kontrollen ──────────────────────────────────────────────────────────
-- Sessionslokal (pg_temp) med flit: den behövs bara medan filen körs och städas bort av sig
-- själv när fliken stängs. Att lägga den permanent hade skapat en andra sanning om vad ett
-- giltigt org.nr är, vid sidan av isValidSwedishOrgNumber i TypeScript.
--
-- ⚠️ CASE, inte AND: SQL garanterar ingen kortslutning, så ett `längdkoll AND summa`-uttryck
-- hade kunnat köra substr() på en för kort sträng och kasta på ''::int. CASE utvärderas i
-- ordning och är därför den säkra formen.
CREATE OR REPLACE FUNCTION pg_temp.luhn10_valid(p_digits text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_digits ~ '^\d{10}$' THEN
      (
        SELECT SUM(
          CASE
            WHEN i % 2 = 1 THEN
              CASE
                WHEN substr(p_digits, i, 1)::int * 2 > 9
                  THEN substr(p_digits, i, 1)::int * 2 - 9
                ELSE substr(p_digits, i, 1)::int * 2
              END
            ELSE substr(p_digits, i, 1)::int
          END
        )
        FROM generate_series(1, 10) AS i
      ) % 10 = 0
    ELSE false
  END;
$$;

-- ── Steg 1: verifiera FÖRE du skriver ────────────────────────────────────────
-- Förväntat: skulle_uppdateras = 1364, hoppas_over = 4, har_redan_moms = 28.
SELECT
  count(*) FILTER (
    WHERE (vat_number IS NULL OR btrim(vat_number) = '')
      AND pg_temp.luhn10_valid(regexp_replace(coalesce(organization_number, ''), '\D', '', 'g'))
  ) AS skulle_uppdateras,
  count(*) FILTER (
    WHERE (vat_number IS NULL OR btrim(vat_number) = '')
      AND btrim(coalesce(organization_number, '')) <> ''
      AND NOT pg_temp.luhn10_valid(regexp_replace(coalesce(organization_number, ''), '\D', '', 'g'))
  ) AS hoppas_over,
  count(*) FILTER (WHERE btrim(coalesce(vat_number, '')) <> '') AS har_redan_moms
FROM public.crm_customers
WHERE customer_type = 'business';

-- Vill du se de fyra som hoppas över (trasiga org.nr värda att rätta för hand):
-- SELECT id, company_name, organization_number
-- FROM public.crm_customers
-- WHERE customer_type = 'business'
--   AND (vat_number IS NULL OR btrim(vat_number) = '')
--   AND btrim(coalesce(organization_number, '')) <> ''
--   AND NOT pg_temp.luhn10_valid(regexp_replace(coalesce(organization_number, ''), '\D', '', 'g'));

-- ── Steg 2: skrivningen ──────────────────────────────────────────────────────
-- Samma villkor som räkningen ovan. Rör bara företagskunder vars momsfält är tomt och vars
-- org.nr är giltigt — ett ifyllt momsnummer skrivs aldrig över (suffixet 01 är standard men
-- inte givet: koncernregistreringar kan ha 02, 03 ...).
UPDATE public.crm_customers
SET vat_number = 'SE' || regexp_replace(organization_number, '\D', '', 'g') || '01'
WHERE customer_type = 'business'
  AND (vat_number IS NULL OR btrim(vat_number) = '')
  AND pg_temp.luhn10_valid(regexp_replace(coalesce(organization_number, ''), '\D', '', 'g'));

-- ── Steg 3: verifiera EFTER ──────────────────────────────────────────────────
-- Förväntat: kvar_utan_moms = 4 (de med trasigt org.nr) + eventuella utan org.nr alls.
SELECT
  count(*) FILTER (WHERE btrim(coalesce(vat_number, '')) <> '') AS har_moms,
  count(*) FILTER (WHERE btrim(coalesce(vat_number, '')) = '') AS kvar_utan_moms
FROM public.crm_customers
WHERE customer_type = 'business';
