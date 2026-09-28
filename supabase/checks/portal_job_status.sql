-- Markeringen för statusen tillbaka till portalen (fas 4b, 20260928134853_portal_job_status.sql), prövad mot en
-- databas.
--
-- BARA LOKALT. Skriptet lägger in en provbutik, en portalorder med jobb och en vanlig order, ändrar dem med riktiga
-- sessioner (säljaren som har ordern, admin, konsult) och genom planeringens kort, raderar portalordern, och rullar
-- sedan tillbaka allt. Ett fel avbryter med ett meddelande som säger vad som inte stämde. Kräver seedens testanvändare
-- (<roll>@example.test), minst en bil i ops_trucks och fas 4a (planerat datum).
--
--   psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -v ON_ERROR_STOP=1 -f supabase/checks/portal_job_status.sql

begin;

create function pg_temp.marked(p_quote text) returns boolean language sql as $$
  select j.sync_requested_at is not null from public.crm_portal_jobs j where j.quote_id = p_quote $$;
create function pg_temp.unmark(p_quote text) returns void language sql as $$
  update public.crm_portal_jobs set sync_requested_at = null where quote_id = p_quote $$;

do $$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-000000000001';
  seller_id constant uuid := '00000000-0000-4000-8000-000000000002';
  konsult_id constant uuid := '00000000-0000-4000-8000-000000000003';
  wo constant uuid := 'c4b00000-0000-4000-8000-000000000001';
  wo_plain constant uuid := 'c4b00000-0000-4000-8000-000000000002';
  seg constant uuid := 'c4b00000-0000-4000-8000-0000000000a1';
  q constant text := 'check-4b-1';
  truck uuid;
  n integer;
  qid text;
begin
  select t.id into truck from public.ops_trucks t order by t.name limit 1;
  if truck is null then raise exception 'förutsättning: ingen bil i ops_trucks'; end if;

  insert into public.crm_portal_resellers (reseller_id, name) values ('check-4b', 'Provbutiken AB');
  insert into public.crm_work_orders (id, order_number, project_name, client_name, quote_type, created_by, assigned_to)
  values (wo, 'AO-CHECK-4B-1', 'Rönnvägen 18, Gävle', 'Provbutiken AB', 'business', seller_id, seller_id),
         (wo_plain, 'AO-CHECK-4B-2', 'Vanlig order', 'Vanlig kund', 'business', seller_id, seller_id);
  insert into public.crm_portal_jobs (quote_id, quote_number, reseller_id, store_name, assigned_to, assignment_source,
                                      reserved_work_order_id, work_order_id, work_order_created_at, payload)
  values (q, '2026-4B', 'check-4b', 'Provbutiken AB', seller_id, 'reseller_seller', wo, wo, now(), '{}');
  if pg_temp.marked(q) then raise exception 'förutsättning: jobbet var markerat från början'; end if;

  -- 1. Säljaren som har ordern byter status: jobbet markeras, fast sessionen inte får skriva i crm_portal_jobs.
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.crm_portal_jobs set sync_requested_at = now() where quote_id = q;
    raise exception '1. sessionen kunde markera jobbet själv';
  exception when insufficient_privilege then null;
  end;
  update public.crm_work_orders set status = 'scheduled' where id = wo;
  reset role;
  if not pg_temp.marked(q) then raise exception '1. ett statusbyte markerade inte jobbet'; end if;
  perform pg_temp.unmark(q);

  -- 2. En ändring som butiken inte ser (anteckningen), och samma status igen: ingen markering.
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.crm_work_orders set notes = 'intern anteckning' where id = wo;
  update public.crm_work_orders set status = 'scheduled' where id = wo;
  reset role;
  if pg_temp.marked(q) then raise exception '2. en ändring butiken inte ser markerade jobbet'; end if;

  -- 3. Planeringen lägger ett kort (fas 4a skriver planerat datum): jobbet markeras. En flytt också; en ny ordning inte.
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.ops_segments (id, work_order_id, truck_id, start_day, end_day, created_by)
  values (seg, wo, truck, '2026-10-14', '2026-10-15', seller_id);
  reset role;
  if not pg_temp.marked(q) then raise exception '3. ett kort på schemat markerade inte jobbet'; end if;
  perform pg_temp.unmark(q);
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.ops_segments set sort_index = 5 where id = seg;
  reset role;
  if pg_temp.marked(q) then raise exception '3. en ny ordning på dagen markerade jobbet'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.ops_segments set start_day = '2026-10-20', end_day = '2026-10-21' where id = seg;
  reset role;
  if not pg_temp.marked(q) then raise exception '3. en flytt markerade inte jobbet'; end if;
  perform pg_temp.unmark(q);

  -- 4. Fortnox-numret (service-rollen, som pushen): markeras.
  set local role service_role;
  update public.crm_work_orders set fortnox_order_number = '9004' where id = wo;
  reset role;
  if not pg_temp.marked(q) then raise exception '4. Fortnox-numret markerade inte jobbet'; end if;
  perform pg_temp.unmark(q);

  -- 5. En vanlig order: ingen markering någonstans, inget fel.
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.crm_work_orders set status = 'completed' where id = wo_plain;
  reset role;
  select count(*) into n from public.crm_portal_jobs where sync_requested_at is not null and quote_id = q;
  if n <> 0 then raise exception '5. en vanlig order markerade portaljobbet'; end if;

  -- 6. Läsning: den som läser arbetsordrar ser quote_id (fliken Utskick), men aldrig synkens eller Fortnox-försökens
  --    kolumner. Konsulten (crm.workorder.read) också, som för brickan.
  foreach n in array array[1, 2] loop
    perform set_config('request.jwt.claims', json_build_object('sub', case n when 1 then admin_id else konsult_id end, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select quote_id into qid from public.crm_portal_jobs where work_order_id = wo;
    if qid is distinct from q then raise exception '6. session %: ser inte quote_id', n; end if;
    begin
      perform sync_state from public.crm_portal_jobs where work_order_id = wo;
      raise exception '6. session %: kunde läsa sync_state', n;
    exception when insufficient_privilege then null;
    end;
    begin
      perform fortnox_next_attempt_at, sync_pending_events from public.crm_portal_jobs where work_order_id = wo;
      raise exception '6. session %: kunde läsa Fortnox-försöken eller de väntande händelserna', n;
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;

  -- 7. Ordern raderas (admin): jobbet markeras, fast work_order_id nollas; korten försvinner med ordern.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.crm_work_orders where id = wo;
  get diagnostics n = row_count;
  reset role;
  if n <> 1 then raise exception '7. admin kunde inte radera ordern (% rader)', n; end if;
  if not pg_temp.marked(q) then raise exception '7. raderingen markerade inte jobbet'; end if;
  if (select work_order_id from public.crm_portal_jobs where quote_id = q) is not null then
    raise exception '7. jobbet pekar fortfarande på den raderade ordern';
  end if;

  raise notice 'portalens status: alla kontroller gick igenom';
end $$;

rollback;
