-- Beteendet hos butikernas migrering (20260928082554_portal_resellers.sql), prövat mot en databas.
--
-- BARA LOKALT. Skriptet lägger in en provbutik, prövar behörigheterna med riktiga sessioner (admin, säljare, anon) och
-- rullar sedan tillbaka allt. Ett fel avbryter med ett meddelande som säger vad som inte stämde. Kräver seedens
-- testanvändare (admin@example.test, saljare@example.test).
--
--   psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -v ON_ERROR_STOP=1 -f supabase/checks/portal_resellers.sql

begin;

do $$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-000000000001';
  seller_id constant uuid := '00000000-0000-4000-8000-000000000002';
  n integer;
  seller uuid;
begin
  -- Provbutiken läggs in som intaget gör det (service-rollen i fas 3b).
  -- updated_at långt bakåt: kontrollen nedan kräver då att triggern satte den vid ändringen.
  insert into public.crm_portal_resellers (reseller_id, name, street, postal_code, city, customer_number, updated_at)
  values ('check-3a', 'Provbutiken AB', 'Verkstadsgatan 8', '802 91', 'Gävle', '1043', '2000-01-01');

  -- 1. Admin (crm.portal.manage).
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.crm_portal_resellers where reseller_id = 'check-3a';
  if n <> 1 then raise exception 'admin: ser inte butiken'; end if;

  update public.crm_portal_resellers set seller_user_id = seller_id, updated_by = admin_id where reseller_id = 'check-3a';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin: säljaren gick inte att sätta (% rader)', n; end if;

  -- Bara i eget namn.
  begin
    update public.crm_portal_resellers set seller_user_id = null, updated_by = seller_id where reseller_id = 'check-3a';
    raise exception 'admin: kunde ändra i en annans namn';
  exception when insufficient_privilege then null;
  end;

  -- Allt annat på butiken är intagets.
  begin
    update public.crm_portal_resellers set name = 'Kapad', updated_by = admin_id where reseller_id = 'check-3a';
    raise exception 'admin: kunde ändra butikens namn';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.crm_portal_resellers set customer_id = null, updated_by = admin_id where reseller_id = 'check-3a';
    raise exception 'admin: kunde ändra butikens kund';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.crm_portal_resellers (reseller_id, name) values ('check-3a-2', 'Påhittad');
    raise exception 'admin: kunde lägga till en butik';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.crm_portal_resellers where reseller_id = 'check-3a';
    raise exception 'admin: kunde ta bort en butik';
  exception when insufficient_privilege then null;
  end;

  -- Reserven.
  update public.crm_portal_settings set fallback_user_id = seller_id, updated_by = admin_id where id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin: reserven gick inte att sätta (% rader)', n; end if;
  begin
    insert into public.crm_portal_settings (id) values (true);
    raise exception 'admin: kunde lägga till en inställningsrad';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.crm_portal_settings set fallback_user_id = null, updated_by = seller_id where id;
    raise exception 'admin: kunde ändra reserven i en annans namn';
  exception when insufficient_privilege then null;
  end;

  reset role;

  select seller_user_id into seller from public.crm_portal_resellers where reseller_id = 'check-3a';
  if seller is distinct from seller_id then raise exception 'butikens säljare blev %', seller; end if;
  if (select updated_at from public.crm_portal_resellers where reseller_id = 'check-3a') <> now() then
    raise exception 'updated_at sattes inte av triggern';
  end if;

  -- Regler på raden (som service-rollen, alltså intaget).
  begin
    insert into public.crm_portal_resellers (reseller_id, name) values ('res norrbygg', 'Blanksteg i id');
    raise exception 'regel: ett id med blanksteg gick att spara';
  exception when check_violation then null;
  end;
  begin
    insert into public.crm_portal_resellers (reseller_id, name) values ('check-3a-3', '  ');
    raise exception 'regel: en butik utan namn gick att spara';
  exception when check_violation then null;
  end;
  begin
    insert into public.crm_portal_settings (id) values (false);
    raise exception 'regel: en andra inställningsrad gick att spara';
  exception when check_violation then null;
  end;

  -- 2. Säljaren (utan crm.portal.manage): ser ingenting och ändrar ingenting.
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.crm_portal_resellers;
  if n <> 0 then raise exception 'säljare: ser % butiker', n; end if;
  select count(*) into n from public.crm_portal_settings;
  if n <> 0 then raise exception 'säljare: ser inställningarna'; end if;
  -- UPDATE på rader RLS döljer ger inget fel, bara 0 rader: räkna.
  update public.crm_portal_resellers set seller_user_id = seller_id, updated_by = seller_id where reseller_id = 'check-3a';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'säljare: ändrade % butiker', n; end if;
  update public.crm_portal_settings set fallback_user_id = seller_id, updated_by = seller_id where id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'säljare: ändrade reserven'; end if;
  reset role;

  -- 3. anon når inget.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    perform 1 from public.crm_portal_resellers limit 1;
    raise exception 'anon: kunde läsa butikerna';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.crm_portal_settings limit 1;
    raise exception 'anon: kunde läsa inställningarna';
  exception when insufficient_privilege then null;
  end;
  reset role;

  raise notice 'butikerna: alla kontroller gick igenom';
end $$;

rollback;
