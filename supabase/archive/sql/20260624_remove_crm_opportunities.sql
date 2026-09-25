-- Tar bort Affärsmöjligheter (crm_opportunities) — ersatt av Säljtavlan, en
-- offertdriven kanban (2026-06-24). Opportunity-konceptet var redundant: varje
-- riktig affär blir ändå en offert, vars status nu driver säljflödet.
--
-- ⚠️ DESTRUKTIV: kopplad opportunity-data och offerters/samtals opportunity_id
-- försvinner permanent. Medvetet val. Kör gärna en `select count(*) from
-- public.crm_opportunities;` (+ ev. dump) först om datan kan behövas.
--
-- Permissions-nycklarna crm.opportunity.read/write lämnas kvar (vilande) för att
-- inte bryta paritets-asserten i 20260608_permissions_parity_assert.sql.

-- 1) Samtal: opportunity_id ingår i referens-checken, så den måste droppas och
--    återskapas utan kolumnen innan kolumnen kan tas bort.
alter table public.crm_calls
  drop constraint if exists crm_calls_reference_or_company_check;

alter table public.crm_calls
  drop column if exists opportunity_id;

alter table public.crm_calls
  add constraint crm_calls_reference_or_company_check
  check (
    prospect_id is not null
    or customer_id is not null
    or company_name is not null
  );

-- 2) Offert: släpp FK-kolumnen (FK följer med kolumnen).
alter table public.crm_quotes
  drop column if exists opportunity_id;

-- 3) Släpp tabellen (cascade tar trigger + RLS-policyer).
drop table if exists public.crm_opportunities cascade;
