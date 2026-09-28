-- Beteendet hos prislistans migrering (20260928072725_portal_pricelist_publications.sql), prövat mot en databas.
--
-- BARA LOKALT. Skriptet prövar behörigheterna med riktiga sessioner (admin, säljare, anon) och reglerna på
-- publiceringarna, och rullar sedan tillbaka allt. Ett fel avbryter med ett meddelande som säger vad som inte
-- stämde. Kräver seedens testanvändare (admin@example.test, saljare@example.test) och 2a:s portalfält.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -v ON_ERROR_STOP=1 -f supabase/checks/portal_pricelist.sql

begin;

do $$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-000000000001';
  seller_id constant uuid := '00000000-0000-4000-8000-000000000002';
  hash constant text := repeat('ab', 32);
  n integer;
begin
  -- En händelse i kön att läsa, och en rad med portalfält (2a:s ifyllnad) att läsa.
  insert into public.portal_outbound_events (idempotency_key, path, payload, ordering_key)
  values ('pricelist-2026-10-01-' || hash || '-1', '/api/ekovilla/pricelists', '{}', 'pricelist');

  -- Admin utan crm.article.manage: läser portalfälten bara genom den nya policyn (crm.portal.manage).
  insert into public.user_permissions (user_id, permission_key, effect) values (admin_id, 'crm.article.manage', 'revoke');

  -- 1. Admin (crm.portal.manage).
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.crm_portal_article_fields;
  if n < 1 then raise exception 'admin: läser inga portalfält utan crm.article.manage; policyn för crm.portal.manage saknas'; end if;

  insert into public.crm_portal_pricelist_publications (valid_from, content_hash, sequence, idempotency_key, payload, article_count, published_by, published_by_name)
  values ('2026-10-01', hash, 1, 'pricelist-2026-10-01-' || hash || '-1', '{"articles": []}', 1, admin_id, 'Admin');
  select count(*) into n from public.crm_portal_pricelist_publications;
  if n < 1 then raise exception 'admin: ser inte publiceringen den just sparade'; end if;

  -- Samma nyckel igen: ingen ny rad (unik nyckel; appen gör ON CONFLICT DO NOTHING).
  insert into public.crm_portal_pricelist_publications (valid_from, content_hash, sequence, idempotency_key, payload, article_count, published_by)
  values ('2026-10-01', hash, 1, 'pricelist-2026-10-01-' || hash || '-1', '{}', 1, admin_id)
  on conflict (idempotency_key) do nothing;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'admin: samma nyckel gav en ny publicering'; end if;

  -- Bara i sitt eget namn.
  begin
    insert into public.crm_portal_pricelist_publications (valid_from, content_hash, sequence, idempotency_key, payload, article_count, published_by)
    values ('2026-10-01', hash, 2, 'pricelist-2026-10-01-' || hash || '-2', '{}', 1, seller_id);
    raise exception 'admin: kunde publicera i en annans namn';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.crm_portal_pricelist_publications (valid_from, content_hash, sequence, idempotency_key, payload, article_count)
    values ('2026-10-01', hash, 2, 'pricelist-2026-10-01-' || hash || '-2', '{}', 1);
    raise exception 'admin: kunde publicera utan namn';
  exception when insufficient_privilege then null;
  end;

  -- Historiken ändras och tas aldrig bort.
  begin
    update public.crm_portal_pricelist_publications set article_count = 2;
    raise exception 'admin: en publicering gick att ändra';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.crm_portal_pricelist_publications;
    raise exception 'admin: en publicering gick att ta bort';
  exception when insufficient_privilege then null;
  end;

  -- Kön: läsa ja, skriva nej.
  select count(*) into n from public.portal_outbound_events where idempotency_key = 'pricelist-2026-10-01-' || hash || '-1';
  if n <> 1 then raise exception 'admin: läser inte kön'; end if;
  begin
    insert into public.portal_outbound_events (idempotency_key, path, payload, ordering_key)
    values ('check-2b', '/api/ekovilla/pricelists', '{}', 'pricelist');
    raise exception 'admin: kunde köa en händelse med sessionen';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.portal_outbound_events set status = 'dead';
    raise exception 'admin: kunde ändra kön med sessionen';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_portal_outbound_events(10);
    raise exception 'admin: kunde ta händelser ur kön med sessionen';
  exception when insufficient_privilege then null;
  end;

  -- Reglerna på raden.
  begin
    insert into public.crm_portal_pricelist_publications (valid_from, content_hash, sequence, idempotency_key, payload, article_count, published_by)
    values ('2026-10-02', hash, 3, 'pricelist-2026-10-02-' || hash || '-3', '{}', 0, admin_id);
    raise exception 'regel: en tom lista gick att spara';
  exception when check_violation then null;
  end;
  begin
    insert into public.crm_portal_pricelist_publications (valid_from, content_hash, sequence, idempotency_key, payload, article_count, published_by)
    values ('2026-10-02', hash, 3, 'pricelist-2026-10-02-' || repeat('cd', 32) || '-3', '{}', 1, admin_id);
    raise exception 'regel: nyckeln fick en annan hash än raden';
  exception when check_violation then null;
  end;
  begin
    insert into public.crm_portal_pricelist_publications (valid_from, content_hash, sequence, idempotency_key, payload, article_count, published_by)
    values ('2026-10-02', hash, 3, 'pricelist-2026-10-02-' || hash || '-4', '{}', 1, admin_id);
    raise exception 'regel: nyckeln fick ett annat löpnummer än raden';
  exception when check_violation then null;
  end;
  begin
    insert into public.crm_portal_pricelist_publications (valid_from, content_hash, sequence, idempotency_key, payload, article_count, published_by)
    values ('2026-10-02', 'ABC', 3, 'pricelist-2026-10-02-ABC-3', '{}', 1, admin_id);
    raise exception 'regel: en hash som inte är sha256-hex gick att spara';
  exception when check_violation then null;
  end;

  reset role;

  -- 2. Säljaren (utan crm.portal.manage): ser ingenting och kan inte publicera.
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.crm_portal_pricelist_publications;
  if n <> 0 then raise exception 'säljare: ser % publiceringar', n; end if;
  select count(*) into n from public.portal_outbound_events;
  if n <> 0 then raise exception 'säljare: ser % händelser i kön', n; end if;
  select count(*) into n from public.crm_portal_article_fields;
  if n <> 0 then raise exception 'säljare: ser % portalfält', n; end if;
  begin
    insert into public.crm_portal_pricelist_publications (valid_from, content_hash, sequence, idempotency_key, payload, article_count, published_by)
    values ('2026-10-03', hash, 5, 'pricelist-2026-10-03-' || hash || '-5', '{}', 1, seller_id);
    raise exception 'säljare: kunde publicera';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- 3. anon når ingen av tabellerna.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    perform 1 from public.crm_portal_pricelist_publications limit 1;
    raise exception 'anon: kunde läsa publiceringarna';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.portal_outbound_events limit 1;
    raise exception 'anon: kunde läsa kön';
  exception when insufficient_privilege then null;
  end;
  reset role;

  raise notice 'prislistan: alla kontroller gick igenom';
end $$;

rollback;
