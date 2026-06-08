-- Completeness check for Phase 3 (run AFTER the three 20260609_rls_permissions_crm_*.sql).
-- Every role-based RLS predicate on the in-scope CRM tables should now route through
-- has_permission(). This lists each policy with two flags:
--   uses_has_permission   — true once swapped
--   still_references_role  — true if it STILL checks public.profiles.role directly (a miss)
-- Expectation: still_references_role = false for ALL rows. (The crm_calls/crm_quotes prospect
-- joins reference crm_customers.assigned_to, not profiles.role, so they don't trip the flag.)

select
  tablename,
  policyname,
  cmd,
  (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ilike '%has_permission%' as uses_has_permission,
  (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* '\mprofiles\M|\.role\M' as still_references_role
from pg_policies
where schemaname = 'public'
  and tablename in (
    'crm_calls', 'crm_customers', 'crm_customer_contacts',
    'crm_opportunities', 'crm_quotes', 'crm_work_orders', 'crm_goals',
    'crm_routing_rules', 'crm_ai_prospect_suggestions'
  )
order by still_references_role desc, tablename, policyname;
