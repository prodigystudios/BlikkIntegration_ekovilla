-- Månadsbudget för fakturerat per säljare.
--
-- CRM-översiktens veckotavla mäter veckans fakturerade belopp (ex moms, per faktura och
-- delfakturarunda) mot budget / 4, på samma sätt som de fem målen som redan finns. Utan en egen
-- kolumn stod fakturerat utan mål och kunde aldrig ge en stjärna.
--
-- Additiv: standardvärdet gör att befintliga rader och kod som inte känner till kolumnen fungerar
-- som förut, så migreringen kan gå före koden. Samma form och samma kontroll som systerkolumnerna
-- quote_value_target och order_value_target.
--
-- Inga nya grants: crm_goals behörigheter ligger på tabellnivå och omfattar nya kolumner.

alter table public.crm_goals
  add column if not exists invoiced_value_target numeric(12,2) not null default 0;

alter table public.crm_goals
  drop constraint if exists crm_goals_invoiced_value_target_check;

alter table public.crm_goals
  add constraint crm_goals_invoiced_value_target_check check (invoiced_value_target >= (0)::numeric);
