-- Beteendet hos meddelandenas migrering (20260928151026_portal_job_messages.sql), prövat mot en databas.
--
-- BARA LOKALT. Skriptet lägger in en provbutik, tre provordrar med jobb och butikens meddelanden, prövar läsning, svar
-- och köns läspolicy med riktiga sessioner (admin, säljare, konsult, ekonomi, montör, anon) och rullar sedan tillbaka
-- allt. Ett fel avbryter med ett meddelande som säger vad som inte stämde. Kräver seedens testanvändare
-- (<roll>@example.test).
--
--   psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -v ON_ERROR_STOP=1 -f supabase/checks/portal_job_messages.sql

begin;

do $$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-000000000001';
  seller_id constant uuid := '00000000-0000-4000-8000-000000000002';
  konsult_id constant uuid := '00000000-0000-4000-8000-000000000003';
  ekonomi_id constant uuid := '00000000-0000-4000-8000-000000000004';
  montor_id constant uuid := '00000000-0000-4000-8000-000000000005';
  wo_seller constant uuid := 'c6000000-0000-4000-8000-000000000001';
  wo_admin constant uuid := 'c6000000-0000-4000-8000-000000000002';
  wo_montor constant uuid := 'c6000000-0000-4000-8000-000000000003';
  n integer;
  who uuid;
  reply_key text;
  stamp timestamptz;
  comments_before integer;
begin
  -- Som intaget gör det (service-rollen): butiken, arbetsordrarna, jobben och butikens meddelanden.
  insert into public.crm_portal_resellers (reseller_id, name) values ('check-6', 'Provbutiken AB');
  insert into public.crm_work_orders (id, order_number, project_name, client_name, quote_type, created_by, assigned_to)
  values (wo_seller, 'AO-CHECK-6-1', 'Rönnvägen 18, Gävle', 'Provbutiken AB', 'business', seller_id, seller_id),
         -- Någon annans order: säljaren läser men får inte svara.
         (wo_admin, 'AO-CHECK-6-2', 'Aspvägen 4, Gävle', 'Provbutiken AB', 'business', admin_id, admin_id),
         -- Ansvarig utan crm.workorder.read: prövar läspolicyns andra väg (ansvarig för ordern).
         (wo_montor, 'AO-CHECK-6-3', 'Björkvägen 2, Gävle', 'Provbutiken AB', 'business', montor_id, montor_id);
  insert into public.crm_portal_jobs (quote_id, quote_number, reseller_id, store_name, assigned_to, assignment_source,
                                      reserved_work_order_id, work_order_id, work_order_created_at, payload)
  values ('check-6-1', '2026-061', 'check-6', 'Provbutiken AB', seller_id, 'reseller_seller', wo_seller, wo_seller, now(), '{}'),
         ('check-6-2', '2026-062', 'check-6', 'Provbutiken AB', admin_id, 'fallback', wo_admin, wo_admin, now(), '{}'),
         ('check-6-3', '2026-063', 'check-6', 'Provbutiken AB', montor_id, 'fallback', wo_montor, wo_montor, now(), '{}');
  select count(*) into comments_before from public.crm_work_order_comments where work_order_id in (wo_seller, wo_admin, wo_montor);

  set local role service_role;
  insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, body, sent_at)
  values ('check-6-1', 'from_store', 'check-6-in-1', 'Sara Ek', 'Hej från Gävle', now() - interval '1 hour'),
         ('check-6-2', 'from_store', 'check-6-in-2', 'Sara Ek', 'Och den andra', now() - interval '1 hour'),
         ('check-6-3', 'from_store', 'check-6-in-3', 'Sara Ek', 'Och den tredje', now() - interval '1 hour');
  -- En händelse i kön som inte hör till något svar (prislistan): sessionen ska aldrig se den via svarens policy.
  insert into public.portal_outbound_events (idempotency_key, path, payload, ordering_key)
  values ('check-6-pricelist', '/api/ekovilla/pricelists', '{}', 'pricelist');
  reset role;

  -- 1. De som läser arbetsordrar kontorsvägen (crm.workorder.read) läser tråden på alla tre, men aldrig markeringarna,
  --    och ändrar eller tar aldrig bort något.
  foreach who in array array[admin_id, seller_id, konsult_id, ekonomi_id] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.crm_portal_job_messages where quote_id in ('check-6-1', 'check-6-2', 'check-6-3');
    if n <> 3 then raise exception '%: ser % av 3 meddelanden', who, n; end if;
    begin
      perform notified_at from public.crm_portal_job_messages where quote_id = 'check-6-1';
      raise exception '%: kunde läsa notified_at', who;
    exception when insufficient_privilege then null;
    end;
    begin
      perform queued_at from public.crm_portal_job_messages where quote_id = 'check-6-1';
      raise exception '%: kunde läsa queued_at', who;
    exception when insufficient_privilege then null;
    end;
    begin
      update public.crm_portal_job_messages set body = 'Kapad' where quote_id = 'check-6-1';
      raise exception '%: kunde ändra ett meddelande', who;
    exception when insufficient_privilege then null;
    end;
    begin
      delete from public.crm_portal_job_messages where quote_id = 'check-6-1';
      raise exception '%: kunde ta bort ett meddelande', who;
    exception when insufficient_privilege then null;
    end;
    -- Köns läspolicy för svaren släpper aldrig igenom något annat (admin ser allt genom 2b:s crm.portal.manage).
    if who <> admin_id then
      select count(*) into n from public.portal_outbound_events where idempotency_key = 'check-6-pricelist';
      if n <> 0 then raise exception '%: ser prislistans händelse i kön', who; end if;
    end if;
    reset role;
  end loop;

  -- 2. Montören (ingen crm.workorder.read, alltså fältvyn) ser bara tråden på ordern hen själv är ansvarig för, och
  --    aldrig någon annans.
  perform set_config('request.jwt.claims', json_build_object('sub', montor_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.crm_portal_job_messages where quote_id in ('check-6-1', 'check-6-2');
  if n <> 0 then raise exception 'montör: ser tråden på en annans order'; end if;
  select count(*) into n from public.crm_portal_job_messages where quote_id = 'check-6-3';
  if n <> 1 then raise exception 'montör: ser inte tråden på sin egen order'; end if;
  reset role;

  -- 3. Utan inloggning: ingenting.
  set local role anon;
  begin
    perform body from public.crm_portal_job_messages;
    raise exception 'anon: kunde läsa meddelandena';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 4. Säljaren svarar på sin egen order, i eget namn. Tiden och nyckeln sätter databasen.
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, author_user_id, department, body)
  values ('check-6-1', 'to_store', 'check-6-out-1', 'Säljaren', seller_id, 'Planering', 'Vi kommer tisdag.');
  select outbound_key, sent_at into reply_key, stamp from public.crm_portal_job_messages where message_id = 'check-6-out-1';
  if reply_key is distinct from 'job.message-check-6-out-1' then raise exception 'säljaren: nyckeln blev %', reply_key; end if;
  if stamp is distinct from now() then raise exception 'säljaren: tiden sattes inte av databasen'; end if;

  -- Samma id igen (dubbelklick): ingenting nytt, inget fel (det PostgREST gör med ignoreDuplicates).
  insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, author_user_id, department, body)
  values ('check-6-1', 'to_store', 'check-6-out-1', 'Säljaren', seller_id, 'Planering', 'Vi kommer tisdag.')
  on conflict (direction, message_id) do nothing;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'säljaren: samma id gav ett svar till'; end if;

  -- Ett skickat svar är slutgiltigt.
  begin
    update public.crm_portal_job_messages set body = 'Onsdag i stället.' where message_id = 'check-6-out-1';
    raise exception 'säljaren: kunde ändra sitt svar';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.crm_portal_job_messages where message_id = 'check-6-out-1';
    raise exception 'säljaren: kunde ta bort sitt svar';
  exception when insufficient_privilege then null;
  end;

  -- Tiden och markeringarna är aldrig sessionens.
  begin
    insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, author_user_id, department, body, sent_at)
    values ('check-6-1', 'to_store', 'check-6-out-x', 'Säljaren', seller_id, 'Planering', 'Bakdaterat', now() - interval '1 year');
    raise exception 'säljaren: kunde sätta tiden';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, author_user_id, department, body, queued_at)
    values ('check-6-1', 'to_store', 'check-6-out-x', 'Säljaren', seller_id, 'Planering', 'Köad?', now());
    raise exception 'säljaren: kunde sätta queued_at';
  exception when insufficient_privilege then null;
  end;

  -- Någon annans order, någon annans namn, eller som om butiken skrev: nej.
  begin
    insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, author_user_id, department, body)
    values ('check-6-2', 'to_store', 'check-6-out-x', 'Säljaren', seller_id, 'Försäljning', 'Hej');
    raise exception 'säljaren: kunde svara på en annans order';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, author_user_id, department, body)
    values ('check-6-1', 'to_store', 'check-6-out-x', 'Admin', admin_id, 'Försäljning', 'Hej');
    raise exception 'säljaren: kunde svara i en annans namn';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, department, body)
    values ('check-6-1', 'from_store', 'check-6-in-x', 'Sara Ek', '', 'Låtsas butiken');
    raise exception 'säljaren: kunde skriva som butiken';
  exception when insufficient_privilege then null;
  end;
  -- Också i eget namn. Två skydd: policyns riktning, och tabellens check (butikens meddelande har ingen svarare).
  begin
    insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, author_user_id, department, body)
    values ('check-6-1', 'from_store', 'check-6-in-y', 'Säljaren', seller_id, '', 'Låtsas butiken i eget namn');
    raise exception 'säljaren: kunde skriva som butiken i eget namn';
  exception when insufficient_privilege or check_violation then null;
  end;
  reset role;

  -- 5. Köns rad för svaret (som enqueuePortalEvent lägger den): de som ser svaret ser den, montören inte.
  set local role service_role;
  insert into public.portal_outbound_events (idempotency_key, path, payload, ordering_key)
  values (reply_key, '/api/ekovilla/events', '{}', 'job:check-6-1');
  reset role;
  foreach who in array array[seller_id, konsult_id, ekonomi_id] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.portal_outbound_events where idempotency_key = reply_key;
    if n <> 1 then raise exception '%: ser inte svarets rad i kön', who; end if;
    reset role;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', montor_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.portal_outbound_events where idempotency_key in (reply_key, 'check-6-pricelist');
  if n <> 0 then raise exception 'montör: ser köns rader för en annans order'; end if;
  reset role;

  -- 6. Admin får svara på en order hen inte har; konsult och ekonomi (ingen skrivnyckel) får aldrig, och inte heller
  --    montören på sin egen order (ansvarig men utan crm.workorder.write).
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, author_user_id, department, body)
  values ('check-6-1', 'to_store', 'check-6-out-admin', 'Admin', admin_id, 'Ekonomi', 'Fakturan kommer.');
  reset role;
  foreach who in array array[konsult_id, ekonomi_id] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, author_user_id, department, body)
      values ('check-6-1', 'to_store', 'check-6-out-' || who, 'X', who, 'Försäljning', 'Hej');
      raise exception '%: kunde svara utan skrivnyckeln', who;
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', montor_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, author_user_id, department, body)
    values ('check-6-3', 'to_store', 'check-6-out-montor', 'Montör', montor_id, 'Försäljning', 'Hej');
    raise exception 'montör: kunde svara utan skrivnyckeln';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 7. Tabellens spärrar (som service-rollen, som inte hindras av policyerna).
  set local role service_role;
  begin
    insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, author_user_id, department, body)
    values ('check-6-1', 'to_store', 'check-6-c1', 'X', seller_id, '', 'Hej');
    raise exception 'ett svar utan avdelning gick att spara';
  exception when check_violation then null;
  end;
  begin
    insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, department, body)
    values ('check-6-1', 'from_store', 'check-6-c2', 'Sara Ek', 'Planering', 'Hej');
    raise exception 'butikens meddelande fick en avdelning';
  exception when check_violation then null;
  end;
  -- Riktningens fält: ett svar har en svarare och notiseras aldrig, butikens meddelande har ingen svarare och köas aldrig.
  begin
    insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, author_user_id, body)
    values ('check-6-1', 'from_store', 'check-6-d1', 'Sara Ek', seller_id, 'Hej');
    raise exception 'butikens meddelande fick en svarare';
  exception when check_violation then null;
  end;
  begin
    insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, body, queued_at)
    values ('check-6-1', 'from_store', 'check-6-d2', 'Sara Ek', 'Hej', now());
    raise exception 'butikens meddelande köades';
  exception when check_violation then null;
  end;
  begin
    insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, department, body)
    values ('check-6-1', 'to_store', 'check-6-d3', 'X', 'Försäljning', 'Hej');
    raise exception 'ett svar utan svarare gick att spara';
  exception when check_violation then null;
  end;
  begin
    insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, author_user_id, department, body, notified_at)
    values ('check-6-1', 'to_store', 'check-6-d4', 'X', seller_id, 'Försäljning', 'Hej', now());
    raise exception 'ett svar notiserades';
  exception when check_violation then null;
  end;
  begin
    insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, body)
    values ('check-6-1', 'from_store', 'check-6-c3', 'Sara Ek', e'  \n\t ');
    raise exception 'ett tomt meddelande gick att spara';
  exception when check_violation then null;
  end;
  begin
    insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, body)
    values ('check-6-1', 'from_store', 'check-6-c4', 'Sara Ek', repeat('a', 5001));
    raise exception 'ett meddelande över 5000 tecken gick att spara';
  exception when check_violation then null;
  end;
  begin
    insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, body)
    values ('check-6-1', 'from_store', 'har mellanslag', 'Sara Ek', 'Hej');
    raise exception 'ett id med mellanslag gick att spara';
  exception when check_violation then null;
  end;
  begin
    insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, body)
    values ('check-6-okand', 'from_store', 'check-6-c5', 'Sara Ek', 'Hej');
    raise exception 'ett meddelande till ett okänt jobb gick att spara';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, body)
    values ('check-6-1', 'from_store', 'check-6-in-1', 'Sara Ek', 'Samma id');
    raise exception 'samma id från butiken sparades två gånger';
  exception when unique_violation then null;
  end;
  -- 5000 tecken som Postgres räknar dem: ett emoji är ett.
  insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, body)
  values ('check-6-1', 'from_store', 'check-6-emoji', 'Sara Ek', repeat(U&'\+01F600', 5000));
  -- Samma id åt båda hållen krockar inte.
  insert into public.crm_portal_job_messages (quote_id, direction, message_id, author_name, body)
  values ('check-6-1', 'from_store', 'check-6-out-1', 'Sara Ek', 'Samma id som svaret');

  -- Notisen tas en gång.
  update public.crm_portal_job_messages set notified_at = now() where message_id = 'check-6-in-1' and notified_at is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'service_role: notisen gick inte att ta'; end if;
  update public.crm_portal_job_messages set notified_at = now() where message_id = 'check-6-in-1' and notified_at is null;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'service_role: notisen togs två gånger'; end if;
  reset role;

  -- 8. Inget av det här blev en intern kommentar.
  select count(*) - comments_before into n from public.crm_work_order_comments where work_order_id in (wo_seller, wo_admin, wo_montor);
  if n <> 0 then raise exception 'meddelandena gav % interna kommentarer', n; end if;

  raise notice 'portal_job_messages: allt stämmer';
end $$;

rollback;
