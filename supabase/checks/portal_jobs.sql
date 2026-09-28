-- Beteendet hos jobbens migrering (20260928090839_portal_jobs.sql), prövat mot en databas.
--
-- BARA LOKALT. Skriptet lägger in en provbutik, två provordrar och deras jobb, prövar läsningen med riktiga sessioner
-- (admin, säljare, konsult, ekonomi, montör, anon) och rullar sedan tillbaka allt. Ett fel avbryter med ett meddelande
-- som säger vad som inte stämde. Kräver seedens testanvändare (<roll>@example.test).
--
--   psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -v ON_ERROR_STOP=1 -f supabase/checks/portal_jobs.sql

begin;

do $$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-000000000001';
  seller_id constant uuid := '00000000-0000-4000-8000-000000000002';
  konsult_id constant uuid := '00000000-0000-4000-8000-000000000003';
  ekonomi_id constant uuid := '00000000-0000-4000-8000-000000000004';
  montor_id constant uuid := '00000000-0000-4000-8000-000000000005';
  wo_seller constant uuid := 'c3b00000-0000-4000-8000-000000000001';
  wo_montor constant uuid := 'c3b00000-0000-4000-8000-000000000002';
  n integer;
  store text;
  who uuid;
begin
  -- Som intaget gör det (service-rollen): butiken, arbetsordern, jobbet.
  insert into public.crm_portal_resellers (reseller_id, name) values ('check-3b', 'Provbutiken AB');
  insert into public.crm_work_orders (id, order_number, project_name, client_name, quote_type, created_by, assigned_to)
  values (wo_seller, 'AO-CHECK-3B-1', 'Rönnvägen 18, Gävle', 'Provbutiken AB', 'business', seller_id, seller_id),
         -- Ansvarig utan crm.workorder.read: prövar policyns andra väg (ansvarig för ordern).
         (wo_montor, 'AO-CHECK-3B-2', 'Björkvägen 2, Gävle', 'Provbutiken AB', 'business', montor_id, montor_id);
  insert into public.crm_portal_jobs (quote_id, quote_number, reseller_id, store_name, assigned_to, assignment_source,
                                      reserved_work_order_id, work_order_id, work_order_created_at, payload)
  values ('check-3b-1', '2026-015', 'check-3b', 'Provbutiken AB', seller_id, 'reseller_seller', wo_seller, wo_seller, now(),
          '{"lines":[{"unitCost":310}]}'),
         ('check-3b-2', '2026-016', 'check-3b', 'Provbutiken AB', montor_id, 'fallback', wo_montor, wo_montor, now(), '{}');

  -- 0. Behörigheterna som de står. RLS utan insert-policy nekar ändå med samma felkod, så ett grant här syns inte i
  --    beteendet nedan; det ska ändå inte finnas. (has_*_privilege med en kommalista = NÅGON av dem.)
  if has_table_privilege('authenticated', 'public.crm_portal_jobs', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     or has_any_column_privilege('authenticated', 'public.crm_portal_jobs', 'INSERT,UPDATE,REFERENCES') then
    raise exception 'sessionen har mer än läsning av brickans kolumner';
  end if;

  -- 1. De som läser arbetsordrar kontorsvägen (crm.workorder.read) ser brickan på båda.
  foreach who in array array[admin_id, seller_id, konsult_id, ekonomi_id] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.crm_portal_jobs where work_order_id in (wo_seller, wo_montor);
    if n <> 2 then raise exception '%: ser % av 2 jobb', who, n; end if;
    select store_name into store from public.crm_portal_jobs where work_order_id = wo_seller;
    if store is distinct from 'Provbutiken AB' then raise exception '%: brickan saknar butiken', who; end if;

    -- Kroppen (butikens inpriser) och resten av raden är aldrig sessionens.
    begin
      perform payload from public.crm_portal_jobs where work_order_id = wo_seller;
      raise exception '%: kunde läsa kroppen', who;
    exception when insufficient_privilege then null;
    end;
    begin
      perform reserved_work_order_id, assigned_to, customer_id from public.crm_portal_jobs where work_order_id = wo_seller;
      raise exception '%: kunde läsa jobbets interna kolumner', who;
    exception when insufficient_privilege then null;
    end;
    begin
      update public.crm_portal_jobs set store_name = 'Kapad' where work_order_id = wo_seller;
      raise exception '%: kunde ändra jobbet', who;
    exception when insufficient_privilege then null;
    end;
    begin
      insert into public.crm_portal_jobs (quote_id, quote_number, reseller_id, store_name, assignment_source,
                                          reserved_work_order_id, payload)
      values ('check-3b-x', '1', 'check-3b', 'X', 'fallback', gen_random_uuid(), '{}');
      raise exception '%: kunde lägga till ett jobb', who;
    exception when insufficient_privilege then null;
    end;
    begin
      delete from public.crm_portal_jobs where work_order_id = wo_seller;
      raise exception '%: kunde ta bort ett jobb', who;
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;

  -- 2. Montören (ingen crm.workorder.read) ser bara jobbet på ordern hen själv är ansvarig för.
  perform set_config('request.jwt.claims', json_build_object('sub', montor_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.crm_portal_jobs where work_order_id = wo_seller;
  if n <> 0 then raise exception 'montör: ser jobbet på en annans order'; end if;
  select count(*) into n from public.crm_portal_jobs where work_order_id = wo_montor;
  if n <> 1 then raise exception 'montör: ser inte jobbet på sin egen order'; end if;
  reset role;

  -- 3. Utan inloggning: ingenting.
  set local role anon;
  begin
    perform store_name from public.crm_portal_jobs;
    raise exception 'anon: kunde läsa jobben';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 4. Service-rollen (intaget) läser och skriver allt.
  set local role service_role;
  update public.crm_portal_jobs set received_notified_at = now() where quote_id = 'check-3b-1' and received_notified_at is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'service_role: notisen gick inte att ta'; end if;
  update public.crm_portal_jobs set received_notified_at = now() where quote_id = 'check-3b-1' and received_notified_at is null;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'service_role: notisen togs två gånger'; end if;
  reset role;

  -- 5. Arbetsordern tas bort: jobbet blir kvar, utan order, med tiden den skapades.
  delete from public.crm_work_orders where id = wo_seller;
  select count(*) into n from public.crm_portal_jobs
   where quote_id = 'check-3b-1' and work_order_id is null and work_order_created_at is not null;
  if n <> 1 then raise exception 'borttagen order: jobbet ser inte ut som väntat'; end if;

  -- 6. Tabellens spärrar.
  begin
    update public.crm_portal_jobs set work_order_id = wo_montor where quote_id = 'check-3b-1';
    raise exception 'jobbet kunde pekas på en annan order än den reserverade';
  exception when check_violation or unique_violation then null;
  end;
  begin
    update public.crm_portal_jobs set work_order_created_at = null where quote_id = 'check-3b-2';
    raise exception 'en kopplad order saknar tid för när den skapades';
  exception when check_violation then null;
  end;

  raise notice 'portal_jobs: allt stämmer';
end $$;

rollback;
