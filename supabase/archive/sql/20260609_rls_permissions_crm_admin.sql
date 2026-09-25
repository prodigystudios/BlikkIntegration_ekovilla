-- Phase 3c of the role→permission migration: the admin-managed CRM tables.
-- Behavior-preserving role→key swaps; the user_id ownership branch on goals is preserved.
--
-- Mapping:
--   crm_goals      : own row OR admin → user_id=auth.uid() OR has_permission('crm.goal.manage');
--                    admin-only writes → has_permission('crm.goal.manage')
--   crm_routing_rules: read (sales,admin) → has_permission('crm.routingrule.read');
--                      manage (admin)     → has_permission('crm.routingrule.manage')
--   crm_ai_prospect_suggestions: read (admin) → has_permission('crm.aiprospect.read');
--                                writes (admin) → has_permission('crm.aiprospect.manage')
--
-- Run AFTER 20260608_permissions_model.sql. Idempotent.

-- ── crm_goals ────────────────────────────────────────────────────────────────
drop policy if exists "crm_goals_select_visible" on public.crm_goals;
create policy "crm_goals_select_visible"
  on public.crm_goals
  for select
  using (
    user_id = auth.uid()
    or public.has_permission('crm.goal.manage')
  );

drop policy if exists "crm_goals_insert_admin_only" on public.crm_goals;
create policy "crm_goals_insert_admin_only"
  on public.crm_goals
  for insert
  to authenticated
  with check (
    public.has_permission('crm.goal.manage')
  );

drop policy if exists "crm_goals_update_admin_only" on public.crm_goals;
create policy "crm_goals_update_admin_only"
  on public.crm_goals
  for update
  using (
    public.has_permission('crm.goal.manage')
  )
  with check (
    public.has_permission('crm.goal.manage')
  );

-- ── crm_routing_rules ────────────────────────────────────────────────────────
drop policy if exists "crm_routing_rules_select_crm" on public.crm_routing_rules;
create policy "crm_routing_rules_select_crm"
  on public.crm_routing_rules
  for select
  using (
    public.has_permission('crm.routingrule.read')
  );

drop policy if exists "crm_routing_rules_manage_admin" on public.crm_routing_rules;
create policy "crm_routing_rules_manage_admin"
  on public.crm_routing_rules
  for all
  using (
    public.has_permission('crm.routingrule.manage')
  )
  with check (
    public.has_permission('crm.routingrule.manage')
  );

-- ── crm_ai_prospect_suggestions ──────────────────────────────────────────────
drop policy if exists "crm_ai_prospect_suggestions_select_visible" on public.crm_ai_prospect_suggestions;
create policy "crm_ai_prospect_suggestions_select_visible"
  on public.crm_ai_prospect_suggestions
  for select
  using (
    public.has_permission('crm.aiprospect.read')
  );

drop policy if exists "crm_ai_prospect_suggestions_insert_admin_only" on public.crm_ai_prospect_suggestions;
create policy "crm_ai_prospect_suggestions_insert_admin_only"
  on public.crm_ai_prospect_suggestions
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.has_permission('crm.aiprospect.manage')
  );

drop policy if exists "crm_ai_prospect_suggestions_update_admin_only" on public.crm_ai_prospect_suggestions;
create policy "crm_ai_prospect_suggestions_update_admin_only"
  on public.crm_ai_prospect_suggestions
  for update
  using (
    public.has_permission('crm.aiprospect.manage')
  )
  with check (
    public.has_permission('crm.aiprospect.manage')
  );
