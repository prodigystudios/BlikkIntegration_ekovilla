-- Beteendet hos portalens utskickskö (20260928053434_portal_outbox_idempotency.sql), prövat mot en databas.
--
-- BARA LOKALT. Skriptet lägger in testrader, prövar claim_portal_outbound_events och behörigheterna, och rullar
-- sedan tillbaka allt. Ett fel avbryter med ett meddelande som säger vad som inte stämde.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -v ON_ERROR_STOP=1 -f supabase/checks/portal_outbox.sql
--
-- Samtidigheten (två utskick som aldrig tar samma händelse) prövas inte här: den vilar på `for update skip locked`
-- med villkoren på själva raden, det vanliga kömönstret i Postgres.

begin;

do $$
declare
  claimed text[];
  n integer;
begin
  delete from public.portal_outbound_events where ordering_key like 'check:%';

  insert into public.portal_outbound_events (idempotency_key, path, payload, ordering_key, status, created_at, next_attempt_at)
  values
    ('check-a1', '/api/ekovilla/events', '{}', 'check:A', 'pending', now() - interval '5 minutes', now()),
    ('check-a2', '/api/ekovilla/events', '{}', 'check:A', 'pending', now() - interval '4 minutes', now()),
    ('check-b1', '/api/ekovilla/events', '{}', 'check:B', 'pending', now() - interval '3 minutes', now()),
    ('check-c1', '/api/ekovilla/events', '{}', 'check:C', 'pending', now() - interval '3 minutes', now() + interval '1 hour'),
    ('check-d1', '/api/ekovilla/events', '{}', 'check:D', 'dead', now() - interval '3 minutes', now()),
    ('check-d2', '/api/ekovilla/events', '{}', 'check:D', 'pending', now() - interval '2 minutes', now()),
    ('check-e1', '/api/ekovilla/events', '{}', 'check:E', 'superseded', now() - interval '2 minutes', now()),
    ('check-e2', '/api/ekovilla/events', '{}', 'check:E', 'pending', now() - interval '1 minute', now());

  -- 1. Huvudet per nyckel, bara det som är dags: A1 (inte A2 bakom den), B1, D2 (D1 är uppgiven), E2 (E1 ersatt).
  --    C1 väntar på sitt nästa försök.
  select array_agg(idempotency_key order by idempotency_key) into claimed from public.claim_portal_outbound_events(10);
  if claimed is distinct from array['check-a1', 'check-b1', 'check-d2', 'check-e2'] then
    raise exception 'claim 1: fick %, väntade {check-a1,check-b1,check-d2,check-e2}', claimed;
  end if;
  if exists (select 1 from public.portal_outbound_events where idempotency_key = 'check-a1' and (status <> 'sending' or attempts <> 1 or claimed_at is null)) then
    raise exception 'claim 1: check-a1 är inte "sending" med attempts = 1 och en claim';
  end if;

  -- 2. Allt som tagits skickas nu. A2 står bakom A1, så ingenting är ledigt.
  select count(*) into n from public.claim_portal_outbound_events(10);
  if n <> 0 then raise exception 'claim 2: fick % händelser, väntade 0', n; end if;

  -- 3. A1 levererad: då är A2 huvudet.
  update public.portal_outbound_events set status = 'sent', sent_at = now() where idempotency_key = 'check-a1';
  select array_agg(idempotency_key) into claimed from public.claim_portal_outbound_events(10);
  if claimed is distinct from array['check-a2'] then
    raise exception 'claim 3: fick %, väntade {check-a2}', claimed;
  end if;

  -- 4. B1 fastnade i "sending" (en funktion som dog): efter p_stale_after tas den om, och försöket räknas.
  update public.portal_outbound_events set claimed_at = now() - interval '10 minutes' where idempotency_key = 'check-b1';
  select array_agg(idempotency_key) into claimed from public.claim_portal_outbound_events(10, interval '2 minutes');
  if claimed is distinct from array['check-b1'] then
    raise exception 'claim 4: fick %, väntade {check-b1}', claimed;
  end if;
  if not exists (select 1 from public.portal_outbound_events where idempotency_key = 'check-b1' and attempts = 2) then
    raise exception 'claim 4: check-b1 har inte attempts = 2';
  end if;

  -- 5. Taket: två lediga, limit 1 ger en, den äldsta först.
  update public.portal_outbound_events set next_attempt_at = now() - interval '1 second' where idempotency_key = 'check-c1';
  insert into public.portal_outbound_events (idempotency_key, path, payload, ordering_key, created_at)
  values ('check-f1', '/api/ekovilla/events', '{}', 'check:F', now());
  select array_agg(idempotency_key) into claimed from public.claim_portal_outbound_events(1);
  if claimed is distinct from array['check-c1'] then
    raise exception 'claim 5: fick %, väntade {check-c1} (den äldsta av två lediga)', claimed;
  end if;

  -- 6. Kön kan inte peka någon annanstans än portalens egna routes.
  begin
    insert into public.portal_outbound_events (idempotency_key, path, payload, ordering_key)
    values ('check-x', 'https://example.com/api/ekovilla/events', '{}', 'check:X');
    raise exception 'path: en fullständig adress godtogs';
  exception when check_violation then null;
  end;

  raise notice 'portal_outbox: kön beter sig som väntat';
end $$;

-- 7. Sessionerna når varken tabellerna eller funktionen. Behörigheten frågas direkt: ett anrop som stoppas av
--    tabellens saknade grant hade dolt en felaktig EXECUTE-grant på funktionen.
do $$
declare
  who text;
begin
  foreach who in array array['anon', 'authenticated', 'public'] loop
    if has_function_privilege(who, 'public.claim_portal_outbound_events(integer, interval)', 'EXECUTE') then
      raise exception '% kan köra claim_portal_outbound_events', who;
    end if;
  end loop;
end $$;
set local role authenticated;
do $$
begin
  begin
    perform 1 from public.portal_outbound_events limit 1;
    raise exception 'authenticated kan läsa portal_outbound_events';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.portal_idempotency_keys limit 1;
    raise exception 'authenticated kan läsa portal_idempotency_keys';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_portal_outbound_events(1);
    raise exception 'authenticated kan köra claim_portal_outbound_events';
  exception when insufficient_privilege then null;
  end;
end $$;
set local role anon;
do $$
begin
  begin
    perform public.claim_portal_outbound_events(1);
    raise exception 'anon kan köra claim_portal_outbound_events';
  exception when insufficient_privilege then null;
  end;
  raise notice 'portal_outbox: anon och authenticated nekas';
end $$;
reset role;

rollback;
