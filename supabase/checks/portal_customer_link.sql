-- Beteendet bakom kopplingen av butikens kundkort (fas 3c, 20260928100120_portal_reseller_customer_link.sql), prövat
-- mot en databas.
--
-- BARA LOKALT. Skriptet lägger in en provbutik, ett provkort och en provorder, prövar med riktiga sessioner (admin,
-- säljare, konsult) vem som får koppla, och rullar sedan tillbaka allt. Ett fel avbryter med ett meddelande som säger
-- vad som inte stämde. Kräver seedens testanvändare (<roll>@example.test).
--
--   psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -v ON_ERROR_STOP=1 -f supabase/checks/portal_customer_link.sql

begin;

do $$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-000000000001';
  seller_id constant uuid := '00000000-0000-4000-8000-000000000002';
  konsult_id constant uuid := '00000000-0000-4000-8000-000000000003';
  wo constant uuid := 'c3c00000-0000-4000-8000-000000000001';
  card constant uuid := 'c3c00000-0000-4000-8000-0000000000c1';
  n integer;
  who uuid;
begin
  insert into public.crm_customers (id, customer_type, company_name, organization_number, created_by, assigned_to)
  values (card, 'business', 'Provbutiken AB', '556677-8899', admin_id, admin_id);
  insert into public.crm_portal_resellers (reseller_id, name) values ('check-3c', 'Provbutiken AB');
  insert into public.crm_work_orders (id, order_number, project_name, client_name, quote_type, created_by, assigned_to)
  values (wo, 'AO-CHECK-3C-1', 'Rönnvägen 18, Gävle', 'Provbutiken AB', 'business', seller_id, seller_id);

  -- 1. Butikens koppling skrivs aldrig av en session, inte ens av admin (crm.portal.manage).
  -- updated_by sätts som sidan gör det, så att det är kolumnbehörigheten som prövas och inte policyns krav på den.
  foreach n in array array[1, 2] loop
    who := case n when 1 then admin_id else seller_id end;
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      update public.crm_portal_resellers set customer_id = card, updated_by = who where reseller_id = 'check-3c';
      raise exception 'session %: kunde sätta butikens kort', n;
    exception when insufficient_privilege then null;
    end;
    begin
      update public.crm_portal_resellers set customer_linked_by = who, customer_linked_at = now(), updated_by = who
       where reseller_id = 'check-3c';
      raise exception 'session %: kunde sätta vem som kopplade', n;
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;

  -- 2. Ordern: den som har den kan koppla (RLS släpper den ansvariga) ...
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.crm_work_orders set customer_id = card where id = wo and customer_id is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ansvarig säljare: kunde inte koppla sin order (% rader)', n; end if;
  reset role;
  update public.crm_work_orders set customer_id = null where id = wo;

  -- ... en annan utan admin kan inte (0 rader, inget fel: det är det domänen läser som "nej") ...
  perform set_config('request.jwt.claims', json_build_object('sub', konsult_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.crm_work_orders set customer_id = card where id = wo and customer_id is null;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'konsult: kunde koppla en annans order'; end if;
  reset role;

  -- ... och admin kan.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.crm_work_orders set customer_id = card where id = wo and customer_id is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin: kunde inte koppla ordern'; end if;
  reset role;

  -- 3. Service-rollen sparar kopplingen på butiken.
  set local role service_role;
  update public.crm_portal_resellers set customer_id = card, customer_linked_by = seller_id, customer_linked_at = now()
   where reseller_id = 'check-3c';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'service_role: kopplingen sparades inte'; end if;
  reset role;

  -- 4. Kortet tas bort: butikens id nollas, tiden står kvar, och borttagningen stoppas inte av något.
  update public.crm_work_orders set customer_id = null where id = wo;
  delete from public.crm_customers where id = card;
  select count(*) into n from public.crm_portal_resellers
   where reseller_id = 'check-3c' and customer_id is null and customer_linked_at is not null;
  if n <> 1 then raise exception 'borttaget kort: butikens rad ser inte ut som väntat'; end if;

  raise notice 'portal_customer_link: allt stämmer';
end $$;

rollback;
