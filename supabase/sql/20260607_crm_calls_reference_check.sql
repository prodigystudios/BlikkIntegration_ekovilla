-- Fix: logging a call against a CRM customer failed the reference check.
--
-- The original `crm_calls_reference_or_company_check` predated CRM customers and only
-- accepted prospect_id / opportunity_id / company_name as a valid "reference or company".
-- When a call is logged against a selected customer (customer_id set, no company_name),
-- the insert violated the constraint:
--   new row for relation "crm_calls" violates check constraint "crm_calls_reference_or_company_check"
--
-- The app layer (client guard + Zod refine) already treats customer_id as a valid
-- reference; this brings the DB constraint in line. Idempotent — drops by name and
-- recreates regardless of the previous expression.

alter table public.crm_calls
  drop constraint if exists crm_calls_reference_or_company_check;

alter table public.crm_calls
  add constraint crm_calls_reference_or_company_check
  check (
    prospect_id is not null
    or customer_id is not null
    or opportunity_id is not null
    or company_name is not null
  );
