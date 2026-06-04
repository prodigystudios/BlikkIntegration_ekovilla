-- Index för RLS-predikat och FK-kolumner efter prospect-migrationen.
-- Dessa stöder policyna i 20260604_crm_remove_legacy_prospects.sql som
-- gör correlated subqueries mot crm_customers.assigned_to.

create index if not exists crm_customers_assigned_to_idx on public.crm_customers (assigned_to);
create index if not exists crm_customers_customer_stage_idx on public.crm_customers (customer_stage);
create index if not exists crm_calls_prospect_id_idx on public.crm_calls (prospect_id);
create index if not exists crm_quotes_prospect_id_idx on public.crm_quotes (prospect_id);
create index if not exists crm_opportunities_prospect_id_idx on public.crm_opportunities (prospect_id);
create index if not exists crm_work_orders_prospect_id_idx on public.crm_work_orders (prospect_id);
