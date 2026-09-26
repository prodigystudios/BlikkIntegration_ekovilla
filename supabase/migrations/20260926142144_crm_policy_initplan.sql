-- CRM-policyerna anropar auth.uid() och has_permission() EN gång per fråga i stället för en gång per rad.
--
-- has_permission är SQL + SECURITY DEFINER + SET search_path och kan därför aldrig byggas in i frågan; skriven rakt i
-- en policy körs den för varje rad, med tre egna uppslag per anrop. auth.uid() likaså (det är Supabase advisors
-- auth_rls_initplan). Inslagen i en skalär delfråga blir anropet en InitPlan som körs en gång. Mätt lokalt
-- 2026-09-26 på crm_customers i prods storlek (2343 rader) som säljare: 20 ms -> 0,3 ms per helläsning.
--
-- Del 3 av advisor-genomgången, domän 1 av 3 (CRM: crm_*, fortnox_*, korjournal_*). Genererad med
-- scripts/supabase/policy-initplan-rewrite.sql mot den lokala databasen (i paritet med prod). Omskrivningen är rent
-- textuell och rör bara anrop med fasta argument:
--   auth.uid()                 -> (select auth.uid())
--   has_permission('x'::text)  -> (select has_permission('x'::text))
-- is_user_on_work_order(auth.uid(), id) och is_time_locked(...) får argument från raden och står kvar; bara ett
-- auth.uid() inuti dem skrivs om. Roller, kommando och PERMISSIVE/RESTRICTIVE rörs inte.
--
-- Ändrar INTE vem som ser eller skriver vad: `(select f())` är samma värde som `f()` när f saknar radargument och är
-- STABLE. Förkontrollen avbryter om någon policy i prod skiljer sig från den omskrivningen utgår från (då skrivs den
-- aldrig över); efterkontrollen bevisar att policyn med inslagningen borttagen är tecken för tecken originalet.
--
-- Dessutom två dubblettindex (advisor duplicate_index) — identiska tvillingar blir kvar:
--   crm_customers_customer_stage_idx  (tvilling: crm_customers_stage_idx, båda btree(customer_stage))
--   crm_work_orders_prospect_idx      (tvilling: crm_work_orders_prospect_id_idx, btree(prospect_id); oanvänd i
--                                      prod sedan statistiken nollställdes 2025-08-12)
--
-- Idempotent, kan köras om.

-- Förkontroll: policyerna ska vara exakt de som omskrivningen utgår från (med ev. inslagning borttagen).
do $pre$
declare
  r record;
  cur_q text;
  cur_c text;
begin
  for r in select * from (values
    ('crm_absence_types', 'crm_absence_types_insert', NULL, '552d8dedc45b92499c902141113b9cff'),
    ('crm_absence_types', 'crm_absence_types_update', '552d8dedc45b92499c902141113b9cff', '552d8dedc45b92499c902141113b9cff'),
    ('crm_ai_prospect_suggestions', 'crm_ai_prospect_suggestions_insert_admin_only', NULL, '370daa7ac8d1890f6de208aeb650f687'),
    ('crm_ai_prospect_suggestions', 'crm_ai_prospect_suggestions_select_visible', 'c431e7ac49f5fe67b9a963283913669c', NULL),
    ('crm_ai_prospect_suggestions', 'crm_ai_prospect_suggestions_update_admin_only', 'e40a540aaa9a119614f06c5eb89a896f', 'e40a540aaa9a119614f06c5eb89a896f'),
    ('crm_calc_settings', 'crm_calc_settings_insert', NULL, 'e1f73d5c604c3449bcb2bbbf85a58e6a'),
    ('crm_calc_settings', 'crm_calc_settings_select', '429e93947a01a4cada7fe7db3293a606', NULL),
    ('crm_calc_settings', 'crm_calc_settings_update', 'e1f73d5c604c3449bcb2bbbf85a58e6a', 'e1f73d5c604c3449bcb2bbbf85a58e6a'),
    ('crm_calls', 'crm_calls_insert_visible', NULL, 'd1dd386e45d18b49e3aece3b4fc0a333'),
    ('crm_calls', 'crm_calls_select_visible', '3ceb698ce99b73659f624af2786ce663', NULL),
    ('crm_calls', 'crm_calls_update_visible', '2915b5ccc31b49de60b41f0473f6ae15', 'd1dd386e45d18b49e3aece3b4fc0a333'),
    ('crm_customer_contacts', 'crm_customer_contacts_delete_sales_or_admin', '490198cba4af465ee57aed24e1d393ed', NULL),
    ('crm_customer_contacts', 'crm_customer_contacts_insert_sales_or_admin', NULL, '490198cba4af465ee57aed24e1d393ed'),
    ('crm_customer_contacts', 'crm_customer_contacts_select_visible', '511cbb206404ee411942943c20126f3c', NULL),
    ('crm_customer_contacts', 'crm_customer_contacts_update_sales_or_admin', '490198cba4af465ee57aed24e1d393ed', NULL),
    ('crm_customers', 'crm_customers_delete_admin', 'e1f73d5c604c3449bcb2bbbf85a58e6a', NULL),
    ('crm_customers', 'crm_customers_insert_sales_or_admin', NULL, '5a2318a920784672f02f9998944a2f85'),
    ('crm_customers', 'crm_customers_select_visible', '4947d68831cf824f2958916e8e60acef', NULL),
    ('crm_customers', 'crm_customers_update_assigned_or_admin', 'd8db0d3e9afeb4fa0356d1900c4f26c7', 'd8db0d3e9afeb4fa0356d1900c4f26c7'),
    ('crm_goals', 'crm_goals_insert_admin_only', NULL, '93347aacd46dbfbae3c7162cfff2d1c0'),
    ('crm_goals', 'crm_goals_select_visible', 'dcc59cdbec66d28655974ad1385bbaea', NULL),
    ('crm_goals', 'crm_goals_update_admin_only', '93347aacd46dbfbae3c7162cfff2d1c0', '93347aacd46dbfbae3c7162cfff2d1c0'),
    ('crm_internal_projects', 'crm_internal_projects_insert', NULL, '552d8dedc45b92499c902141113b9cff'),
    ('crm_internal_projects', 'crm_internal_projects_update', '552d8dedc45b92499c902141113b9cff', '552d8dedc45b92499c902141113b9cff'),
    ('crm_material_cost_articles', 'crm_material_cost_articles_delete', 'e1f73d5c604c3449bcb2bbbf85a58e6a', NULL),
    ('crm_material_cost_articles', 'crm_material_cost_articles_insert', NULL, 'e1f73d5c604c3449bcb2bbbf85a58e6a'),
    ('crm_material_cost_articles', 'crm_material_cost_articles_select', '429e93947a01a4cada7fe7db3293a606', NULL),
    ('crm_material_cost_articles', 'crm_material_cost_articles_update', 'e1f73d5c604c3449bcb2bbbf85a58e6a', 'e1f73d5c604c3449bcb2bbbf85a58e6a'),
    ('crm_productivity_rates', 'crm_productivity_rates_delete', 'e1f73d5c604c3449bcb2bbbf85a58e6a', NULL),
    ('crm_productivity_rates', 'crm_productivity_rates_insert', NULL, 'e1f73d5c604c3449bcb2bbbf85a58e6a'),
    ('crm_productivity_rates', 'crm_productivity_rates_select', '429e93947a01a4cada7fe7db3293a606', NULL),
    ('crm_productivity_rates', 'crm_productivity_rates_update', 'e1f73d5c604c3449bcb2bbbf85a58e6a', 'e1f73d5c604c3449bcb2bbbf85a58e6a'),
    ('crm_quotes', 'crm_quotes_delete_assigned_or_admin', '047f244b5e7e6589371bf1c21c24e57d', NULL),
    ('crm_quotes', 'crm_quotes_insert_admin_manage', NULL, '505b506e1aec95794e77f68d76b9e3ed'),
    ('crm_quotes', 'crm_quotes_insert_sales_or_admin', NULL, '8d91a9fa8a8255a0d28658964d9a662e'),
    ('crm_quotes', 'crm_quotes_select_visible', '407ed772afe395deb8b5412972ed0d88', NULL),
    ('crm_quotes', 'crm_quotes_update_visible', '047f244b5e7e6589371bf1c21c24e57d', '047f244b5e7e6589371bf1c21c24e57d'),
    ('crm_routing_rules', 'crm_routing_rules_manage_admin', 'f7c59d452c33c528eac72c041093aee2', 'f7c59d452c33c528eac72c041093aee2'),
    ('crm_routing_rules', 'crm_routing_rules_select_crm', 'e248ac00fadba7f00e27db0ef8cddaee', NULL),
    ('crm_time_approvals', 'crm_time_approvals_select', '2a1c8327d53fa0ec9d05b778e6951a03', NULL),
    ('crm_time_codes', 'crm_time_codes_insert', NULL, '552d8dedc45b92499c902141113b9cff'),
    ('crm_time_codes', 'crm_time_codes_update', '552d8dedc45b92499c902141113b9cff', '552d8dedc45b92499c902141113b9cff'),
    ('crm_time_compensations', 'crm_time_compensations_delete_own', '8f315d261bf05994091d1c3efc0e8d04', NULL),
    ('crm_time_compensations', 'crm_time_compensations_insert', NULL, '83c8627d454d53a739c08dfb48e80168'),
    ('crm_time_compensations', 'crm_time_compensations_select', 'd07ea997eba315900eca419fb72fd42e', NULL),
    ('crm_time_compensations', 'crm_time_compensations_update_own', '8f315d261bf05994091d1c3efc0e8d04', '8f315d261bf05994091d1c3efc0e8d04'),
    ('crm_time_entries', 'crm_time_entries_delete_own', '95ac5069544962dbd1296f963f638e45', NULL),
    ('crm_time_entries', 'crm_time_entries_insert', NULL, 'd53f4ef2d998f23c0a540f68df441a51'),
    ('crm_time_entries', 'crm_time_entries_select', 'e3df07d1274017383e4617541708bc2f', NULL),
    ('crm_time_entries', 'crm_time_entries_update_own', '95ac5069544962dbd1296f963f638e45', 'de2d093580434cddc0ece28915e53b85'),
    ('crm_time_entry_audit', 'crm_time_entry_audit_select', 'd07ea997eba315900eca419fb72fd42e', NULL),
    ('crm_work_order_comments', 'crm_wo_comments_delete_own', '987767fc803474751ce44a4235a12922', NULL),
    ('crm_work_order_comments', 'crm_wo_comments_insert_crew', NULL, '7466d0a9d9822662218d3d386905f8e1'),
    ('crm_work_order_comments', 'crm_wo_comments_select_crew', '14318e2211b2bb6b5cc62740fe66f661', NULL),
    ('crm_work_order_comments', 'crm_wo_comments_update_own', '987767fc803474751ce44a4235a12922', '987767fc803474751ce44a4235a12922'),
    ('crm_work_order_comments', 'crm_work_order_comments_delete_self_or_visible', '18e81a07a39c64a07accdb91f5766cc6', NULL),
    ('crm_work_order_comments', 'crm_work_order_comments_insert_self', NULL, '7a055d54ad0878ebbc2a4951ae69ae6e'),
    ('crm_work_order_comments', 'crm_work_order_comments_select_visible', '18e81a07a39c64a07accdb91f5766cc6', NULL),
    ('crm_work_order_files', 'crm_wo_files_delete', '592eb1bbd9dd0222c92a4e7274038841', NULL),
    ('crm_work_order_files', 'crm_wo_files_insert', NULL, 'f3391b46458a724d9857a48235ced033'),
    ('crm_work_order_files', 'crm_wo_files_select', '79cd9bdeed14e184cf155447bf5b93a0', NULL),
    ('crm_work_order_invoices', 'crm_wo_invoices_select_visible', 'df5fb3601a8623540ad9e212d634c8de', NULL),
    ('crm_work_order_kma_plans', 'crm_wo_kma_insert', NULL, 'dc0de2cfdd4d3f8028e84815cc87e60c'),
    ('crm_work_order_kma_plans', 'crm_wo_kma_select', 'df5b851e4bf05761c6f56edf4f00abe2', NULL),
    ('crm_work_order_progress_reports', 'crm_wo_progress_delete', 'c687a03934aad71c942f919772f8f16d', NULL),
    ('crm_work_order_progress_reports', 'crm_wo_progress_insert', NULL, 'e1e7f749604ad6b5940a4e493356cd43'),
    ('crm_work_order_progress_reports', 'crm_wo_progress_select', '30b3d57d4a885d537601174c541b25cf', NULL),
    ('crm_work_order_stages', 'crm_wo_stages_delete', '53a5fa671decf77a21edaf3256fef627', NULL),
    ('crm_work_order_stages', 'crm_wo_stages_insert', NULL, 'dc0de2cfdd4d3f8028e84815cc87e60c'),
    ('crm_work_order_stages', 'crm_wo_stages_select', 'c8b59e130995b3ac307848dd235c5ee9', NULL),
    ('crm_work_order_stages', 'crm_wo_stages_update', '53a5fa671decf77a21edaf3256fef627', '53a5fa671decf77a21edaf3256fef627'),
    ('crm_work_orders', 'crm_work_orders_delete_assigned_or_admin', '047f244b5e7e6589371bf1c21c24e57d', NULL),
    ('crm_work_orders', 'crm_work_orders_insert_admin_manage', NULL, '505b506e1aec95794e77f68d76b9e3ed'),
    ('crm_work_orders', 'crm_work_orders_insert_sales_or_admin', NULL, '32fcff6bd539600aabe5410934255a37'),
    ('crm_work_orders', 'crm_work_orders_select_crew', 'b8c75761e6fc9a75bdb2cdbe82b8075b', NULL),
    ('crm_work_orders', 'crm_work_orders_select_visible', 'd8d43d2b77e4becb14d8567e724ac74e', NULL),
    ('crm_work_orders', 'crm_work_orders_update_visible', '047f244b5e7e6589371bf1c21c24e57d', '047f244b5e7e6589371bf1c21c24e57d'),
    ('fortnox_article_favorites', 'fortnox_article_favorites_delete', '0ed4497bbfc22a553867760b76ede0cb', NULL),
    ('fortnox_article_favorites', 'fortnox_article_favorites_insert', NULL, '0ed4497bbfc22a553867760b76ede0cb'),
    ('fortnox_article_favorites', 'fortnox_article_favorites_select', '429e93947a01a4cada7fe7db3293a606', NULL),
    ('fortnox_article_work_description_defaults', 'fortnox_article_work_description_defaults_delete', '0ed4497bbfc22a553867760b76ede0cb', NULL),
    ('fortnox_article_work_description_defaults', 'fortnox_article_work_description_defaults_insert', NULL, '0ed4497bbfc22a553867760b76ede0cb'),
    ('fortnox_article_work_description_defaults', 'fortnox_article_work_description_defaults_select', '429e93947a01a4cada7fe7db3293a606', NULL),
    ('fortnox_articles_cache', 'CRM users can read fortnox_articles_cache', '2600e03739ddea1af87ffec02e42dd11', NULL),
    ('fortnox_integrations', 'Admins can read fortnox_integrations', '5f8606278ab086948a00e990adb1cb98', NULL),
    ('korjournal_trips', 'korjournal delete own', 'cb36b1a0770728f01fd9e4744dd633c9', NULL),
    ('korjournal_trips', 'korjournal read own', 'cb36b1a0770728f01fd9e4744dd633c9', NULL),
    ('korjournal_trips', 'korjournal update own', 'cb36b1a0770728f01fd9e4744dd633c9', 'cb36b1a0770728f01fd9e4744dd633c9'),
    ('korjournal_trips', 'korjournal write own', NULL, 'cb36b1a0770728f01fd9e4744dd633c9')
  ) as t(tbl, pol, md5_q, md5_c) loop
    select regexp_replace(regexp_replace(p.qual, '\( SELECT auth\.uid\(\) AS uid\)', 'auth.uid()', 'g'),
                          '\( SELECT (has_permission\(''[a-z0-9._]+''::text\)) AS has_permission\)', '\1', 'g'),
           regexp_replace(regexp_replace(p.with_check, '\( SELECT auth\.uid\(\) AS uid\)', 'auth.uid()', 'g'),
                          '\( SELECT (has_permission\(''[a-z0-9._]+''::text\)) AS has_permission\)', '\1', 'g')
      into cur_q, cur_c
      from pg_policies p where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol;
    if not found then
      raise exception 'policy saknas: %.%', r.tbl, r.pol;
    end if;
    if md5(cur_q) is distinct from r.md5_q or md5(cur_c) is distinct from r.md5_c then
      raise exception 'policy %.% skiljer sig från den omskrivningen utgår från — skriver inte över', r.tbl, r.pol;
    end if;
  end loop;
end $pre$;

alter policy crm_absence_types_insert on public.crm_absence_types
  with check ((select has_permission('time.reference.manage'::text)));

alter policy crm_absence_types_update on public.crm_absence_types
  using ((select has_permission('time.reference.manage'::text)))
  with check ((select has_permission('time.reference.manage'::text)));

alter policy crm_ai_prospect_suggestions_insert_admin_only on public.crm_ai_prospect_suggestions
  with check (((created_by = (select auth.uid())) AND (select has_permission('crm.aiprospect.manage'::text))));

alter policy crm_ai_prospect_suggestions_select_visible on public.crm_ai_prospect_suggestions
  using ((select has_permission('crm.aiprospect.read'::text)));

alter policy crm_ai_prospect_suggestions_update_admin_only on public.crm_ai_prospect_suggestions
  using ((select has_permission('crm.aiprospect.manage'::text)))
  with check ((select has_permission('crm.aiprospect.manage'::text)));

alter policy crm_calc_settings_insert on public.crm_calc_settings
  with check ((select has_permission('crm.admin'::text)));

alter policy crm_calc_settings_select on public.crm_calc_settings
  using ((select has_permission('crm.access'::text)));

alter policy crm_calc_settings_update on public.crm_calc_settings
  using ((select has_permission('crm.admin'::text)))
  with check ((select has_permission('crm.admin'::text)));

alter policy crm_calls_insert_visible on public.crm_calls
  with check ((((user_id = (select auth.uid())) AND (select has_permission('crm.call.write'::text)) AND ((prospect_id IS NULL) OR (EXISTS ( SELECT 1
   FROM crm_customers c
  WHERE ((c.id = crm_calls.prospect_id) AND (c.assigned_to = (select auth.uid()))))))) OR (select has_permission('crm.admin'::text))));

alter policy crm_calls_select_visible on public.crm_calls
  using (((user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM crm_customers c
  WHERE ((c.id = crm_calls.prospect_id) AND (c.assigned_to = (select auth.uid()))))) OR (select has_permission('crm.admin'::text))));

alter policy crm_calls_update_visible on public.crm_calls
  using (((user_id = (select auth.uid())) OR (select has_permission('crm.admin'::text))))
  with check ((((user_id = (select auth.uid())) AND (select has_permission('crm.call.write'::text)) AND ((prospect_id IS NULL) OR (EXISTS ( SELECT 1
   FROM crm_customers c
  WHERE ((c.id = crm_calls.prospect_id) AND (c.assigned_to = (select auth.uid()))))))) OR (select has_permission('crm.admin'::text))));

alter policy crm_customer_contacts_delete_sales_or_admin on public.crm_customer_contacts
  using ((EXISTS ( SELECT 1
   FROM crm_customers c
  WHERE ((c.id = crm_customer_contacts.customer_id) AND ((c.assigned_to = (select auth.uid())) OR (select has_permission('crm.customer.write'::text)))))));

alter policy crm_customer_contacts_insert_sales_or_admin on public.crm_customer_contacts
  with check ((EXISTS ( SELECT 1
   FROM crm_customers c
  WHERE ((c.id = crm_customer_contacts.customer_id) AND ((c.assigned_to = (select auth.uid())) OR (select has_permission('crm.customer.write'::text)))))));

alter policy crm_customer_contacts_select_visible on public.crm_customer_contacts
  using ((EXISTS ( SELECT 1
   FROM crm_customers c
  WHERE ((c.id = crm_customer_contacts.customer_id) AND ((c.assigned_to = (select auth.uid())) OR (select has_permission('crm.customer.read'::text)))))));

alter policy crm_customer_contacts_update_sales_or_admin on public.crm_customer_contacts
  using ((EXISTS ( SELECT 1
   FROM crm_customers c
  WHERE ((c.id = crm_customer_contacts.customer_id) AND ((c.assigned_to = (select auth.uid())) OR (select has_permission('crm.customer.write'::text)))))));

alter policy crm_customers_delete_admin on public.crm_customers
  using ((select has_permission('crm.admin'::text)));

alter policy crm_customers_insert_sales_or_admin on public.crm_customers
  with check (((created_by = (select auth.uid())) AND (select has_permission('crm.customer.write'::text))));

alter policy crm_customers_select_visible on public.crm_customers
  using ((((select auth.uid()) = assigned_to) OR (select has_permission('crm.customer.read'::text))));

alter policy crm_customers_update_assigned_or_admin on public.crm_customers
  using ((((select auth.uid()) = assigned_to) OR (select has_permission('crm.customer.write'::text))))
  with check ((((select auth.uid()) = assigned_to) OR (select has_permission('crm.customer.write'::text))));

alter policy crm_goals_insert_admin_only on public.crm_goals
  with check ((select has_permission('crm.goal.manage'::text)));

alter policy crm_goals_select_visible on public.crm_goals
  using (((user_id = (select auth.uid())) OR (select has_permission('crm.goal.manage'::text))));

alter policy crm_goals_update_admin_only on public.crm_goals
  using ((select has_permission('crm.goal.manage'::text)))
  with check ((select has_permission('crm.goal.manage'::text)));

alter policy crm_internal_projects_insert on public.crm_internal_projects
  with check ((select has_permission('time.reference.manage'::text)));

alter policy crm_internal_projects_update on public.crm_internal_projects
  using ((select has_permission('time.reference.manage'::text)))
  with check ((select has_permission('time.reference.manage'::text)));

alter policy crm_material_cost_articles_delete on public.crm_material_cost_articles
  using ((select has_permission('crm.admin'::text)));

alter policy crm_material_cost_articles_insert on public.crm_material_cost_articles
  with check ((select has_permission('crm.admin'::text)));

alter policy crm_material_cost_articles_select on public.crm_material_cost_articles
  using ((select has_permission('crm.access'::text)));

alter policy crm_material_cost_articles_update on public.crm_material_cost_articles
  using ((select has_permission('crm.admin'::text)))
  with check ((select has_permission('crm.admin'::text)));

alter policy crm_productivity_rates_delete on public.crm_productivity_rates
  using ((select has_permission('crm.admin'::text)));

alter policy crm_productivity_rates_insert on public.crm_productivity_rates
  with check ((select has_permission('crm.admin'::text)));

alter policy crm_productivity_rates_select on public.crm_productivity_rates
  using ((select has_permission('crm.access'::text)));

alter policy crm_productivity_rates_update on public.crm_productivity_rates
  using ((select has_permission('crm.admin'::text)))
  with check ((select has_permission('crm.admin'::text)));

alter policy crm_quotes_delete_assigned_or_admin on public.crm_quotes
  using ((((select auth.uid()) = assigned_to) OR (select has_permission('crm.admin'::text))));

alter policy crm_quotes_insert_admin_manage on public.crm_quotes
  with check (((created_by = (select auth.uid())) AND (select has_permission('crm.admin'::text))));

alter policy crm_quotes_insert_sales_or_admin on public.crm_quotes
  with check (((created_by = (select auth.uid())) AND (assigned_to = (select auth.uid())) AND (select has_permission('crm.offer.write'::text)) AND ((prospect_id IS NULL) OR (EXISTS ( SELECT 1
   FROM crm_customers c
  WHERE ((c.id = crm_quotes.prospect_id) AND (c.assigned_to = (select auth.uid()))))))));

alter policy crm_quotes_select_visible on public.crm_quotes
  using ((((select auth.uid()) = assigned_to) OR (select has_permission('crm.offer.read'::text))));

alter policy crm_quotes_update_visible on public.crm_quotes
  using ((((select auth.uid()) = assigned_to) OR (select has_permission('crm.admin'::text))))
  with check ((((select auth.uid()) = assigned_to) OR (select has_permission('crm.admin'::text))));

alter policy crm_routing_rules_manage_admin on public.crm_routing_rules
  using ((select has_permission('crm.routingrule.manage'::text)))
  with check ((select has_permission('crm.routingrule.manage'::text)));

alter policy crm_routing_rules_select_crm on public.crm_routing_rules
  using ((select has_permission('crm.routingrule.read'::text)));

alter policy crm_time_approvals_select on public.crm_time_approvals
  using (((user_id = (select auth.uid())) OR (select has_permission('time.approve'::text)) OR (select has_permission('time.entry.read.all'::text))));

alter policy crm_time_codes_insert on public.crm_time_codes
  with check ((select has_permission('time.reference.manage'::text)));

alter policy crm_time_codes_update on public.crm_time_codes
  using ((select has_permission('time.reference.manage'::text)))
  with check ((select has_permission('time.reference.manage'::text)));

alter policy crm_time_compensations_delete_own on public.crm_time_compensations
  using (((user_id = (select auth.uid())) AND (NOT is_time_locked((select auth.uid()), entry_date))));

alter policy crm_time_compensations_insert on public.crm_time_compensations
  with check (((user_id = (select auth.uid())) AND (select has_permission('time.entry.write'::text)) AND (NOT is_time_locked((select auth.uid()), entry_date))));

alter policy crm_time_compensations_select on public.crm_time_compensations
  using (((user_id = (select auth.uid())) OR (select has_permission('time.entry.read.all'::text))));

alter policy crm_time_compensations_update_own on public.crm_time_compensations
  using (((user_id = (select auth.uid())) AND (NOT is_time_locked((select auth.uid()), entry_date))))
  with check (((user_id = (select auth.uid())) AND (NOT is_time_locked((select auth.uid()), entry_date))));

alter policy crm_time_entries_delete_own on public.crm_time_entries
  using ((((user_id = (select auth.uid())) OR (select has_permission('time.entry.write.all'::text))) AND (NOT is_time_locked(user_id, work_date))));

alter policy crm_time_entries_insert on public.crm_time_entries
  with check (((user_id = (select auth.uid())) AND (select has_permission('time.entry.write'::text)) AND ((work_order_id IS NULL) OR (EXISTS ( SELECT 1
   FROM crm_work_orders w
  WHERE ((w.id = crm_time_entries.work_order_id) AND (w.assigned_to = (select auth.uid()))))) OR is_user_on_work_order((select auth.uid()), work_order_id) OR (select has_permission('crm.workorder.read'::text))) AND (NOT is_time_locked((select auth.uid()), work_date))));

alter policy crm_time_entries_select on public.crm_time_entries
  using (((user_id = (select auth.uid())) OR (select has_permission('time.entry.read.all'::text)) OR ((work_order_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM crm_work_orders w
  WHERE ((w.id = crm_time_entries.work_order_id) AND (w.assigned_to = (select auth.uid())))))) OR ((work_order_id IS NOT NULL) AND is_user_on_work_order((select auth.uid()), work_order_id))));

alter policy crm_time_entries_update_own on public.crm_time_entries
  using ((((user_id = (select auth.uid())) OR (select has_permission('time.entry.write.all'::text))) AND (NOT is_time_locked(user_id, work_date))))
  with check ((((user_id = (select auth.uid())) OR (select has_permission('time.entry.write.all'::text))) AND (NOT is_time_locked(user_id, work_date)) AND ((work_order_id IS NULL) OR (EXISTS ( SELECT 1
   FROM crm_work_orders w
  WHERE ((w.id = crm_time_entries.work_order_id) AND (w.assigned_to = (select auth.uid()))))) OR is_user_on_work_order((select auth.uid()), work_order_id) OR (select has_permission('crm.workorder.read'::text)))));

alter policy crm_time_entry_audit_select on public.crm_time_entry_audit
  using (((user_id = (select auth.uid())) OR (select has_permission('time.entry.read.all'::text))));

alter policy crm_wo_comments_delete_own on public.crm_work_order_comments
  using ((created_by = (select auth.uid())));

alter policy crm_wo_comments_insert_crew on public.crm_work_order_comments
  with check (((created_by = (select auth.uid())) AND is_user_on_work_order((select auth.uid()), work_order_id)));

alter policy crm_wo_comments_select_crew on public.crm_work_order_comments
  using (is_user_on_work_order((select auth.uid()), work_order_id));

alter policy crm_wo_comments_update_own on public.crm_work_order_comments
  using ((created_by = (select auth.uid())))
  with check ((created_by = (select auth.uid())));

alter policy crm_work_order_comments_delete_self_or_visible on public.crm_work_order_comments
  using (((created_by = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM crm_work_orders work_order
  WHERE ((work_order.id = crm_work_order_comments.work_order_id) AND ((work_order.assigned_to = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role))))))))));

alter policy crm_work_order_comments_insert_self on public.crm_work_order_comments
  with check (((created_by = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM crm_work_orders work_order
  WHERE ((work_order.id = crm_work_order_comments.work_order_id) AND ((work_order.assigned_to = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role))))))))));

alter policy crm_work_order_comments_select_visible on public.crm_work_order_comments
  using (((created_by = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM crm_work_orders work_order
  WHERE ((work_order.id = crm_work_order_comments.work_order_id) AND ((work_order.assigned_to = (select auth.uid())) OR (EXISTS ( SELECT 1
           FROM profiles p
          WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role))))))))));

alter policy crm_wo_files_delete on public.crm_work_order_files
  using (((created_by = (select auth.uid())) OR (select has_permission('crm.workorder.write'::text))));

alter policy crm_wo_files_insert on public.crm_work_order_files
  with check (((created_by = (select auth.uid())) AND ((select has_permission('crm.workorder.write'::text)) OR ((is_internal = false) AND is_user_on_work_order((select auth.uid()), work_order_id)))));

alter policy crm_wo_files_select on public.crm_work_order_files
  using (((created_by = (select auth.uid())) OR (select has_permission('crm.workorder.read'::text)) OR ((is_internal = false) AND is_user_on_work_order((select auth.uid()), work_order_id))));

alter policy crm_wo_invoices_select_visible on public.crm_work_order_invoices
  using ((EXISTS ( SELECT 1
   FROM crm_work_orders w
  WHERE ((w.id = crm_work_order_invoices.work_order_id) AND (((select auth.uid()) = w.assigned_to) OR (select has_permission('crm.workorder.read'::text)))))));

alter policy crm_wo_kma_insert on public.crm_work_order_kma_plans
  with check (((created_by = (select auth.uid())) AND (select has_permission('crm.workorder.write'::text))));

alter policy crm_wo_kma_select on public.crm_work_order_kma_plans
  using (((created_by = (select auth.uid())) OR (select has_permission('crm.workorder.read'::text))));

alter policy crm_wo_progress_delete on public.crm_work_order_progress_reports
  using (((select has_permission('crm.workorder.write'::text)) OR ((created_by = (select auth.uid())) AND is_user_on_work_order((select auth.uid()), work_order_id))));

alter policy crm_wo_progress_insert on public.crm_work_order_progress_reports
  with check (((created_by = (select auth.uid())) AND ((select has_permission('crm.workorder.write'::text)) OR is_user_on_work_order((select auth.uid()), work_order_id))));

alter policy crm_wo_progress_select on public.crm_work_order_progress_reports
  using (((created_by = (select auth.uid())) OR (select has_permission('crm.workorder.read'::text)) OR is_user_on_work_order((select auth.uid()), work_order_id)));

alter policy crm_wo_stages_delete on public.crm_work_order_stages
  using ((select has_permission('crm.workorder.write'::text)));

alter policy crm_wo_stages_insert on public.crm_work_order_stages
  with check (((created_by = (select auth.uid())) AND (select has_permission('crm.workorder.write'::text))));

alter policy crm_wo_stages_select on public.crm_work_order_stages
  using ((EXISTS ( SELECT 1
   FROM crm_work_orders w
  WHERE ((w.id = crm_work_order_stages.work_order_id) AND (((select auth.uid()) = w.assigned_to) OR (select has_permission('crm.workorder.read'::text)))))));

alter policy crm_wo_stages_update on public.crm_work_order_stages
  using ((select has_permission('crm.workorder.write'::text)))
  with check ((select has_permission('crm.workorder.write'::text)));

alter policy crm_work_orders_delete_assigned_or_admin on public.crm_work_orders
  using ((((select auth.uid()) = assigned_to) OR (select has_permission('crm.admin'::text))));

alter policy crm_work_orders_insert_admin_manage on public.crm_work_orders
  with check (((created_by = (select auth.uid())) AND (select has_permission('crm.admin'::text))));

alter policy crm_work_orders_insert_sales_or_admin on public.crm_work_orders
  with check (((created_by = (select auth.uid())) AND (select has_permission('crm.workorder.write'::text)) AND ((assigned_to = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM crm_quotes q
  WHERE ((q.id = crm_work_orders.quote_id) AND (q.status = 'won'::text) AND (q.assigned_to = crm_work_orders.assigned_to)))))));

alter policy crm_work_orders_select_crew on public.crm_work_orders
  using (is_user_on_work_order((select auth.uid()), id));

alter policy crm_work_orders_select_visible on public.crm_work_orders
  using ((((select auth.uid()) = assigned_to) OR (select has_permission('crm.workorder.read'::text))));

alter policy crm_work_orders_update_visible on public.crm_work_orders
  using ((((select auth.uid()) = assigned_to) OR (select has_permission('crm.admin'::text))))
  with check ((((select auth.uid()) = assigned_to) OR (select has_permission('crm.admin'::text))));

alter policy fortnox_article_favorites_delete on public.fortnox_article_favorites
  using ((select has_permission('crm.write'::text)));

alter policy fortnox_article_favorites_insert on public.fortnox_article_favorites
  with check ((select has_permission('crm.write'::text)));

alter policy fortnox_article_favorites_select on public.fortnox_article_favorites
  using ((select has_permission('crm.access'::text)));

alter policy fortnox_article_work_description_defaults_delete on public.fortnox_article_work_description_defaults
  using ((select has_permission('crm.write'::text)));

alter policy fortnox_article_work_description_defaults_insert on public.fortnox_article_work_description_defaults
  with check ((select has_permission('crm.write'::text)));

alter policy fortnox_article_work_description_defaults_select on public.fortnox_article_work_description_defaults
  using ((select has_permission('crm.access'::text)));

alter policy "CRM users can read fortnox_articles_cache" on public.fortnox_articles_cache
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = ANY (ARRAY['sales'::user_role, 'admin'::user_role]))))));

alter policy "Admins can read fortnox_integrations" on public.fortnox_integrations
  using ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = (select auth.uid())) AND (profiles.role = 'admin'::user_role)))));

alter policy "korjournal delete own" on public.korjournal_trips
  using ((((select auth.uid()))::text = user_id));

alter policy "korjournal read own" on public.korjournal_trips
  using ((((select auth.uid()))::text = user_id));

alter policy "korjournal update own" on public.korjournal_trips
  using ((((select auth.uid()))::text = user_id))
  with check ((((select auth.uid()))::text = user_id));

alter policy "korjournal write own" on public.korjournal_trips
  with check ((((select auth.uid()))::text = user_id));

-- Efterkontroll: med inslagningen borttagen är varje policy identisk med originalet, och inga oinslagna anrop
-- finns kvar på de berörda tabellerna (antal anrop minus antal inslagna ska vara noll).
do $post$
declare
  r record;
  cur_q text;
  cur_c text;
  bare int;
begin
  for r in select * from (values
    ('crm_absence_types', 'crm_absence_types_insert', NULL, '552d8dedc45b92499c902141113b9cff'),
    ('crm_absence_types', 'crm_absence_types_update', '552d8dedc45b92499c902141113b9cff', '552d8dedc45b92499c902141113b9cff'),
    ('crm_ai_prospect_suggestions', 'crm_ai_prospect_suggestions_insert_admin_only', NULL, '370daa7ac8d1890f6de208aeb650f687'),
    ('crm_ai_prospect_suggestions', 'crm_ai_prospect_suggestions_select_visible', 'c431e7ac49f5fe67b9a963283913669c', NULL),
    ('crm_ai_prospect_suggestions', 'crm_ai_prospect_suggestions_update_admin_only', 'e40a540aaa9a119614f06c5eb89a896f', 'e40a540aaa9a119614f06c5eb89a896f'),
    ('crm_calc_settings', 'crm_calc_settings_insert', NULL, 'e1f73d5c604c3449bcb2bbbf85a58e6a'),
    ('crm_calc_settings', 'crm_calc_settings_select', '429e93947a01a4cada7fe7db3293a606', NULL),
    ('crm_calc_settings', 'crm_calc_settings_update', 'e1f73d5c604c3449bcb2bbbf85a58e6a', 'e1f73d5c604c3449bcb2bbbf85a58e6a'),
    ('crm_calls', 'crm_calls_insert_visible', NULL, 'd1dd386e45d18b49e3aece3b4fc0a333'),
    ('crm_calls', 'crm_calls_select_visible', '3ceb698ce99b73659f624af2786ce663', NULL),
    ('crm_calls', 'crm_calls_update_visible', '2915b5ccc31b49de60b41f0473f6ae15', 'd1dd386e45d18b49e3aece3b4fc0a333'),
    ('crm_customer_contacts', 'crm_customer_contacts_delete_sales_or_admin', '490198cba4af465ee57aed24e1d393ed', NULL),
    ('crm_customer_contacts', 'crm_customer_contacts_insert_sales_or_admin', NULL, '490198cba4af465ee57aed24e1d393ed'),
    ('crm_customer_contacts', 'crm_customer_contacts_select_visible', '511cbb206404ee411942943c20126f3c', NULL),
    ('crm_customer_contacts', 'crm_customer_contacts_update_sales_or_admin', '490198cba4af465ee57aed24e1d393ed', NULL),
    ('crm_customers', 'crm_customers_delete_admin', 'e1f73d5c604c3449bcb2bbbf85a58e6a', NULL),
    ('crm_customers', 'crm_customers_insert_sales_or_admin', NULL, '5a2318a920784672f02f9998944a2f85'),
    ('crm_customers', 'crm_customers_select_visible', '4947d68831cf824f2958916e8e60acef', NULL),
    ('crm_customers', 'crm_customers_update_assigned_or_admin', 'd8db0d3e9afeb4fa0356d1900c4f26c7', 'd8db0d3e9afeb4fa0356d1900c4f26c7'),
    ('crm_goals', 'crm_goals_insert_admin_only', NULL, '93347aacd46dbfbae3c7162cfff2d1c0'),
    ('crm_goals', 'crm_goals_select_visible', 'dcc59cdbec66d28655974ad1385bbaea', NULL),
    ('crm_goals', 'crm_goals_update_admin_only', '93347aacd46dbfbae3c7162cfff2d1c0', '93347aacd46dbfbae3c7162cfff2d1c0'),
    ('crm_internal_projects', 'crm_internal_projects_insert', NULL, '552d8dedc45b92499c902141113b9cff'),
    ('crm_internal_projects', 'crm_internal_projects_update', '552d8dedc45b92499c902141113b9cff', '552d8dedc45b92499c902141113b9cff'),
    ('crm_material_cost_articles', 'crm_material_cost_articles_delete', 'e1f73d5c604c3449bcb2bbbf85a58e6a', NULL),
    ('crm_material_cost_articles', 'crm_material_cost_articles_insert', NULL, 'e1f73d5c604c3449bcb2bbbf85a58e6a'),
    ('crm_material_cost_articles', 'crm_material_cost_articles_select', '429e93947a01a4cada7fe7db3293a606', NULL),
    ('crm_material_cost_articles', 'crm_material_cost_articles_update', 'e1f73d5c604c3449bcb2bbbf85a58e6a', 'e1f73d5c604c3449bcb2bbbf85a58e6a'),
    ('crm_productivity_rates', 'crm_productivity_rates_delete', 'e1f73d5c604c3449bcb2bbbf85a58e6a', NULL),
    ('crm_productivity_rates', 'crm_productivity_rates_insert', NULL, 'e1f73d5c604c3449bcb2bbbf85a58e6a'),
    ('crm_productivity_rates', 'crm_productivity_rates_select', '429e93947a01a4cada7fe7db3293a606', NULL),
    ('crm_productivity_rates', 'crm_productivity_rates_update', 'e1f73d5c604c3449bcb2bbbf85a58e6a', 'e1f73d5c604c3449bcb2bbbf85a58e6a'),
    ('crm_quotes', 'crm_quotes_delete_assigned_or_admin', '047f244b5e7e6589371bf1c21c24e57d', NULL),
    ('crm_quotes', 'crm_quotes_insert_admin_manage', NULL, '505b506e1aec95794e77f68d76b9e3ed'),
    ('crm_quotes', 'crm_quotes_insert_sales_or_admin', NULL, '8d91a9fa8a8255a0d28658964d9a662e'),
    ('crm_quotes', 'crm_quotes_select_visible', '407ed772afe395deb8b5412972ed0d88', NULL),
    ('crm_quotes', 'crm_quotes_update_visible', '047f244b5e7e6589371bf1c21c24e57d', '047f244b5e7e6589371bf1c21c24e57d'),
    ('crm_routing_rules', 'crm_routing_rules_manage_admin', 'f7c59d452c33c528eac72c041093aee2', 'f7c59d452c33c528eac72c041093aee2'),
    ('crm_routing_rules', 'crm_routing_rules_select_crm', 'e248ac00fadba7f00e27db0ef8cddaee', NULL),
    ('crm_time_approvals', 'crm_time_approvals_select', '2a1c8327d53fa0ec9d05b778e6951a03', NULL),
    ('crm_time_codes', 'crm_time_codes_insert', NULL, '552d8dedc45b92499c902141113b9cff'),
    ('crm_time_codes', 'crm_time_codes_update', '552d8dedc45b92499c902141113b9cff', '552d8dedc45b92499c902141113b9cff'),
    ('crm_time_compensations', 'crm_time_compensations_delete_own', '8f315d261bf05994091d1c3efc0e8d04', NULL),
    ('crm_time_compensations', 'crm_time_compensations_insert', NULL, '83c8627d454d53a739c08dfb48e80168'),
    ('crm_time_compensations', 'crm_time_compensations_select', 'd07ea997eba315900eca419fb72fd42e', NULL),
    ('crm_time_compensations', 'crm_time_compensations_update_own', '8f315d261bf05994091d1c3efc0e8d04', '8f315d261bf05994091d1c3efc0e8d04'),
    ('crm_time_entries', 'crm_time_entries_delete_own', '95ac5069544962dbd1296f963f638e45', NULL),
    ('crm_time_entries', 'crm_time_entries_insert', NULL, 'd53f4ef2d998f23c0a540f68df441a51'),
    ('crm_time_entries', 'crm_time_entries_select', 'e3df07d1274017383e4617541708bc2f', NULL),
    ('crm_time_entries', 'crm_time_entries_update_own', '95ac5069544962dbd1296f963f638e45', 'de2d093580434cddc0ece28915e53b85'),
    ('crm_time_entry_audit', 'crm_time_entry_audit_select', 'd07ea997eba315900eca419fb72fd42e', NULL),
    ('crm_work_order_comments', 'crm_wo_comments_delete_own', '987767fc803474751ce44a4235a12922', NULL),
    ('crm_work_order_comments', 'crm_wo_comments_insert_crew', NULL, '7466d0a9d9822662218d3d386905f8e1'),
    ('crm_work_order_comments', 'crm_wo_comments_select_crew', '14318e2211b2bb6b5cc62740fe66f661', NULL),
    ('crm_work_order_comments', 'crm_wo_comments_update_own', '987767fc803474751ce44a4235a12922', '987767fc803474751ce44a4235a12922'),
    ('crm_work_order_comments', 'crm_work_order_comments_delete_self_or_visible', '18e81a07a39c64a07accdb91f5766cc6', NULL),
    ('crm_work_order_comments', 'crm_work_order_comments_insert_self', NULL, '7a055d54ad0878ebbc2a4951ae69ae6e'),
    ('crm_work_order_comments', 'crm_work_order_comments_select_visible', '18e81a07a39c64a07accdb91f5766cc6', NULL),
    ('crm_work_order_files', 'crm_wo_files_delete', '592eb1bbd9dd0222c92a4e7274038841', NULL),
    ('crm_work_order_files', 'crm_wo_files_insert', NULL, 'f3391b46458a724d9857a48235ced033'),
    ('crm_work_order_files', 'crm_wo_files_select', '79cd9bdeed14e184cf155447bf5b93a0', NULL),
    ('crm_work_order_invoices', 'crm_wo_invoices_select_visible', 'df5fb3601a8623540ad9e212d634c8de', NULL),
    ('crm_work_order_kma_plans', 'crm_wo_kma_insert', NULL, 'dc0de2cfdd4d3f8028e84815cc87e60c'),
    ('crm_work_order_kma_plans', 'crm_wo_kma_select', 'df5b851e4bf05761c6f56edf4f00abe2', NULL),
    ('crm_work_order_progress_reports', 'crm_wo_progress_delete', 'c687a03934aad71c942f919772f8f16d', NULL),
    ('crm_work_order_progress_reports', 'crm_wo_progress_insert', NULL, 'e1e7f749604ad6b5940a4e493356cd43'),
    ('crm_work_order_progress_reports', 'crm_wo_progress_select', '30b3d57d4a885d537601174c541b25cf', NULL),
    ('crm_work_order_stages', 'crm_wo_stages_delete', '53a5fa671decf77a21edaf3256fef627', NULL),
    ('crm_work_order_stages', 'crm_wo_stages_insert', NULL, 'dc0de2cfdd4d3f8028e84815cc87e60c'),
    ('crm_work_order_stages', 'crm_wo_stages_select', 'c8b59e130995b3ac307848dd235c5ee9', NULL),
    ('crm_work_order_stages', 'crm_wo_stages_update', '53a5fa671decf77a21edaf3256fef627', '53a5fa671decf77a21edaf3256fef627'),
    ('crm_work_orders', 'crm_work_orders_delete_assigned_or_admin', '047f244b5e7e6589371bf1c21c24e57d', NULL),
    ('crm_work_orders', 'crm_work_orders_insert_admin_manage', NULL, '505b506e1aec95794e77f68d76b9e3ed'),
    ('crm_work_orders', 'crm_work_orders_insert_sales_or_admin', NULL, '32fcff6bd539600aabe5410934255a37'),
    ('crm_work_orders', 'crm_work_orders_select_crew', 'b8c75761e6fc9a75bdb2cdbe82b8075b', NULL),
    ('crm_work_orders', 'crm_work_orders_select_visible', 'd8d43d2b77e4becb14d8567e724ac74e', NULL),
    ('crm_work_orders', 'crm_work_orders_update_visible', '047f244b5e7e6589371bf1c21c24e57d', '047f244b5e7e6589371bf1c21c24e57d'),
    ('fortnox_article_favorites', 'fortnox_article_favorites_delete', '0ed4497bbfc22a553867760b76ede0cb', NULL),
    ('fortnox_article_favorites', 'fortnox_article_favorites_insert', NULL, '0ed4497bbfc22a553867760b76ede0cb'),
    ('fortnox_article_favorites', 'fortnox_article_favorites_select', '429e93947a01a4cada7fe7db3293a606', NULL),
    ('fortnox_article_work_description_defaults', 'fortnox_article_work_description_defaults_delete', '0ed4497bbfc22a553867760b76ede0cb', NULL),
    ('fortnox_article_work_description_defaults', 'fortnox_article_work_description_defaults_insert', NULL, '0ed4497bbfc22a553867760b76ede0cb'),
    ('fortnox_article_work_description_defaults', 'fortnox_article_work_description_defaults_select', '429e93947a01a4cada7fe7db3293a606', NULL),
    ('fortnox_articles_cache', 'CRM users can read fortnox_articles_cache', '2600e03739ddea1af87ffec02e42dd11', NULL),
    ('fortnox_integrations', 'Admins can read fortnox_integrations', '5f8606278ab086948a00e990adb1cb98', NULL),
    ('korjournal_trips', 'korjournal delete own', 'cb36b1a0770728f01fd9e4744dd633c9', NULL),
    ('korjournal_trips', 'korjournal read own', 'cb36b1a0770728f01fd9e4744dd633c9', NULL),
    ('korjournal_trips', 'korjournal update own', 'cb36b1a0770728f01fd9e4744dd633c9', 'cb36b1a0770728f01fd9e4744dd633c9'),
    ('korjournal_trips', 'korjournal write own', NULL, 'cb36b1a0770728f01fd9e4744dd633c9')
  ) as t(tbl, pol, md5_q, md5_c) loop
    select regexp_replace(regexp_replace(p.qual, '\( SELECT auth\.uid\(\) AS uid\)', 'auth.uid()', 'g'),
                          '\( SELECT (has_permission\(''[a-z0-9._]+''::text\)) AS has_permission\)', '\1', 'g'),
           regexp_replace(regexp_replace(p.with_check, '\( SELECT auth\.uid\(\) AS uid\)', 'auth.uid()', 'g'),
                          '\( SELECT (has_permission\(''[a-z0-9._]+''::text\)) AS has_permission\)', '\1', 'g')
      into cur_q, cur_c
      from pg_policies p where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol;
    if md5(cur_q) is distinct from r.md5_q or md5(cur_c) is distinct from r.md5_c then
      raise exception 'policy %.% ändrades mer än inslagningen', r.tbl, r.pol;
    end if;
  end loop;

  select coalesce(sum(
           (length(e) - length(replace(e, 'auth.uid()', ''))) / length('auth.uid()')
         - (length(e) - length(replace(e, '( SELECT auth.uid() AS uid)', ''))) / length('( SELECT auth.uid() AS uid)')
         + (length(e) - length(replace(e, 'has_permission(', ''))) / length('has_permission(')
         - (length(e) - length(replace(e, '( SELECT has_permission(', ''))) / length('( SELECT has_permission(')
         ), 0) into bare
    from (select coalesce(qual, '') || ' ' || coalesce(with_check, '') as e
            from pg_policies
           where schemaname = 'public' and tablename ~ '^(crm_|fortnox_|korjournal_)') x;
  if bare <> 0 then
    raise exception '% oinslagna auth.uid()/has_permission()-anrop kvar', bare;
  end if;
end $post$;

-- Dubblettindexen. Tvillingen måste finnas och vara identisk innan dess dubblett tas bort.
do $idx$
begin
  if to_regclass('public.crm_customers_stage_idx') is null or to_regclass('public.crm_work_orders_prospect_id_idx') is null then
    raise exception 'tvillingindexet saknas — tar inte bort dubbletten';
  end if;
  if to_regclass('public.crm_customers_customer_stage_idx') is not null
     and regexp_replace(pg_get_indexdef(to_regclass('public.crm_customers_customer_stage_idx')), '^CREATE INDEX \S+', '')
         <> regexp_replace(pg_get_indexdef(to_regclass('public.crm_customers_stage_idx')), '^CREATE INDEX \S+', '') then
    raise exception 'crm_customers-indexen är inte identiska';
  end if;
  if to_regclass('public.crm_work_orders_prospect_idx') is not null
     and regexp_replace(pg_get_indexdef(to_regclass('public.crm_work_orders_prospect_idx')), '^CREATE INDEX \S+', '')
         <> regexp_replace(pg_get_indexdef(to_regclass('public.crm_work_orders_prospect_id_idx')), '^CREATE INDEX \S+', '') then
    raise exception 'crm_work_orders-indexen är inte identiska';
  end if;
end $idx$;

drop index if exists public.crm_customers_customer_stage_idx;
drop index if exists public.crm_work_orders_prospect_idx;
