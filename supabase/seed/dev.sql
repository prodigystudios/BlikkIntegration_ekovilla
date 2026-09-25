-- Påhittad testdata för den lokala miljön och testmiljön. ALDRIG riktiga personer eller kunder.
--
-- Körs efter reference.sql (behörigheterna i role_permissions kommer därifrån) och
-- articles.local.sql, i den ordning supabase/config.toml ([db.seed] sql_paths) anger.
--
-- Inloggning — samma lösenord för alla: ekovilla-test
--   admin@example.test     admin
--   saljare@example.test   sales
--   konsult@example.test   konsult
--   ekonomi@example.test   ekonomi
--   montor@example.test    member
--
-- 19121212-1212 är Skatteverkets välkända testpersonnummer (Tolvan Tolvansson). 559999-9991 är ett
-- påhittat, Luhn-giltigt organisationsnummer. Adresser och telefonnummer är påhittade;
-- e-post ligger på example.test, som aldrig kan levereras (RFC 2606).
--
-- Id:na är fasta så att raderna känns igen, och så att offerternas genererade quote_number
-- (OFF- + id:ts första åtta tecken) blir olika.

-- ---------------------------------------------------------------------------
-- Användare: auth.users + auth.identities. Triggern on_auth_user_created skapar profiles-raden;
-- rollen sätts efteråt.
-- ---------------------------------------------------------------------------

create temporary table seed_users (id uuid, email text, full_name text, role public.user_role);
insert into seed_users values
  ('00000000-0000-4000-8000-000000000001', 'admin@example.test',   'Test Admin',     'admin'),
  ('00000000-0000-4000-8000-000000000002', 'saljare@example.test', 'Test Säljare',   'sales'),
  ('00000000-0000-4000-8000-000000000003', 'konsult@example.test', 'Test Konsult',   'konsult'),
  ('00000000-0000-4000-8000-000000000004', 'ekonomi@example.test', 'Test Ekonomi',   'ekonomi'),
  ('00000000-0000-4000-8000-000000000005', 'montor@example.test',  'Test Montör',    'member');

-- De fyra token-kolumnerna saknar default och måste vara '' — GoTrue kan inte läsa NULL i dem.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000', s.id, 'authenticated', 'authenticated', s.email,
  extensions.crypt('ekovilla-test', extensions.gen_salt('bf')), now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  jsonb_build_object('full_name', s.full_name), now(), now(),
  '', '', '', ''
from seed_users s;

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  gen_random_uuid(), s.id, s.id::text,
  jsonb_build_object('sub', s.id::text, 'email', s.email, 'email_verified', true),
  'email', now(), now(), now()
from seed_users s;

update public.profiles p
   set role = s.role,
       phone = '070-000 00 0' || right(s.id::text, 1)
  from seed_users s
 where p.id = s.id;

drop table seed_users;

-- ---------------------------------------------------------------------------
-- Kunder: ett företag, en privatkund med personnummer, en privat prospekt utan.
-- Säljaren äger alla tre.
-- ---------------------------------------------------------------------------

insert into public.crm_customers (
  id, customer_type, customer_stage, company_name, organization_number, first_name, last_name,
  personal_number, visit_address, invoice_address, email, phone, assigned_to, created_by
) values
  ('10000000-0000-4000-8000-000000000001', 'business', 'customer',
   'Testbolaget Bygg AB', '559999-9991', null, null, null,
   '{"street": "Testgatan 1", "postal_code": "111 11", "city": "Teststad"}',
   '{"street": "Box 1", "postal_code": "111 11", "city": "Teststad"}',
   'info@example.test', '08-000 00 01',
   '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000002', 'private', 'customer',
   null, null, 'Tolvan', 'Tolvansson', '19121212-1212',
   '{"street": "Tolvvägen 12", "postal_code": "121 21", "city": "Teststad"}',
   null,
   'tolvan@example.test', '070-000 00 12',
   '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003', 'private', 'prospect',
   null, null, 'Testa', 'Testsson', null,
   '{"street": "Provstigen 3", "postal_code": "333 33", "city": "Provby"}',
   null,
   'testa@example.test', '070-000 00 33',
   '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002');

insert into public.crm_customer_contacts (customer_id, name, role, phone, email, is_primary) values
  ('10000000-0000-4000-8000-000000000001', 'Kim Kontakt', 'Projektledare', '070-000 00 21', 'kim@example.test', true);

-- ---------------------------------------------------------------------------
-- Offerter: ett utkast till företaget, en vunnen ROT-offert till Tolvan som blivit arbetsorder.
-- Radernas belopp är strängar, precis som appens Zod-schema lagrar dem. pricing_mode sätts alltid
-- uttryckligen: saknas det läser lineItemQuantity raden som m³ men Zod som styck.
-- amount är BRUTTO (inkl. moms); pricing_summary bär netto, moms och totalt.
-- ---------------------------------------------------------------------------

insert into public.crm_quotes (
  id, customer_id, customer_name, project_name, description, amount, status, quote_type,
  customer_snapshot, pricing_summary, rot_details, internal_handoff, vat_percent, line_items,
  customer_source, created_by, assigned_to
) values
  ('a1000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   'Testbolaget Bygg AB', 'Tilläggsisolering vind, Testgatan 1', 'Påhittad offert för test.',
   32375.00, 'draft', 'business',
   '{"customer_name": "Testbolaget Bygg AB", "company_name": "Testbolaget Bygg AB",
     "organization_number": "559999-9991", "contact_name": "Kim Kontakt", "email": "kim@example.test",
     "phone": "070-000 00 21", "street_address": "Testgatan 1", "postal_code": "111 11",
     "city": "Teststad", "reverse_vat": false}',
   '{"subtotal": 25900, "vat": 6475, "total": 32375}',
   '{"enabled": false}',
   '{"desired_installation_date": null, "handoff_notes": null, "work_scope": null}',
   25,
   '[{"id": "40000000-0000-4000-8000-000000000001", "construction": "vind", "pricing_mode": "m3",
      "m2": "120", "thickness_mm": "300", "quantity": "36", "unit_price": "650", "auto_price": false,
      "article_id": null, "article_number": null, "article_name": "Lösull vind",
      "article_unit_name": "m3", "article_price": 650, "article_note": null, "discount_percent": "",
      "line_note": "", "is_rot_work": false, "house_work_type": "CONSTRUCTION", "labor_cost": "",
      "density": "30", "include_in_description": false},
     {"id": "40000000-0000-4000-8000-000000000002", "construction": "", "pricing_mode": "item",
      "m2": "", "thickness_mm": "", "quantity": "1", "unit_price": "2500", "auto_price": false,
      "article_id": null, "article_number": null, "article_name": "Etablering",
      "article_unit_name": "st", "article_price": 2500, "article_note": null, "discount_percent": "",
      "line_note": "", "is_rot_work": false, "house_work_type": "CONSTRUCTION", "labor_cost": "",
      "density": "", "include_in_description": true}]',
   '{"kind": "local", "sync_intent": "local_only"}',
   '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002'),
  ('a2000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002',
   'Tolvan Tolvansson', 'Isolering snedtak, Tolvvägen 12', 'Påhittad offert för test.',
   15000.00, 'won', 'private',
   '{"customer_name": "Tolvan Tolvansson", "personal_number": "19121212-1212",
     "email": "tolvan@example.test", "phone": "070-000 00 12", "street_address": "Tolvvägen 12",
     "postal_code": "121 21", "city": "Teststad", "reverse_vat": false}',
   '{"subtotal": 12000, "vat": 3000, "total": 15000}',
   '{"enabled": true, "applicant_name": "Tolvan Tolvansson", "personal_number": "19121212-1212",
     "property_designation": "Teststad Tolvan 12:12", "rot_percent": 30, "max_deduction": 50000,
     "brf_org_number": null}',
   '{"desired_installation_date": null, "handoff_notes": "Påhittad överlämning.", "work_scope": null}',
   25,
   '[{"id": "40000000-0000-4000-8000-000000000003", "construction": "snedtak", "pricing_mode": "m3",
      "m2": "40", "thickness_mm": "250", "quantity": "10", "unit_price": "1200", "auto_price": false,
      "article_id": null, "article_number": null, "article_name": "Lösull snedtak",
      "article_unit_name": "m3", "article_price": 1200, "article_note": null, "discount_percent": "",
      "line_note": "", "is_rot_work": true, "house_work_type": "CONSTRUCTION", "labor_cost": "",
      "density": "45", "include_in_description": false}]',
   '{"kind": "local", "sync_intent": "local_only"}',
   '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002');

-- Arbetsordern för den vunna offerten. Länken går åt båda håll, som i work-orders.ts: ordern får
-- quote_id, offerten work_order_id/work_order_number/converted_*. order_number följer appens form
-- (AO-<datum>-<offertens id, sex tecken>).
insert into public.crm_work_orders (
  id, quote_id, customer_id, order_number, project_name, client_name, quote_type,
  customer_snapshot, work_address, pricing_summary, line_items, rot_details, internal_handoff,
  amount, vat_percent, source_status, status, created_by, assigned_to
)
select
  '30000000-0000-4000-8000-000000000001', q.id, q.customer_id, 'AO-20260925-A20000',
  q.project_name, q.customer_name, q.quote_type,
  q.customer_snapshot,
  '{"street_address": "Tolvvägen 12", "postal_code": "121 21", "city": "Teststad",
    "delivery_address": null, "invoice_address": null}',
  q.pricing_summary, q.line_items, q.rot_details, q.internal_handoff,
  q.amount, q.vat_percent, 'won', 'draft', q.created_by, q.assigned_to
from public.crm_quotes q
where q.id = 'a2000000-0000-4000-8000-000000000001';

update public.crm_quotes
   set work_order_id = '30000000-0000-4000-8000-000000000001',
       work_order_number = 'AO-20260925-A20000',
       converted_to_work_order_at = now(),
       converted_to_work_order_by = '00000000-0000-4000-8000-000000000002'
 where id = 'a2000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Personbundna rader som inte följer med från prod (se export_reference.sql): felanmälans mottagare
-- och en standardbemanning, så att de flödena går att prova. Bilarna kommer ur reference.sql.
-- ---------------------------------------------------------------------------

insert into public.fault_report_recipients (user_id) values ('00000000-0000-4000-8000-000000000001');

insert into public.ops_truck_default_crew (truck_id, member_id, member_name, role)
select t.id, '00000000-0000-4000-8000-000000000005', 'Test Montör', 'leader'
  from public.ops_trucks t
 where t.active
 order by t.name
 limit 1;
