-- Beteendet hos dokumentens migrering (20260928163644_portal_job_documents.sql), prövat mot en databas.
--
-- BARA LOKALT. Skriptet lägger in en provbutik och tre provordrar med jobb, prövar läsning, beslut och svarsregeln med
-- riktiga sessioner (admin, säljare, konsult, ekonomi, montör, anon), tabellens spärrar med service-rollen och att
-- bucketen är stängd för sessionerna, och rullar sedan tillbaka allt. Varje nej måste vara RÄTT nej (sqlerrm): ett nej
-- från fel ställe (en annan tabell, en grant i stället för policyn) hade dolt att skyddet saknas. Ett fel avbryter med
-- ett meddelande som säger vad som inte stämde. Kräver seedens testanvändare (<roll>@example.test).
--
--   psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -v ON_ERROR_STOP=1 -f supabase/checks/portal_job_documents.sql

begin;

do $$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-000000000001';
  seller_id constant uuid := '00000000-0000-4000-8000-000000000002';
  konsult_id constant uuid := '00000000-0000-4000-8000-000000000003';
  ekonomi_id constant uuid := '00000000-0000-4000-8000-000000000004';
  montor_id constant uuid := '00000000-0000-4000-8000-000000000005';
  wo_seller constant uuid := 'c7000000-0000-4000-8000-000000000001';
  wo_admin constant uuid := 'c7000000-0000-4000-8000-000000000002';
  wo_montor constant uuid := 'c7000000-0000-4000-8000-000000000003';
  wo_empty constant uuid := 'c7000000-0000-4000-8000-000000000004';
  doc_seller constant uuid := 'd7000000-0000-4000-8000-000000000001';
  doc_admin constant uuid := 'd7000000-0000-4000-8000-000000000002';
  doc_ready constant uuid := 'd7000000-0000-4000-8000-000000000003';
  granted constant text := 'permission denied for table crm_portal_job_documents';
  rls constant text := 'new row violates row-level security policy for table "crm_portal_job_documents"';
  sha constant text := repeat('ab', 32);
  n integer;
  who uuid;
  key text;
  st text;
  col text;
begin
  -- Som intaget gör det (service-rollen): butiken, arbetsordrarna och jobben.
  insert into public.crm_portal_resellers (reseller_id, name) values ('check-7', 'Provbutiken AB');
  insert into public.crm_work_orders (id, order_number, project_name, client_name, quote_type, created_by, assigned_to)
  values (wo_seller, 'AO-CHECK-7-1', 'Rönnvägen 18, Gävle', 'Provbutiken AB', 'business', seller_id, seller_id),
         -- Någon annans order: säljaren läser men får inte skicka.
         (wo_admin, 'AO-CHECK-7-2', 'Aspvägen 4, Gävle', 'Provbutiken AB', 'business', admin_id, admin_id),
         -- Ansvarig utan crm.workorder.read: prövar läspolicyns andra väg (ansvarig för ordern).
         (wo_montor, 'AO-CHECK-7-3', 'Björkvägen 2, Gävle', 'Provbutiken AB', 'business', montor_id, montor_id),
         -- Ett jobb utan dokument: tabellens spärrar prövas där, så att inget annat nej hinner före.
         (wo_empty, 'AO-CHECK-7-4', 'Ekvägen 1, Gävle', 'Provbutiken AB', 'business', admin_id, admin_id);
  insert into public.crm_portal_jobs (quote_id, quote_number, reseller_id, store_name, assigned_to, assignment_source,
                                      reserved_work_order_id, work_order_id, work_order_created_at, payload)
  values ('check-7-1', '2026-071', 'check-7', 'Provbutiken AB', seller_id, 'reseller_seller', wo_seller, wo_seller, now(), '{}'),
         ('check-7-2', '2026-072', 'check-7', 'Provbutiken AB', admin_id, 'fallback', wo_admin, wo_admin, now(), '{}'),
         ('check-7-3', '2026-073', 'check-7', 'Provbutiken AB', montor_id, 'fallback', wo_montor, wo_montor, now(), '{}'),
         ('check-7-4', '2026-074', 'check-7', 'Provbutiken AB', admin_id, 'fallback', wo_empty, wo_empty, now(), '{}');

  -- Ett fryst dokument på varje order, som service-rollen lägger dem (den automatiska orderbekräftelsen).
  set local role service_role;
  insert into public.crm_portal_job_documents (quote_id, kind, status, name, byte_size, sha256, source_ref, ready_at)
  values ('check-7-1', 'order_confirmation', 'ready', 'Orderbekräftelse 71.pdf', 1234, sha, '71', now()),
         ('check-7-2', 'order_confirmation', 'ready', 'Orderbekräftelse 72.pdf', 1234, sha, '72', now()),
         ('check-7-3', 'order_confirmation', 'ready', 'Orderbekräftelse 73.pdf', 1234, sha, '73', now());
  reset role;

  -- 1. De som läser arbetsordrar kontorsvägen (crm.workorder.read) ser dokumenten på alla tre, men aldrig hashen,
  --    källan, omförsöken eller köns markering, och ändrar eller tar aldrig bort något.
  foreach who in array array[admin_id, seller_id, konsult_id, ekonomi_id] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.crm_portal_job_documents where quote_id in ('check-7-1', 'check-7-2', 'check-7-3');
    if n <> 3 then raise exception '%: ser % av 3 dokument', who, n; end if;
    perform id, quote_id, kind, status, name, byte_size, error, created_by, created_by_name, created_at, ready_at, outbound_key
       from public.crm_portal_job_documents where quote_id = 'check-7-1';
    foreach col in array array['sha256', 'source_ref', 'attempts', 'next_attempt_at', 'queued_at'] loop
      begin
        execute format('select %I from public.crm_portal_job_documents limit 1', col);
        raise exception '%: kunde läsa %', who, col;
      exception when insufficient_privilege then
        if sqlerrm <> granted then raise exception '%: fel nej för % (%)', who, col, sqlerrm; end if;
      end;
    end loop;
    begin
      update public.crm_portal_job_documents set name = 'Kapad.pdf' where quote_id = 'check-7-1';
      raise exception '%: kunde ändra ett dokument', who;
    exception when insufficient_privilege then
      if sqlerrm <> granted then raise exception '%: fel nej för update (%)', who, sqlerrm; end if;
    end;
    begin
      delete from public.crm_portal_job_documents where quote_id = 'check-7-1';
      raise exception '%: kunde ta bort ett dokument', who;
    exception when insufficient_privilege then
      if sqlerrm <> granted then raise exception '%: fel nej för delete (%)', who, sqlerrm; end if;
    end;
    reset role;
  end loop;

  -- 2. Montören (ingen crm.workorder.read, alltså fältvyn) ser bara dokumentet på ordern hen själv är ansvarig för.
  perform set_config('request.jwt.claims', json_build_object('sub', montor_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.crm_portal_job_documents where quote_id in ('check-7-1', 'check-7-2');
  if n <> 0 then raise exception 'montör: ser dokumenten på en annans order'; end if;
  select count(*) into n from public.crm_portal_job_documents where quote_id = 'check-7-3';
  if n <> 1 then raise exception 'montör: ser inte dokumentet på sin egen order'; end if;
  reset role;

  -- 3. Utan inloggning: ingenting.
  set local role anon;
  begin
    perform name from public.crm_portal_job_documents;
    raise exception 'anon: kunde läsa dokumenten';
  exception when insufficient_privilege then
    if sqlerrm <> granted then raise exception 'anon: fel nej (%)', sqlerrm; end if;
  end;
  reset role;

  -- 4. Säljaren skickar på sin egen order, i eget namn: bara beslutet (building). Nyckeln härleder databasen.
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.crm_portal_job_documents (id, quote_id, kind, created_by, created_by_name)
  values (doc_seller, 'check-7-1', 'self_inspection', seller_id, 'Anna Berg');
  select outbound_key, status into key, st from public.crm_portal_job_documents where id = doc_seller;
  if key is distinct from 'job.document-' || doc_seller then raise exception 'säljaren: nyckeln blev %', key; end if;
  if st is distinct from 'building' then raise exception 'säljaren: beslutet fick läget %', st; end if;

  -- Samma id igen (dubbelklick): ingenting nytt, inget fel (det PostgREST gör med ignoreDuplicates).
  insert into public.crm_portal_job_documents (id, quote_id, kind, created_by, created_by_name)
  values (doc_seller, 'check-7-1', 'self_inspection', seller_id, 'Anna Berg')
  on conflict (id) do nothing;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'säljaren: samma id gav ett dokument till'; end if;

  -- Filen, hashen, läget och kön är aldrig sessionens: den kan inte lägga in ett "fryst" dokument.
  foreach col in array array['status', 'name', 'byte_size', 'sha256', 'source_ref', 'ready_at', 'queued_at', 'next_attempt_at',
                             'created_at'] loop
    begin
      execute format(
        'insert into public.crm_portal_job_documents (quote_id, kind, created_by, created_by_name, %I) values (%L, %L, %L, %L, %L)',
        col, 'check-7-1', 'order_confirmation', seller_id, 'Anna Berg',
        case col when 'status' then 'ready' when 'name' then 'x.pdf' when 'byte_size' then '10' when 'sha256' then sha
                 when 'source_ref' then '71' else now()::text end);
      raise exception 'säljaren: kunde sätta %', col;
    exception when insufficient_privilege then
      if sqlerrm <> granted then raise exception 'säljaren: fel nej för % (%)', col, sqlerrm; end if;
    end;
  end loop;

  -- Någon annans order, eller någon annans namn: policyn säger nej.
  begin
    insert into public.crm_portal_job_documents (quote_id, kind, created_by, created_by_name)
    values ('check-7-2', 'order_confirmation', seller_id, 'Anna Berg');
    raise exception 'säljaren: kunde skicka på en annans order';
  exception when insufficient_privilege then
    if sqlerrm <> rls then raise exception 'säljaren: fel nej för en annans order (%)', sqlerrm; end if;
  end;
  begin
    insert into public.crm_portal_job_documents (quote_id, kind, created_by, created_by_name)
    values ('check-7-1', 'order_confirmation', admin_id, 'Admin');
    raise exception 'säljaren: kunde skicka i en annans namn';
  exception when insufficient_privilege then
    if sqlerrm <> rls then raise exception 'säljaren: fel nej för en annans namn (%)', sqlerrm; end if;
  end;
  -- Som den automatiska (utan namn): tabellens check, eller policyn.
  begin
    insert into public.crm_portal_job_documents (quote_id, kind) values ('check-7-1', 'order_confirmation');
    raise exception 'säljaren: kunde lägga in en automatisk';
  exception when insufficient_privilege or check_violation then
    if sqlerrm <> rls and sqlerrm not like '%crm_portal_job_documents_created_by_check%' then
      raise exception 'säljaren: fel nej för en automatisk (%)', sqlerrm;
    end if;
  end;
  reset role;

  -- 5. Admin skickar på en order hen inte har; konsult och ekonomi (ingen skrivnyckel) aldrig, och inte heller montören
  --    på sin egen order (ansvarig men utan crm.workorder.write). Samma svarsregel som meddelandena.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.crm_portal_job_documents (id, quote_id, kind, created_by, created_by_name)
  values (doc_admin, 'check-7-1', 'order_confirmation', admin_id, 'Admin');
  reset role;
  foreach who in array array[konsult_id, ekonomi_id] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into public.crm_portal_job_documents (quote_id, kind, created_by, created_by_name)
      values ('check-7-1', 'order_confirmation', who, 'X');
      raise exception '%: kunde skicka utan skrivnyckeln', who;
    exception when insufficient_privilege then
      if sqlerrm <> rls then raise exception '%: fel nej (%)', who, sqlerrm; end if;
    end;
    reset role;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', montor_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.crm_portal_job_documents (quote_id, kind, created_by, created_by_name)
    values ('check-7-3', 'self_inspection', montor_id, 'Montör');
    raise exception 'montör: kunde skicka utan skrivnyckeln';
  exception when insufficient_privilege then
    if sqlerrm <> rls then raise exception 'montör: fel nej (%)', sqlerrm; end if;
  end;
  reset role;

  -- 6. Köns rad för ett dokument (som enqueuePortalEvent lägger den) är stängd för sessionen: kortet får statusen av
  --    servern. Bara admin ser den, genom portalsidans policy (crm.portal.manage).
  set local role service_role;
  insert into public.portal_outbound_events (idempotency_key, path, payload, ordering_key)
  values ('job.document-' || doc_seller, '/api/ekovilla/events', '{}', 'job:check-7-1');
  reset role;
  foreach who in array array[seller_id, konsult_id, ekonomi_id, montor_id] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.portal_outbound_events where idempotency_key = 'job.document-' || doc_seller;
    if n <> 0 then raise exception '%: ser dokumentets rad i kön', who; end if;
    reset role;
  end loop;

  -- 7. Bucketen: privat, och ingen session når en fil i den, inte ens på sin egen order.
  if (select public from storage.buckets where id = 'portal-job-documents') is distinct from false then
    raise exception 'bucketen är inte privat';
  end if;
  insert into storage.objects (bucket_id, name) values ('portal-job-documents', 'check-7-1/' || doc_ready || '.pdf');
  foreach who in array array[admin_id, seller_id, konsult_id, ekonomi_id, montor_id] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from storage.objects where bucket_id = 'portal-job-documents';
    if n <> 0 then raise exception '%: ser en fil i dokumentens bucket', who; end if;
    reset role;
  end loop;
  set local role anon;
  select count(*) into n from storage.objects where bucket_id = 'portal-job-documents';
  if n <> 0 then raise exception 'anon: ser en fil i dokumentens bucket'; end if;
  reset role;

  -- 8. Tabellens spärrar (som service-rollen, som inte hindras av policyerna). Varje nej från sin egen check.
  set local role service_role;
  -- Ett fryst dokument har allt händelsen behöver.
  begin
    update public.crm_portal_job_documents set status = 'ready', name = 'x.pdf', byte_size = 10, source_ref = '71', ready_at = now()
     where id = doc_seller;
    raise exception 'ett dokument utan hash gick att frysa';
  exception when check_violation then
    if sqlerrm not like '%crm_portal_job_documents_status_fields_check%' then raise exception 'fel nej utan hash (%)', sqlerrm; end if;
  end;
  begin
    update public.crm_portal_job_documents set queued_at = now() where id = doc_seller;
    raise exception 'ett beslut utan fil gick att köa';
  exception when check_violation then
    if sqlerrm not like '%crm_portal_job_documents_status_fields_check%' then raise exception 'fel nej för köat beslut (%)', sqlerrm; end if;
  end;
  begin
    update public.crm_portal_job_documents set status = 'failed' where id = doc_seller;
    raise exception 'ett misslyckat dokument utan skäl gick att spara';
  exception when check_violation then
    if sqlerrm not like '%crm_portal_job_documents_status_fields_check%' then raise exception 'fel nej utan skäl (%)', sqlerrm; end if;
  end;
  -- Portalens gräns och formen på hashen och namnet.
  begin
    update public.crm_portal_job_documents set byte_size = 3300001 where quote_id = 'check-7-2';
    raise exception 'ett dokument över 3 300 000 byte gick att spara';
  exception when check_violation then
    if sqlerrm not like '%crm_portal_job_documents_byte_size_check%' then raise exception 'fel nej för storleken (%)', sqlerrm; end if;
  end;
  update public.crm_portal_job_documents set byte_size = 3300000 where quote_id = 'check-7-2';
  begin
    update public.crm_portal_job_documents set sha256 = upper(sha) where quote_id = 'check-7-2';
    raise exception 'en hash med versaler gick att spara';
  exception when check_violation then
    if sqlerrm not like '%crm_portal_job_documents_sha256_check%' then raise exception 'fel nej för hashen (%)', sqlerrm; end if;
  end;
  begin
    update public.crm_portal_job_documents set name = e' \t ' where quote_id = 'check-7-2';
    raise exception 'ett tomt namn gick att spara';
  exception when check_violation then
    if sqlerrm not like '%crm_portal_job_documents_name_check%' then raise exception 'fel nej för namnet (%)', sqlerrm; end if;
  end;
  begin
    insert into public.crm_portal_job_documents (quote_id, kind, created_by, created_by_name)
    values ('check-7-1', 'invoice', admin_id, 'Admin');
    raise exception 'en okänd sort gick att spara';
  exception when check_violation then
    if sqlerrm not like '%crm_portal_job_documents_kind_check%' then raise exception 'fel nej för sorten (%)', sqlerrm; end if;
  end;
  -- Bara orderbekräftelsen skickas automatiskt, och den som tryckte har ett namn.
  begin
    insert into public.crm_portal_job_documents (quote_id, kind) values ('check-7-4', 'self_inspection');
    raise exception 'en automatisk egenkontroll gick att spara';
  exception when check_violation then
    if sqlerrm not like '%crm_portal_job_documents_created_by_check%' then raise exception 'fel nej för automatisk egenkontroll (%)', sqlerrm; end if;
  end;
  begin
    insert into public.crm_portal_job_documents (quote_id, kind, created_by) values ('check-7-4', 'order_confirmation', admin_id);
    raise exception 'ett dokument utan avsändarens namn gick att spara';
  exception when check_violation then
    if sqlerrm not like '%crm_portal_job_documents_created_by_check%' then raise exception 'fel nej utan namn (%)', sqlerrm; end if;
  end;
  -- En automatisk orderbekräftelse per jobb (check-7-1 har redan en).
  begin
    insert into public.crm_portal_job_documents (quote_id, kind) values ('check-7-1', 'order_confirmation');
    raise exception 'två automatiska orderbekräftelser på samma jobb';
  exception when unique_violation then
    if sqlerrm not like '%crm_portal_job_documents_one_automatic_idx%' then raise exception 'fel nej för två automatiska (%)', sqlerrm; end if;
  end;
  begin
    insert into public.crm_portal_job_documents (quote_id, kind, created_by, created_by_name)
    values ('check-7-okand', 'order_confirmation', admin_id, 'Admin');
    raise exception 'ett dokument till ett okänt jobb gick att spara';
  exception when foreign_key_violation then
    if sqlerrm not like '%crm_portal_job_documents_quote_id_fkey%' then raise exception 'fel nej för okänt jobb (%)', sqlerrm; end if;
  end;

  -- Fryst, köat, och sedan aldrig misslyckat (det är redan på väg till butiken). Ett fryst som inte köats kan bli
  -- misslyckat, när jobbet avbröts under tiden.
  insert into public.crm_portal_job_documents (id, quote_id, kind, status, name, byte_size, sha256, source_ref, ready_at, created_by, created_by_name)
  values (doc_ready, 'check-7-2', 'order_confirmation', 'ready', 'Orderbekräftelse 72.pdf', 2000, sha, '72', now(), admin_id, 'Admin');
  update public.crm_portal_job_documents set status = 'failed', error = 'Jobbet är avbrutet.' where id = doc_ready and queued_at is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'ett fryst dokument som inte köats gick inte att markera misslyckat'; end if;
  update public.crm_portal_job_documents set status = 'ready', error = null, queued_at = now() where id = doc_ready;
  begin
    update public.crm_portal_job_documents set status = 'failed', error = 'x' where id = doc_ready;
    raise exception 'ett köat dokument gick att markera misslyckat';
  exception when check_violation then
    if sqlerrm not like '%crm_portal_job_documents_status_fields_check%' then raise exception 'fel nej för köat (%)', sqlerrm; end if;
  end;

  -- Lånet på ett beslut tas en gång (som buildAutomatic gör det). check-7-3 har redan sin automatiska, så ett tryckt.
  insert into public.crm_portal_job_documents (id, quote_id, kind, next_attempt_at, created_by, created_by_name)
  values ('d7000000-0000-4000-8000-000000000009', 'check-7-3', 'order_confirmation', now() - interval '1 minute', admin_id, 'Admin');
  update public.crm_portal_job_documents set next_attempt_at = now() + interval '10 minutes', attempts = attempts + 1
   where id = 'd7000000-0000-4000-8000-000000000009' and status = 'building' and next_attempt_at = now() - interval '1 minute';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'service_role: lånet gick inte att ta'; end if;
  update public.crm_portal_job_documents set next_attempt_at = now() + interval '10 minutes', attempts = attempts + 1
   where id = 'd7000000-0000-4000-8000-000000000009' and status = 'building' and next_attempt_at = now() - interval '1 minute';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'service_role: lånet togs två gånger'; end if;
  reset role;

  raise notice 'portal_job_documents: allt stämmer';
end $$;

rollback;
