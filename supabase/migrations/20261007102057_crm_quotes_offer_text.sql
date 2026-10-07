-- Egen text på offerten: fritext som säljaren skriver i offertformuläret och som skrivs ut på offertens PDF,
-- under artikelraderna och före summeringen (William 2026-10-07).
--
-- VARFÖR EN EGEN KOLUMN OCH INTE FORTNOX
--   * Fortnox `Remarks` bär företagets standard-offerttext. Skriver vi dit raderas den (se offers.ts).
--   * En textrad i radlistan följer med createorder till ordern och fakturan. Texten gäller bara offerten.
--   Därför ligger texten i CRM och läses direkt av vår egen PDF-rendering (documentPdfDesign.ts), på samma sätt som
--   ROT-sökanden. Nödutgången `?mall=fortnox` ger Fortnox egen mall och visar alltså inte texten.
--
-- BARA OFFERTEN. Texten följer inte med till arbetsordern eller orderbekräftelsen (William 2026-10-07).
--
-- GRANTS. Kolumnen omfattas av tabellens befintliga grants på crm_quotes (baslinjen, tabellnivå). Tabellen har inga
-- kolumnbehörigheter som en ny kolumn skulle behöva läggas till i. RLS är oförändrad.
--
-- ADDITIV. Koden läser kolumnen i crmQuoteSelect, så migreringen MÅSTE köras före koden. Annars svarar PostgREST
-- 400 på varje offertläsning.

alter table public.crm_quotes add column if not exists offer_text text;

comment on column public.crm_quotes.offer_text is
  'Egen text som skrivs ut på offertens PDF under artikelraderna. Skickas inte till Fortnox och följer inte med till arbetsordern.';
