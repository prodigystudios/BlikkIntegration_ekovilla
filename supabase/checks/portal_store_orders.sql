-- Beteendet hos butiksbeställningarnas migrering (20260929065116_portal_store_orders.sql), prövat mot en databas.
--
-- BARA LOKALT. Skriptet lägger in en provbutik, en provkund och tre provbeställningar, prövar läsningen och regeln för
-- vem som får hantera en beställning med riktiga sessioner (admin, säljare, konsult, ekonomi, montör, anon), vakten och
-- tabellens spärrar med service-rollen, och rullar sedan tillbaka allt. Varje nej måste vara RÄTT nej (sqlerrm): ett
-- nej från fel ställe (en annan spärr, en grant i stället för policyn) hade dolt att skyddet saknas. Ett fel avbryter
-- med ett meddelande som säger vad som inte stämde. Kräver seedens testanvändare (<roll>@example.test).
--
--   psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -v ON_ERROR_STOP=1 -f supabase/checks/portal_store_orders.sql

begin;

do $$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-000000000001';
  seller_id constant uuid := '00000000-0000-4000-8000-000000000002';
  konsult_id constant uuid := '00000000-0000-4000-8000-000000000003';
  ekonomi_id constant uuid := '00000000-0000-4000-8000-000000000004';
  montor_id constant uuid := '00000000-0000-4000-8000-000000000005';
  so_seller constant uuid := 'e8000000-0000-4000-8000-000000000001';
  so_admin constant uuid := 'e8000000-0000-4000-8000-000000000002';
  so_guard constant uuid := 'e8000000-0000-4000-8000-000000000003';
  so_konsult constant uuid := 'e8000000-0000-4000-8000-000000000004';
  customer constant uuid := 'e8000000-0000-4000-8000-0000000000c1';
  customer2 constant uuid := 'e8000000-0000-4000-8000-0000000000c2';
  granted constant text := 'permission denied for table crm_store_orders';
  body constant jsonb := '{"orderId":"x","lines":[]}';
  n integer;
  who uuid;
  col text;
  st text;
  marked timestamptz;
  cust uuid;
begin
  insert into public.crm_portal_resellers (reseller_id, name) values ('check-8', 'Provbutiken AB');
  insert into public.crm_customers (id, customer_type, company_name, assigned_to, created_by)
  values (customer, 'business', 'Provkunden AB', admin_id, admin_id),
         (customer2, 'business', 'Andra provkunden AB', admin_id, admin_id);

  set local role service_role;
  insert into public.crm_store_orders (id, order_id, order_number, reseller_id, store_name, customer_id, assigned_to,
                                       assigned_to_name, assignment_source, intake_payload, payload)
  values (so_seller, 'check-8-1', 'B-2026-081', 'check-8', 'Provbutiken AB', customer, seller_id, 'Test Säljare', 'reseller_seller', body, body),
         (so_admin, 'check-8-2', 'B-2026-082', 'check-8', 'Provbutiken AB', null, admin_id, 'Test Admin', 'fallback', body, body),
         (so_guard, 'check-8-3', 'B-2026-083', 'check-8', 'Provbutiken AB', customer, admin_id, 'Test Admin', 'fallback', body, body),
         -- Ansvarig utan crm.workorder.write: regeln kräver nyckeln också för den ansvarige.
         (so_konsult, 'check-8-4', 'B-2026-084', 'check-8', 'Provbutiken AB', customer, konsult_id, 'Test Konsult', 'fallback', body, body);
  reset role;

  -- 1. Alla med crm.access läser båda (admin, säljare, konsult), men aldrig den första kroppen, notisens lån eller
  --    utskickets bokföring, och ändrar, lägger till eller tar aldrig bort något.
  foreach who in array array[admin_id, seller_id, konsult_id] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.crm_store_orders where reseller_id = 'check-8';
    if n <> 4 then raise exception '%: ser % av 4 beställningar', who, n; end if;
    perform id, order_id, order_number, store_name, status, payload, store_version, assigned_to_name, freight_mode,
            fortnox_order_number, cancel_reason
       from public.crm_store_orders where id = so_seller;
    foreach col in array array['intake_payload', 'notified_key', 'notify_claimed_at', 'sync_state', 'sync_requested_at',
                               'fortnox_order_claimed_at', 'confirmed_by'] loop
      begin
        execute format('select %I from public.crm_store_orders limit 1', col);
        raise exception '%: kunde läsa %', who, col;
      exception when insufficient_privilege then
        if sqlerrm <> granted then raise exception '%: fel nej för % (%)', who, col, sqlerrm; end if;
      end;
    end loop;
    begin
      -- En ändring som alltid hade gått igenom: bara behörigheten kan säga nej.
      update public.crm_store_orders set status = status where id = so_seller;
      raise exception '%: kunde ändra en beställning', who;
    exception when insufficient_privilege then
      if sqlerrm <> granted then raise exception '%: fel nej för update (%)', who, sqlerrm; end if;
    end;
    begin
      insert into public.crm_store_orders (order_id, order_number, reseller_id, store_name, assignment_source, intake_payload, payload)
      values ('check-8-x', 'B-X', 'check-8', 'X', 'fallback', body, body);
      raise exception '%: kunde lägga till en beställning', who;
    exception when insufficient_privilege then
      if sqlerrm <> granted then raise exception '%: fel nej för insert (%)', who, sqlerrm; end if;
    end;
    begin
      delete from public.crm_store_orders where id = so_seller;
      raise exception '%: kunde ta bort en beställning', who;
    exception when insufficient_privilege then
      if sqlerrm <> granted then raise exception '%: fel nej för delete (%)', who, sqlerrm; end if;
    end;
    reset role;
  end loop;

  -- 2. Utan crm.access (ekonomi, montör): inga rader, utan fel. RLS, inte en grant.
  foreach who in array array[ekonomi_id, montor_id] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.crm_store_orders where reseller_id = 'check-8';
    if n <> 0 then raise exception '%: ser % beställningar utan crm.access', who, n; end if;
    reset role;
  end loop;

  -- 3. Utan inloggning: ingenting, varken tabellen eller regeln.
  set local role anon;
  begin
    perform order_number from public.crm_store_orders;
    raise exception 'anon: kunde läsa beställningarna';
  exception when insufficient_privilege then
    if sqlerrm <> granted then raise exception 'anon: fel nej (%)', sqlerrm; end if;
  end;
  begin
    perform public.crm_store_order_can_manage(so_seller);
    raise exception 'anon: kunde fråga regeln';
  exception when insufficient_privilege then
    if sqlerrm <> 'permission denied for function crm_store_order_can_manage' then
      raise exception 'anon: fel nej för regeln (%)', sqlerrm;
    end if;
  end;
  reset role;

  -- 4. Regeln: den ansvarige och admin, båda med crm.workorder.write. Konsulten läser men hanterar inget; ekonomi och
  --    montören ser inte raden alls.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.crm_store_order_can_manage(so_seller) then raise exception 'admin: får inte hantera säljarens'; end if;
  if not public.crm_store_order_can_manage(so_admin) then raise exception 'admin: får inte hantera sin egen'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if not public.crm_store_order_can_manage(so_seller) then raise exception 'säljaren: får inte hantera sin egen'; end if;
  if public.crm_store_order_can_manage(so_admin) then raise exception 'säljaren: får hantera någon annans'; end if;
  reset role;
  foreach who in array array[konsult_id, ekonomi_id, montor_id] loop
    perform set_config('request.jwt.claims', json_build_object('sub', who, 'role', 'authenticated')::text, true);
    set local role authenticated;
    if public.crm_store_order_can_manage(so_seller) or public.crm_store_order_can_manage(so_admin)
       or public.crm_store_order_can_manage(so_konsult) then
      raise exception '%: får hantera en beställning', who;
    end if;
    reset role;
  end loop;

  -- 5. Vakten, med service-rollen: det koden aldrig ska göra nekas ändå, med rätt meddelande.
  set local role service_role;

  begin
    insert into public.crm_store_orders (order_id, order_number, reseller_id, store_name, assignment_source, intake_payload,
                                         payload, status, confirmed_at, confirmed_version, freight_mode)
    values ('check-8-5', 'B-X', 'check-8', 'X', 'fallback', body, body, 'confirmed', now(), 1, 'none');
    raise exception 'vakten: en ny beställning kunde börja bekräftad';
  exception when raise_exception then
    if sqlerrm not like 'butiksbeställningar: en ny beställning är mottagen%' then raise exception 'vakten: fel nej vid insert (%)', sqlerrm; end if;
  end;

  begin
    update public.crm_store_orders set order_id = 'check-8-annan' where id = so_guard;
    raise exception 'vakten: orderId kunde bytas';
  exception when raise_exception then
    if sqlerrm not like 'butiksbeställningar: beställningens identitet%' then raise exception 'vakten: fel nej för orderId (%)', sqlerrm; end if;
  end;
  begin
    update public.crm_store_orders set intake_payload = '{"annan":true}' where id = so_guard;
    raise exception 'vakten: den första kroppen kunde bytas';
  exception when raise_exception then
    if sqlerrm not like 'butiksbeställningar: beställningens identitet%' then raise exception 'vakten: fel nej för första kroppen (%)', sqlerrm; end if;
  end;

  update public.crm_store_orders set store_version = 3 where id = so_guard;
  begin
    update public.crm_store_orders set store_version = 2 where id = so_guard;
    raise exception 'vakten: versionen kunde gå bakåt';
  exception when raise_exception then
    if sqlerrm <> 'butiksbeställningar: versionen går bara framåt' then raise exception 'vakten: fel nej för versionen (%)', sqlerrm; end if;
  end;

  -- Bekräftelsen kräver ett fraktbeslut (tabellens check).
  begin
    update public.crm_store_orders set status = 'confirmed', confirmed_at = now(), confirmed_version = 3 where id = so_guard;
    raise exception 'vakten: bekräftad utan fraktbeslut';
  exception when check_violation then
    if sqlerrm not like '%crm_store_orders_confirmed_check%' then raise exception 'vakten: fel nej utan frakt (%)', sqlerrm; end if;
  end;
  begin
    update public.crm_store_orders set freight_mode = 'charged', freight_price = 0 where id = so_guard;
    raise exception 'vakten: frakt för 0 kr';
  exception when check_violation then
    if sqlerrm not like '%crm_store_orders_freight_check%' then raise exception 'vakten: fel nej för 0 kr (%)', sqlerrm; end if;
  end;

  -- Frakten på en mottagen beställning markerar ingenting; bekräftelsen gör det.
  update public.crm_store_orders set freight_mode = 'charged', freight_price = 950 where id = so_guard;
  select sync_requested_at into marked from public.crm_store_orders where id = so_guard;
  if marked is not null then raise exception 'vakten: frakten markerade beställningen för utskicket'; end if;
  -- Mottagen rakt till levererad, med allt annat som tabellen kräver på plats: bara övergångsregeln kan säga nej.
  begin
    update public.crm_store_orders
       set status = 'delivered', confirmed_at = now(), confirmed_version = 3, delivered_on = current_date, fortnox_order_number = '1'
     where id = so_guard;
    raise exception 'vakten: mottagen kunde bli levererad';
  exception when raise_exception then
    if sqlerrm <> 'butiksbeställningar: statusen kan inte gå från received till delivered' then raise exception 'vakten: fel nej received → delivered (%)', sqlerrm; end if;
  end;
  update public.crm_store_orders set status = 'confirmed', confirmed_at = now(), confirmed_version = 3 where id = so_guard;
  select sync_requested_at, status into marked, st from public.crm_store_orders where id = so_guard;
  if marked is null or st <> 'confirmed' then raise exception 'vakten: bekräftelsen markerades inte (%, %)', marked, st; end if;

  -- Efter bekräftelsen: butikens innehåll, frakten, kunden och vägen tillbaka är stängda.
  begin
    update public.crm_store_orders set payload = '{"andrad":true}' where id = so_guard;
    raise exception 'vakten: innehållet kunde ändras efter bekräftelsen';
  exception when raise_exception then
    if sqlerrm <> 'butiksbeställningar: innehållet och frakten ändras bara på en mottagen beställning (status confirmed)' then
      raise exception 'vakten: fel nej för innehållet (%)', sqlerrm;
    end if;
  end;
  begin
    update public.crm_store_orders set store_version = 4, portal_updated_at = now() where id = so_guard;
    raise exception 'vakten: versionen kunde ändras efter bekräftelsen';
  exception when raise_exception then
    if sqlerrm not like 'butiksbeställningar: innehållet och frakten ändras bara%' then raise exception 'vakten: fel nej för versionen efter (%)', sqlerrm; end if;
  end;
  begin
    update public.crm_store_orders set store_name = 'Annan butik AB' where id = so_guard;
    raise exception 'vakten: butikens namn kunde ändras efter bekräftelsen';
  exception when raise_exception then
    if sqlerrm not like 'butiksbeställningar: innehållet och frakten ändras bara%' then raise exception 'vakten: fel nej för namnet (%)', sqlerrm; end if;
  end;
  begin
    update public.crm_store_orders set changed_at = now() where id = so_guard;
    raise exception 'vakten: ändringstiden kunde ändras efter bekräftelsen';
  exception when raise_exception then
    if sqlerrm not like 'butiksbeställningar: innehållet och frakten ändras bara%' then raise exception 'vakten: fel nej för ändringstiden (%)', sqlerrm; end if;
  end;
  begin
    update public.crm_store_orders set freight_price = 1 where id = so_guard;
    raise exception 'vakten: frakten kunde ändras efter bekräftelsen';
  exception when raise_exception then
    if sqlerrm not like 'butiksbeställningar: innehållet och frakten ändras bara%' then raise exception 'vakten: fel nej för frakten (%)', sqlerrm; end if;
  end;
  -- Kunden kopplas medan beställningen är mottagen, och byts inte efter bekräftelsen.
  update public.crm_store_orders set customer_id = customer where id = so_admin;
  update public.crm_store_orders set freight_mode = 'none' where id = so_admin;
  update public.crm_store_orders set status = 'confirmed', confirmed_at = now(), confirmed_version = 1 where id = so_admin;
  begin
    update public.crm_store_orders set customer_id = customer2 where id = so_admin;
    raise exception 'vakten: kunden kunde bytas efter bekräftelsen';
  exception when raise_exception then
    if sqlerrm <> 'butiksbeställningar: kunden byts bara på en mottagen beställning' then raise exception 'vakten: fel nej för kunden (%)', sqlerrm; end if;
  end;
  begin
    update public.crm_store_orders set status = 'received' where id = so_guard;
    raise exception 'vakten: bekräftad kunde bli mottagen igen';
  exception when raise_exception then
    if sqlerrm <> 'butiksbeställningar: statusen kan inte gå från confirmed till received' then raise exception 'vakten: fel nej confirmed → received (%)', sqlerrm; end if;
  end;
  begin
    update public.crm_store_orders set status = 'withdrawn', withdrawn_at = now() where id = so_guard;
    raise exception 'vakten: bekräftad kunde dras tillbaka';
  exception when raise_exception then
    if sqlerrm <> 'butiksbeställningar: statusen kan inte gå från confirmed till withdrawn' then raise exception 'vakten: fel nej confirmed → withdrawn (%)', sqlerrm; end if;
  end;

  -- Levererad kräver Fortnox-ordern; numret skrivs en gång.
  begin
    update public.crm_store_orders set status = 'delivered', delivered_on = current_date where id = so_guard;
    raise exception 'vakten: levererad utan Fortnox-order';
  exception when check_violation then
    if sqlerrm not like '%crm_store_orders_delivered_check%' then raise exception 'vakten: fel nej utan Fortnox (%)', sqlerrm; end if;
  end;
  update public.crm_store_orders set fortnox_order_number = '8001', sync_requested_at = null where id = so_guard;
  select sync_requested_at into marked from public.crm_store_orders where id = so_guard;
  if marked is null then raise exception 'vakten: Fortnox-numret markerade inte beställningen'; end if;
  begin
    update public.crm_store_orders set fortnox_order_number = '8002' where id = so_guard;
    raise exception 'vakten: Fortnox-numret kunde bytas';
  exception when raise_exception then
    if sqlerrm <> 'butiksbeställningar: ett Fortnox-nummer skrivs en gång' then raise exception 'vakten: fel nej för numret (%)', sqlerrm; end if;
  end;
  update public.crm_store_orders set status = 'delivered', delivered_on = current_date where id = so_guard;
  begin
    update public.crm_store_orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Fel' where id = so_guard;
    raise exception 'vakten: levererad kunde makuleras';
  exception when raise_exception then
    if sqlerrm <> 'butiksbeställningar: statusen kan inte gå från delivered till cancelled' then raise exception 'vakten: fel nej delivered → cancelled (%)', sqlerrm; end if;
  end;
  begin
    update public.crm_store_orders set status = 'invoiced', invoiced_on = current_date where id = so_guard;
    raise exception 'vakten: fakturerad utan fakturanummer';
  exception when check_violation then
    if sqlerrm not like '%crm_store_orders_invoiced_check%' then raise exception 'vakten: fel nej utan faktura (%)', sqlerrm; end if;
  end;
  update public.crm_store_orders set status = 'invoiced', invoiced_on = current_date, fortnox_invoice_number = '9001' where id = so_guard;
  begin
    update public.crm_store_orders set fortnox_invoice_number = '9002' where id = so_guard;
    raise exception 'vakten: fakturanumret kunde bytas';
  exception when raise_exception then
    if sqlerrm <> 'butiksbeställningar: ett Fortnox-nummer skrivs en gång' then raise exception 'vakten: fel nej för fakturanumret (%)', sqlerrm; end if;
  end;
  begin
    update public.crm_store_orders set status = 'delivered' where id = so_guard;
    raise exception 'vakten: fakturerad kunde gå bakåt';
  exception when raise_exception then
    if sqlerrm <> 'butiksbeställningar: statusen kan inte gå från invoiced till delivered' then raise exception 'vakten: fel nej invoiced → delivered (%)', sqlerrm; end if;
  end;

  -- Tillbakadragen och makulerad: tiden, och skälet.
  begin
    update public.crm_store_orders set status = 'withdrawn' where id = so_seller;
    raise exception 'vakten: tillbakadragen utan tid';
  exception when check_violation then
    if sqlerrm not like '%crm_store_orders_withdrawn_check%' then raise exception 'vakten: fel nej utan tid (%)', sqlerrm; end if;
  end;
  begin
    update public.crm_store_orders set status = 'cancelled', cancelled_at = now(), cancel_reason = '  ' where id = so_seller;
    raise exception 'vakten: makulerad utan skäl';
  exception when check_violation then
    if sqlerrm not like '%crm_store_orders_cancelled_check%' then raise exception 'vakten: fel nej utan skäl (%)', sqlerrm; end if;
  end;
  update public.crm_store_orders set freight_mode = 'none' where id = so_seller;
  update public.crm_store_orders set status = 'withdrawn', withdrawn_at = now() where id = so_seller;
  begin
    -- Allt annat som en bekräftad kräver finns: bara övergångsregeln kan säga nej.
    update public.crm_store_orders set status = 'confirmed', confirmed_at = now(), confirmed_version = 1, withdrawn_at = null where id = so_seller;
    raise exception 'vakten: tillbakadragen kunde bekräftas';
  exception when raise_exception then
    if sqlerrm not like 'butiksbeställningar: statusen kan inte gå från withdrawn till confirmed%' then raise exception 'vakten: fel nej withdrawn → confirmed (%)', sqlerrm; end if;
  end;
  reset role;

  -- 6. Kundkortet tas bort: beställningen står kvar, utan kund, också bekräftad (on delete set null går förbi vakten).
  delete from public.crm_store_orders where id = so_seller;
  delete from public.crm_customers where id = customer;
  select customer_id, status into cust, st from public.crm_store_orders where id = so_admin;
  if cust is not null or st <> 'confirmed' then raise exception 'kundkortet: beställningen fick kund % och status %', cust, st; end if;

  raise notice 'portal_store_orders: allt stämmer';
end $$;

rollback;
