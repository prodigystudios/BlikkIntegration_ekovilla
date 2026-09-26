-- Övriga policyer (startsida, dokument, information, kontakter, felanmälan, nyheter, skyddsronder, uppgifter,
-- appärenden m.fl.) anropar auth.uid(), has_permission() och de parameterlösa is_app_ticket_admin() /
-- is_fault_report_recipient() EN gång per fråga i stället för en gång per rad. De två senare är, som has_permission,
-- STABLE SECURITY DEFINER och kan aldrig byggas in i frågan.
--
-- Del 3 av advisor-genomgången, domän 3 av 3. Samma omskrivning, kontroller och skäl som CRM i
-- 20260926142144_crm_policy_initplan.sql — se den och scripts/supabase/policy-initplan-rewrite.sql. Genererad så här
-- mot den lokala databasen (i paritet med prod):
--   docker exec -i supabase_db_BlikkIntegration_ekovilla psql -U postgres -X -q -At \
--     -v tables='^(?!(crm_|fortnox_|korjournal_|ops_|planning_|offert_|blikk_|profiles$))' \
--     -f - < scripts/supabase/policy-initplan-rewrite.sql
--
-- Utanför med flit:
--   * crm_*/fortnox_*/korjournal_* och ops_* — domän 1 och 2.
--   * planning_*, offert_*, blikk_* — gamla /plannering, gamla kalkylatorn och Blikk; avgörs i legacy-städningen.
--   * profiles — dess RLS är skör (PROFILES_DIRECTORY_PLAN.md) och #226 lät policyerna vara med flit. Ett eget beslut.
--
-- Ändrar INTE vem som ser eller skriver vad: `(select f())` är samma värde som `f()` när f saknar radargument och är
-- STABLE. Förkontrollen avbryter om någon policy i prod skiljer sig från den omskrivningen utgår från; efterkontrollen
-- bevisar att policyn med inslagningen borttagen är tecken för tecken originalet.
--
-- Idempotent, kan köras om.

-- pg_get_expr skriver ut schemanamn för allt som inte syns i sökvägen; kontrollerna nedan förutsätter den här.
set local search_path = public, extensions;

-- Varje policys original (md5 av texten med all inslagning borttagen), som för- och efterkontrollen jämför mot.
create temp table __initplan_expected (tbl text, pol text, md5_q text, md5_c text);
insert into __initplan_expected values
  ('addresses', 'addr_admin_write', 'd95a2bb3c7f1c0549285160cd9eb8e05', 'd95a2bb3c7f1c0549285160cd9eb8e05'),
  ('addresses', 'addr_select_all', 'c234a76aa097b04184d7d2dd5eb550f4', NULL),
  ('app_changelog_entries', 'app_changelog_select', '0f71b4b8b91a8a71780f85dedb68bdf7', NULL),
  ('app_changelog_entries', 'app_changelog_write', 'fc0a5eb81ddd9bb5df9e64140fd0056e', 'fc0a5eb81ddd9bb5df9e64140fd0056e'),
  ('app_tickets', 'app_tickets_delete', 'fc0a5eb81ddd9bb5df9e64140fd0056e', NULL),
  ('app_tickets', 'app_tickets_insert', NULL, '98339647bd831fb2495e4a039e48b462'),
  ('app_tickets', 'app_tickets_select', 'f77017a4fd5b9e170fc6dacfc685bfb8', NULL),
  ('app_tickets', 'app_tickets_update', 'fc0a5eb81ddd9bb5df9e64140fd0056e', 'fc0a5eb81ddd9bb5df9e64140fd0056e'),
  ('contact_categories', 'cat_admin_write', 'd95a2bb3c7f1c0549285160cd9eb8e05', 'd95a2bb3c7f1c0549285160cd9eb8e05'),
  ('contact_categories', 'cat_select_all', 'c234a76aa097b04184d7d2dd5eb550f4', NULL),
  ('contacts', 'contacts_admin_write', 'd95a2bb3c7f1c0549285160cd9eb8e05', 'd95a2bb3c7f1c0549285160cd9eb8e05'),
  ('contacts', 'contacts_select_all', 'c234a76aa097b04184d7d2dd5eb550f4', NULL),
  ('dashboard_notes', 'dashboard_notes_modify_own', '19300d155780585259ede73ac370586c', '19300d155780585259ede73ac370586c'),
  ('dashboard_notes', 'dashboard_notes_select_own', '19300d155780585259ede73ac370586c', NULL),
  ('dashboard_push_subscriptions', 'dashboard_push_subscriptions_modify_own', '19300d155780585259ede73ac370586c', '19300d155780585259ede73ac370586c'),
  ('dashboard_push_subscriptions', 'dashboard_push_subscriptions_select_own', '19300d155780585259ede73ac370586c', NULL),
  ('dashboard_work_items', 'dashboard_work_items_modify_own', '19300d155780585259ede73ac370586c', '19300d155780585259ede73ac370586c'),
  ('dashboard_work_items', 'dashboard_work_items_select_own', '19300d155780585259ede73ac370586c', NULL),
  ('document_publication_receipts', 'document_publication_receipts_insert', NULL, 'c86a0f6414541dd36dfa45fde2e41227'),
  ('document_publication_receipts', 'document_publication_receipts_select', 'b5c72d87bbfe5cc56473c078d6e04f61', NULL),
  ('document_publication_receipts', 'document_publication_receipts_update', 'c86a0f6414541dd36dfa45fde2e41227', 'c86a0f6414541dd36dfa45fde2e41227'),
  ('document_publication_recipients', 'document_publication_recipients_admin_write', 'd95a2bb3c7f1c0549285160cd9eb8e05', 'd95a2bb3c7f1c0549285160cd9eb8e05'),
  ('document_publication_recipients', 'document_publication_recipients_select', 'e24115bc17dfe86039bd3f6c9bfa105b', NULL),
  ('document_publications', 'document_publications_admin_write', 'd95a2bb3c7f1c0549285160cd9eb8e05', 'd95a2bb3c7f1c0549285160cd9eb8e05'),
  ('document_publications', 'document_publications_select', '2f3c62dbbb455d916608bf5adfdbf289', NULL),
  ('documents_files', 'documents_files_admin_write', 'd95a2bb3c7f1c0549285160cd9eb8e05', 'd95a2bb3c7f1c0549285160cd9eb8e05'),
  ('documents_files', 'documents_files_select', 'c234a76aa097b04184d7d2dd5eb550f4', NULL),
  ('documents_folders', 'documents_folders_admin_write', 'd95a2bb3c7f1c0549285160cd9eb8e05', 'd95a2bb3c7f1c0549285160cd9eb8e05'),
  ('documents_folders', 'documents_folders_select', 'c234a76aa097b04184d7d2dd5eb550f4', NULL),
  ('employee_profile_details', 'employee_profile_details_select_self', '19300d155780585259ede73ac370586c', NULL),
  ('fault_report_recipients', 'fault_report_recipients_select', 'b5c72d87bbfe5cc56473c078d6e04f61', NULL),
  ('fault_report_recipients', 'fault_report_recipients_write', 'd95a2bb3c7f1c0549285160cd9eb8e05', 'd95a2bb3c7f1c0549285160cd9eb8e05'),
  ('fault_report_updates', 'fault_report_updates_insert', NULL, 'd0374d506a2583fcb7aab95ca93fde82'),
  ('fault_report_updates', 'fault_report_updates_select', 'e49d3c0bb70b385523ece8df8b770109', NULL),
  ('fault_reports', 'fault_reports_insert', NULL, '98339647bd831fb2495e4a039e48b462'),
  ('fault_reports', 'fault_reports_select', '699845a1bac99a881c59349dd9d1f386', NULL),
  ('fault_reports', 'fault_reports_update', 'dcd2799602a96596c908e2b3cba6902e', 'dcd2799602a96596c908e2b3cba6902e'),
  ('info_groups', 'info_groups_admin_write', 'd95a2bb3c7f1c0549285160cd9eb8e05', 'd95a2bb3c7f1c0549285160cd9eb8e05'),
  ('info_groups', 'info_groups_select', 'c234a76aa097b04184d7d2dd5eb550f4', NULL),
  ('info_section_images', 'info_section_images_admin_write', 'd95a2bb3c7f1c0549285160cd9eb8e05', 'd95a2bb3c7f1c0549285160cd9eb8e05'),
  ('info_section_images', 'info_section_images_select', 'c234a76aa097b04184d7d2dd5eb550f4', NULL),
  ('info_sections', 'info_sections_admin_write', 'd95a2bb3c7f1c0549285160cd9eb8e05', 'd95a2bb3c7f1c0549285160cd9eb8e05'),
  ('info_sections', 'info_sections_select', 'c234a76aa097b04184d7d2dd5eb550f4', NULL),
  ('news_items', 'news_items_admin_mod', 'd95a2bb3c7f1c0549285160cd9eb8e05', 'd95a2bb3c7f1c0549285160cd9eb8e05'),
  ('news_items', 'news_items_select_all', 'c234a76aa097b04184d7d2dd5eb550f4', NULL),
  ('notifications', 'notifications_select', 'b642f2dc16ef9d6d7df9f6a29fb52334', NULL),
  ('notifications', 'notifications_update', 'b642f2dc16ef9d6d7df9f6a29fb52334', 'b642f2dc16ef9d6d7df9f6a29fb52334'),
  ('safety_round_actions', 'safety_round_actions_delete', '57832211a7e9e83b8362a12c44abbdf1', NULL),
  ('safety_round_actions', 'safety_round_actions_insert', NULL, '57832211a7e9e83b8362a12c44abbdf1'),
  ('safety_round_actions', 'safety_round_actions_select', 'e65edbe157dac80582480a282ce4c78e', NULL),
  ('safety_round_actions', 'safety_round_actions_update', 'c3ec358c520dfe5b25431445c4b717c9', 'c3ec358c520dfe5b25431445c4b717c9'),
  ('safety_round_items', 'safety_round_items_delete', '76cf3596bb060507adb89f77f0a12fe2', NULL),
  ('safety_round_items', 'safety_round_items_insert', NULL, '76cf3596bb060507adb89f77f0a12fe2'),
  ('safety_round_items', 'safety_round_items_select', 'e65edbe157dac80582480a282ce4c78e', NULL),
  ('safety_round_items', 'safety_round_items_update', '57832211a7e9e83b8362a12c44abbdf1', '57832211a7e9e83b8362a12c44abbdf1'),
  ('safety_round_participants', 'safety_round_participants_delete', '57832211a7e9e83b8362a12c44abbdf1', NULL),
  ('safety_round_participants', 'safety_round_participants_insert', NULL, '57832211a7e9e83b8362a12c44abbdf1'),
  ('safety_round_participants', 'safety_round_participants_select', 'e65edbe157dac80582480a282ce4c78e', NULL),
  ('safety_round_participants', 'safety_round_participants_update', '57832211a7e9e83b8362a12c44abbdf1', '57832211a7e9e83b8362a12c44abbdf1'),
  ('safety_round_photos', 'safety_round_photos_delete', '57832211a7e9e83b8362a12c44abbdf1', NULL),
  ('safety_round_photos', 'safety_round_photos_select', 'e65edbe157dac80582480a282ce4c78e', NULL),
  ('safety_rounds', 'safety_rounds_delete', 'a33d67ffcc162e9d4d38a91923998edb', NULL),
  ('safety_rounds', 'safety_rounds_select', 'e65edbe157dac80582480a282ce4c78e', NULL),
  ('safety_rounds', 'safety_rounds_update', 'a33d67ffcc162e9d4d38a91923998edb', 'c3ec358c520dfe5b25431445c4b717c9'),
  ('tasks', 'tasks_delete_creator_only', '347ed40b6716699781c445c105ba5669', NULL),
  ('tasks', 'tasks_insert_self_creator', NULL, '987767fc803474751ce44a4235a12922'),
  ('tasks', 'tasks_select_assigned_or_created', 'ba2869cf88ec477792de51167e0c27b8', NULL),
  ('tasks', 'tasks_update_assigned_or_created', 'ba2869cf88ec477792de51167e0c27b8', 'ba2869cf88ec477792de51167e0c27b8'),
  ('user_permissions', 'user_permissions_select_self', '3a807491e0a912fbfbee0ffa087b82f6', NULL);

create function pg_temp.__initplan_unwrap(e text) returns text language sql immutable as $f$
  select regexp_replace(regexp_replace(regexp_replace(e,
           '\( SELECT (auth\.([a-z_]+)\(\)) AS \2\)', '\1', 'g'),
           '\( SELECT (has_permission\(''[a-z0-9._]+''::text\)) AS has_permission\)', '\1', 'g'),
           '\( SELECT ((is_[a-z_]+)\(\)) AS \2\)', '\1', 'g')
$f$;

-- Förkontroll: policyerna ska vara exakt de som omskrivningen utgår från (med ev. inslagning borttagen).
do $pre$
declare
  r record;
begin
  perform set_config('search_path', 'public, extensions', true);
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'is\_%' and pronargs = 0 and provolatile = 'v') then
    raise exception 'en parameterlös is_*()-funktion i public är VOLATILE — omskrivningen förutsätter STABLE';
  end if;
  for r in select e.*, p.policyname as found, p.qual, p.with_check
             from __initplan_expected e
             left join pg_policies p on p.schemaname = 'public' and p.tablename = e.tbl and p.policyname = e.pol loop
    if r.found is null then
      raise exception 'policy saknas: %.%', r.tbl, r.pol;
    end if;
    if md5(pg_temp.__initplan_unwrap(r.qual)) is distinct from r.md5_q
       or md5(pg_temp.__initplan_unwrap(r.with_check)) is distinct from r.md5_c then
      raise exception 'policy %.% skiljer sig från den omskrivningen utgår från — skriver inte över', r.tbl, r.pol;
    end if;
  end loop;
end $pre$;

alter policy addr_admin_write on public.addresses
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))));

alter policy addr_select_all on public.addresses
  using (((select auth.role()) = 'authenticated'::text));

alter policy app_changelog_select on public.app_changelog_entries
  using (((published_at IS NOT NULL) OR (select is_app_ticket_admin())));

alter policy app_changelog_write on public.app_changelog_entries
  using ((select is_app_ticket_admin()))
  with check ((select is_app_ticket_admin()));

alter policy app_tickets_delete on public.app_tickets
  using ((select is_app_ticket_admin()));

alter policy app_tickets_insert on public.app_tickets
  with check ((reporter_id = (select auth.uid())));

alter policy app_tickets_select on public.app_tickets
  using (((reporter_id = (select auth.uid())) OR (select is_app_ticket_admin())));

alter policy app_tickets_update on public.app_tickets
  using ((select is_app_ticket_admin()))
  with check ((select is_app_ticket_admin()));

alter policy cat_admin_write on public.contact_categories
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))));

alter policy cat_select_all on public.contact_categories
  using (((select auth.role()) = 'authenticated'::text));

alter policy contacts_admin_write on public.contacts
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))));

alter policy contacts_select_all on public.contacts
  using (((select auth.role()) = 'authenticated'::text));

alter policy dashboard_notes_modify_own on public.dashboard_notes
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

alter policy dashboard_notes_select_own on public.dashboard_notes
  using (((select auth.uid()) = user_id));

alter policy dashboard_push_subscriptions_modify_own on public.dashboard_push_subscriptions
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

alter policy dashboard_push_subscriptions_select_own on public.dashboard_push_subscriptions
  using (((select auth.uid()) = user_id));

alter policy dashboard_work_items_modify_own on public.dashboard_work_items
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

alter policy dashboard_work_items_select_own on public.dashboard_work_items
  using (((select auth.uid()) = user_id));

alter policy document_publication_receipts_insert on public.document_publication_receipts
  with check ((((user_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM document_publication_recipients r
  WHERE ((r.publication_id = document_publication_receipts.publication_id) AND (r.recipient_user_id = (select auth.uid())))))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role))))));

alter policy document_publication_receipts_select on public.document_publication_receipts
  using (((user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role))))));

alter policy document_publication_receipts_update on public.document_publication_receipts
  using ((((user_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM document_publication_recipients r
  WHERE ((r.publication_id = document_publication_receipts.publication_id) AND (r.recipient_user_id = (select auth.uid())))))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role))))))
  with check ((((user_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM document_publication_recipients r
  WHERE ((r.publication_id = document_publication_receipts.publication_id) AND (r.recipient_user_id = (select auth.uid())))))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role))))));

alter policy document_publication_recipients_admin_write on public.document_publication_recipients
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))));

alter policy document_publication_recipients_select on public.document_publication_recipients
  using (((recipient_user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role))))));

alter policy document_publications_admin_write on public.document_publications
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))));

alter policy document_publications_select on public.document_publications
  using (((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))) OR (EXISTS ( SELECT 1
   FROM document_publication_recipients r
  WHERE ((r.publication_id = document_publications.id) AND (r.recipient_user_id = (select auth.uid())))))));

alter policy documents_files_admin_write on public.documents_files
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))));

alter policy documents_files_select on public.documents_files
  using (((select auth.role()) = 'authenticated'::text));

alter policy documents_folders_admin_write on public.documents_folders
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))));

alter policy documents_folders_select on public.documents_folders
  using (((select auth.role()) = 'authenticated'::text));

alter policy employee_profile_details_select_self on public.employee_profile_details
  using (((select auth.uid()) = user_id));

alter policy fault_report_recipients_select on public.fault_report_recipients
  using (((user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role))))));

alter policy fault_report_recipients_write on public.fault_report_recipients
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))));

alter policy fault_report_updates_insert on public.fault_report_updates
  with check (((select is_fault_report_recipient()) AND (responder_id = (select auth.uid()))));

alter policy fault_report_updates_select on public.fault_report_updates
  using (((select is_fault_report_recipient()) OR (EXISTS ( SELECT 1
   FROM fault_reports fr
  WHERE ((fr.id = fault_report_updates.report_id) AND (fr.reporter_id = (select auth.uid())))))));

alter policy fault_reports_insert on public.fault_reports
  with check ((reporter_id = (select auth.uid())));

alter policy fault_reports_select on public.fault_reports
  using (((reporter_id = (select auth.uid())) OR (select is_fault_report_recipient())));

alter policy fault_reports_update on public.fault_reports
  using ((select is_fault_report_recipient()))
  with check ((select is_fault_report_recipient()));

alter policy info_groups_admin_write on public.info_groups
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))));

alter policy info_groups_select on public.info_groups
  using (((select auth.role()) = 'authenticated'::text));

alter policy info_section_images_admin_write on public.info_section_images
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))));

alter policy info_section_images_select on public.info_section_images
  using (((select auth.role()) = 'authenticated'::text));

alter policy info_sections_admin_write on public.info_sections
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))));

alter policy info_sections_select on public.info_sections
  using (((select auth.role()) = 'authenticated'::text));

alter policy news_items_admin_mod on public.news_items
  using ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))))
  with check ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (p.role = 'admin'::user_role)))));

alter policy news_items_select_all on public.news_items
  using (((select auth.role()) = 'authenticated'::text));

alter policy notifications_select on public.notifications
  using ((recipient_user_id = (select auth.uid())));

alter policy notifications_update on public.notifications
  using ((recipient_user_id = (select auth.uid())))
  with check ((recipient_user_id = (select auth.uid())));

alter policy safety_round_actions_delete on public.safety_round_actions
  using (((select has_permission('safety.round.write'::text)) AND safety_round_is_draft(round_id)));

alter policy safety_round_actions_insert on public.safety_round_actions
  with check (((select has_permission('safety.round.write'::text)) AND safety_round_is_draft(round_id)));

alter policy safety_round_actions_select on public.safety_round_actions
  using (((select has_permission('safety.round.read'::text)) OR (select has_permission('safety.round.write'::text))));

alter policy safety_round_actions_update on public.safety_round_actions
  using ((select has_permission('safety.round.write'::text)))
  with check ((select has_permission('safety.round.write'::text)));

alter policy safety_round_items_delete on public.safety_round_items
  using (((catalog_item_id IS NULL) AND (select has_permission('safety.round.write'::text)) AND safety_round_is_draft(round_id)));

alter policy safety_round_items_insert on public.safety_round_items
  with check (((catalog_item_id IS NULL) AND (select has_permission('safety.round.write'::text)) AND safety_round_is_draft(round_id)));

alter policy safety_round_items_select on public.safety_round_items
  using (((select has_permission('safety.round.read'::text)) OR (select has_permission('safety.round.write'::text))));

alter policy safety_round_items_update on public.safety_round_items
  using (((select has_permission('safety.round.write'::text)) AND safety_round_is_draft(round_id)))
  with check (((select has_permission('safety.round.write'::text)) AND safety_round_is_draft(round_id)));

alter policy safety_round_participants_delete on public.safety_round_participants
  using (((select has_permission('safety.round.write'::text)) AND safety_round_is_draft(round_id)));

alter policy safety_round_participants_insert on public.safety_round_participants
  with check (((select has_permission('safety.round.write'::text)) AND safety_round_is_draft(round_id)));

alter policy safety_round_participants_select on public.safety_round_participants
  using (((select has_permission('safety.round.read'::text)) OR (select has_permission('safety.round.write'::text))));

alter policy safety_round_participants_update on public.safety_round_participants
  using (((select has_permission('safety.round.write'::text)) AND safety_round_is_draft(round_id)))
  with check (((select has_permission('safety.round.write'::text)) AND safety_round_is_draft(round_id)));

alter policy safety_round_photos_delete on public.safety_round_photos
  using (((select has_permission('safety.round.write'::text)) AND safety_round_is_draft(round_id)));

alter policy safety_round_photos_select on public.safety_round_photos
  using (((select has_permission('safety.round.read'::text)) OR (select has_permission('safety.round.write'::text))));

alter policy safety_rounds_delete on public.safety_rounds
  using (((status = 'draft'::text) AND (select has_permission('safety.round.write'::text))));

alter policy safety_rounds_select on public.safety_rounds
  using (((select has_permission('safety.round.read'::text)) OR (select has_permission('safety.round.write'::text))));

alter policy safety_rounds_update on public.safety_rounds
  using (((status = 'draft'::text) AND (select has_permission('safety.round.write'::text))))
  with check ((select has_permission('safety.round.write'::text)));

alter policy tasks_delete_creator_only on public.tasks
  using (((select auth.uid()) = created_by));

alter policy tasks_insert_self_creator on public.tasks
  with check ((created_by = (select auth.uid())));

alter policy tasks_select_assigned_or_created on public.tasks
  using ((((select auth.uid()) = assigned_to) OR ((select auth.uid()) = created_by)));

alter policy tasks_update_assigned_or_created on public.tasks
  using ((((select auth.uid()) = assigned_to) OR ((select auth.uid()) = created_by)))
  with check ((((select auth.uid()) = assigned_to) OR ((select auth.uid()) = created_by)));

alter policy user_permissions_select_self on public.user_permissions
  using ((user_id = (select auth.uid())));

-- Efterkontroll: med inslagningen borttagen är varje policy identisk med originalet, och inga oinslagna anrop
-- finns kvar på de berörda tabellerna (alla anrop minus de inslagna ska vara noll).
do $post$
declare
  r record;
  bare int;
begin
  perform set_config('search_path', 'public, extensions', true);
  for r in select e.*, p.qual, p.with_check
             from __initplan_expected e
             join pg_policies p on p.schemaname = 'public' and p.tablename = e.tbl and p.policyname = e.pol loop
    if md5(pg_temp.__initplan_unwrap(r.qual)) is distinct from r.md5_q
       or md5(pg_temp.__initplan_unwrap(r.with_check)) is distinct from r.md5_c then
      raise exception 'policy %.% ändrades mer än inslagningen', r.tbl, r.pol;
    end if;
  end loop;

  select coalesce(sum(
           (select count(*) from regexp_matches(x.e, '(^|[^.a-z0-9_])(auth\.[a-z_]+\(\)|has_permission\(|is_[a-z_]+\(\))', 'g'))
         - (select count(*) from regexp_matches(x.e, '\( SELECT (auth\.[a-z_]+\(\)|has_permission\(|is_[a-z_]+\(\))', 'g'))
         ), 0) into bare
    from (select coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') as e
            from pg_policies p
           where p.schemaname = 'public' and p.tablename in (select tbl from __initplan_expected)) x;
  if bare <> 0 then
    raise exception '% oinslagna auth.*()/has_permission()/is_*()-anrop kvar', bare;
  end if;
end $post$;

drop function pg_temp.__initplan_unwrap(text);
drop table __initplan_expected;
