-- Beteendet hos portalfälten per artikel (20260928064437_portal_article_fields.sql), prövat mot en databas.
--
-- BARA LOKALT. Skriptet prövar behörigheterna med riktiga sessioner (admin, säljare, anon) och reglerna på raderna,
-- och rullar sedan tillbaka allt. Ett fel avbryter med ett meddelande som säger vad som inte stämde. Kräver seedens
-- testanvändare (admin@example.test, saljare@example.test).
--
--   psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -v ON_ERROR_STOP=1 -f supabase/checks/portal_article_fields.sql

begin;

do $$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-000000000001';
  seller_id constant uuid := '00000000-0000-4000-8000-000000000002';
  n integer;
  share numeric;
  after_ts timestamptz;
begin
  -- 0. Ifyllnaden: de 51 artiklarna, alla publicerade, med unika platser i ordningen.
  select count(*) into n from public.crm_portal_article_fields where publish and customer_name <> '' and category is not null;
  if n < 51 then raise exception 'ifyllnaden: % publicerbara rader, väntade minst 51', n; end if;

  -- 1. Admin (crm.article.manage) läser, lägger till och ändrar.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.crm_portal_article_fields;
  if n < 51 then raise exception 'admin: läser % rader, väntade minst 51', n; end if;

  insert into public.crm_portal_article_fields (article_number, customer_name, category, labor_share, sort_order, publish, updated_by)
  values ('check-2a', 'Provartikel', 'ovrigt', 0.25, 9999, true, admin_id);

  -- updated_at sätts av triggern: ett gammalt datum i satsen skrivs över med now().
  update public.crm_portal_article_fields
  set note = 'Ändrad', updated_by = admin_id, updated_at = '2000-01-01'
  where article_number = 'check-2a';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'admin: update ändrade % rader, väntade 1', n; end if;
  select updated_at into after_ts from public.crm_portal_article_fields where article_number = 'check-2a';
  if after_ts <> now() then raise exception 'admin: updated_at blev %, triggern satte inte now()', after_ts; end if;

  -- Upserten som redigeringen gör: on conflict do update kräver både insert- och update-policyn.
  insert into public.crm_portal_article_fields (article_number, customer_name, category, labor_share, sort_order, publish)
  values ('check-2a', 'Provartikel 2', 'ovrigt', 0.3, 9999, true)
  on conflict (article_number) do update set customer_name = excluded.customer_name, labor_share = excluded.labor_share;
  select labor_share into share from public.crm_portal_article_fields where article_number = 'check-2a';
  if share <> 0.3 then raise exception 'admin: upserten gav labor_share %, väntade 0.3', share; end if;

  -- Ingen delete för sessionen: redigeringen tar aldrig bort, publish = nej räcker.
  begin
    delete from public.crm_portal_article_fields where article_number = 'check-2a';
    raise exception 'admin: delete gick igenom, sessionen ska inte ha delete';
  exception when insufficient_privilege then null;
  end;

  -- 2. Reglerna på raden.
  begin
    update public.crm_portal_article_fields set customer_name = '' where article_number = 'check-2a';
    raise exception 'regel: en publicerad artikel fick tomt kundnamn';
  exception when check_violation then null;
  end;
  begin
    update public.crm_portal_article_fields set category = null where article_number = 'check-2a';
    raise exception 'regel: en publicerad artikel fick kategori null';
  exception when check_violation then null;
  end;
  -- Opublicerad får sakna båda.
  update public.crm_portal_article_fields set publish = false, customer_name = '', category = null where article_number = 'check-2a';
  begin
    update public.crm_portal_article_fields set category = 'fel' where article_number = 'check-2a';
    raise exception 'regel: kategorin "fel" släpptes igenom';
  exception when check_violation then null;
  end;
  begin
    update public.crm_portal_article_fields set labor_share = 1.001 where article_number = 'check-2a';
    raise exception 'regel: labor_share över 1 släpptes igenom';
  exception when check_violation then null;
  end;
  begin
    update public.crm_portal_article_fields set labor_share = -0.001 where article_number = 'check-2a';
    raise exception 'regel: negativ labor_share släpptes igenom';
  exception when check_violation then null;
  end;
  begin
    update public.crm_portal_article_fields set sort_order = -1 where article_number = 'check-2a';
    raise exception 'regel: negativ sort_order släpptes igenom';
  exception when check_violation then null;
  end;
  begin
    update public.crm_portal_article_fields set customer_name = ' Lösull ' where article_number = 'check-2a';
    raise exception 'regel: kundnamn med blanksteg runt släpptes igenom';
  exception when check_violation then null;
  end;
  begin
    update public.crm_portal_article_fields set note = repeat('x', 501) where article_number = 'check-2a';
    raise exception 'regel: anteckning över 500 tecken släpptes igenom';
  exception when check_violation then null;
  end;
  begin
    insert into public.crm_portal_article_fields (article_number) values (' 2410509');
    raise exception 'regel: artikelnummer med blanksteg runt släpptes igenom';
  exception when check_violation then null;
  end;
  -- numeric(4,3) avrundar en fjärde decimal i stället för att neka den. Därför nekar appen fler än tre decimaler
  -- (lib/domains/portal/articleFields.ts) innan värdet når hit.
  update public.crm_portal_article_fields set labor_share = 0.4555 where article_number = 'check-2a';
  select labor_share into share from public.crm_portal_article_fields where article_number = 'check-2a';
  if share <> 0.456 then raise exception 'regel: 0.4555 blev %, väntade avrundning till 0.456', share; end if;

  reset role;

  -- 3. Säljaren (utan crm.article.manage) ser ingenting, ändrar ingenting och kan inte lägga till.
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.crm_portal_article_fields;
  if n <> 0 then raise exception 'säljare: läser % rader, väntade 0', n; end if;

  -- UPDATE på rader RLS döljer ger inget fel, bara 0 rader: räkna.
  update public.crm_portal_article_fields set customer_name = 'Kapad' where article_number = '2410509';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'säljare: update ändrade % rader, väntade 0', n; end if;

  begin
    insert into public.crm_portal_article_fields (article_number, customer_name, category) values ('check-2a-saljare', 'X', 'ovrigt');
    raise exception 'säljare: insert gick igenom';
  exception when insufficient_privilege then null;
  end;

  reset role;

  -- 4. anon når inte tabellen alls.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    perform 1 from public.crm_portal_article_fields limit 1;
    raise exception 'anon: kunde läsa tabellen';
  exception when insufficient_privilege then null;
  end;
  reset role;

  if (select customer_name from public.crm_portal_article_fields where article_number = '2410509') <> 'Lösull på vinden' then
    raise exception 'säljarens update ändrade 2410509';
  end if;

  raise notice 'portalfälten: alla kontroller gick igenom';
end $$;

rollback;
