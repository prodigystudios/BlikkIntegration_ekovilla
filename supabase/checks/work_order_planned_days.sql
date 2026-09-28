-- Beteendet bakom planerat datum på arbetsordern (fas 4a, 20260928122049_work_order_planned_days.sql), prövat mot en
-- databas.
--
-- BARA LOKALT. Skriptet lägger in två provordrar, lägger, flyttar, pausar och tar bort kort med riktiga sessioner
-- (säljare, admin, service-rollen), prövar vakten och updated_at, raderar en order med kort, och rullar sedan tillbaka
-- allt. Ett fel avbryter med ett meddelande som säger vad som inte stämde. Kräver seedens testanvändare
-- (<roll>@example.test) och minst en bil i ops_trucks.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -v ON_ERROR_STOP=1 -f supabase/checks/work_order_planned_days.sql
--
-- Två samtidiga flyttar på samma order prövas inte här (det kräver två anslutningar); se "Fas 4a: resultat" i
-- RESELLER_PORTAL_CRM_PLAN.md.

begin;

create function pg_temp.expect_days(p_wo uuid, p_start date, p_end date, p_label text) returns void
language plpgsql as $$
declare
  s date;
  e date;
begin
  select w.planned_start_day, w.planned_end_day into s, e from public.crm_work_orders w where w.id = p_wo;
  if s is distinct from p_start or e is distinct from p_end then
    raise exception '%: planerat % – %, väntat % – %', p_label, s, e, p_start, p_end;
  end if;
end $$;

create function pg_temp.expect_untouched(p_wo uuid, p_updated_at timestamptz, p_label text) returns void
language plpgsql as $$
declare
  u timestamptz;
begin
  select w.updated_at into u from public.crm_work_orders w where w.id = p_wo;
  if u is distinct from p_updated_at then
    raise exception '%: updated_at ändrades (% → %)', p_label, p_updated_at, u;
  end if;
end $$;

-- now() är samma under hela transaktionen: två bumpar går inte att skilja åt. Stämpeln sätts därför tillbaka mellan
-- proven, med tidsstämpeltriggern avstängd en kort stund.
create function pg_temp.reset_stamp(p_wo uuid, p_stamp timestamptz) returns void
language plpgsql as $$
begin
  alter table public.crm_work_orders disable trigger set_timestamp_crm_work_orders;
  update public.crm_work_orders set updated_at = p_stamp where id = p_wo;
  alter table public.crm_work_orders enable trigger set_timestamp_crm_work_orders;
end $$;

do $$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-000000000001';
  seller_id constant uuid := '00000000-0000-4000-8000-000000000002';
  wo_a constant uuid := 'a4a00000-0000-4000-8000-00000000000a';
  wo_b constant uuid := 'a4a00000-0000-4000-8000-00000000000b';
  seg1 constant uuid := 'a4a00000-0000-4000-8000-000000000001';
  seg2 constant uuid := 'a4a00000-0000-4000-8000-000000000002';
  seg3 constant uuid := 'a4a00000-0000-4000-8000-000000000003';
  seg4 constant uuid := 'a4a00000-0000-4000-8000-000000000004';
  placeholder constant uuid := 'a4a00000-0000-4000-8000-0000000000f0';
  stamp constant timestamptz := '2026-01-01T00:00:00Z';
  truck uuid;
  n integer;
  before_ctid text;
begin
  select t.id into truck from public.ops_trucks t order by t.name limit 1;
  if truck is null then raise exception 'förutsättning: ingen bil i ops_trucks'; end if;

  -- Ordern A har admin som ansvarig: säljaren får planera den men inte ändra den (RLS på crm_work_orders).
  insert into public.crm_work_orders (id, order_number, project_name, client_name, quote_type, created_by, assigned_to, updated_at)
  values (wo_a, 'AO-CHECK-4A-A', 'Provorder A', 'Provkund', 'business', admin_id, admin_id, stamp),
         (wo_b, 'AO-CHECK-4A-B', 'Provorder B', 'Provkund', 'business', seller_id, seller_id, stamp);
  perform pg_temp.expect_days(wo_a, null, null, 'ny order');

  -- 1. Säljaren lägger ett kort på en kollegas order. Datumen följer med, fast säljaren inte får ändra ordern.
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.crm_work_orders set notes = 'säljaren' where id = wo_a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'förutsättning: säljaren kunde ändra en kollegas order (% rader)', n; end if;
  insert into public.ops_segments (id, work_order_id, truck_id, start_day, end_day, created_by)
  values (seg1, wo_a, truck, '2026-10-05', '2026-10-06', seller_id);
  reset role;
  perform pg_temp.expect_days(wo_a, '2026-10-05', '2026-10-06', '1. säljarens kort på en kollegas order');
  perform pg_temp.expect_untouched(wo_a, stamp, '1. kortet lades');

  -- 2. En andra etapp senare: slutdagen följer med.
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.ops_segments (id, work_order_id, truck_id, start_day, end_day, created_by)
  values (seg2, wo_a, truck, '2026-10-12', '2026-10-14', seller_id);
  reset role;
  perform pg_temp.expect_days(wo_a, '2026-10-05', '2026-10-14', '2. andra etappen');

  -- 3. Flytta den första: båda räknas om.
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.ops_segments set start_day = '2026-10-15', end_day = '2026-10-16' where id = seg1;
  reset role;
  perform pg_temp.expect_days(wo_a, '2026-10-12', '2026-10-16', '3. flytten');
  perform pg_temp.expect_untouched(wo_a, stamp, '3. flytten');

  -- 4. Ordning på dagen, jobbtyp, arbetsbeskrivning, en flytt till samma dagar, och ett kort som läggs, flyttas och tas
  -- bort INOM perioden: ordern skrivs inte alls. ctid och inte xmin: inom en transaktion har varje version samma xmin.
  select w.ctid::text into before_ctid from public.crm_work_orders w where w.id = wo_a;
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.ops_segments set sort_index = 7, job_type = 'Provtyp', work_description = 'Prov' where id = seg2;
  update public.ops_segments set start_day = start_day, end_day = end_day where id = seg2;
  insert into public.ops_segments (id, work_order_id, truck_id, start_day, end_day, created_by)
  values (seg4, wo_a, truck, '2026-10-13', '2026-10-13', seller_id);
  update public.ops_segments set start_day = '2026-10-14', end_day = '2026-10-14' where id = seg4;
  delete from public.ops_segments where id = seg4;
  reset role;
  if (select w.ctid::text from public.crm_work_orders w where w.id = wo_a) <> before_ctid then
    raise exception '4. ordern skrevs fast datumen inte ändrades';
  end if;
  perform pg_temp.expect_days(wo_a, '2026-10-12', '2026-10-16', '4. inom perioden');

  -- 5. Pausat kort räknas inte; alla pausade = tomt; återupptaget = tillbaka.
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.ops_segments set on_hold = true where id = seg1;
  reset role;
  perform pg_temp.expect_days(wo_a, '2026-10-12', '2026-10-14', '5. första kortet pausat');
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.ops_segments set on_hold = true where id = seg2;
  reset role;
  perform pg_temp.expect_days(wo_a, null, null, '5. alla kort pausade');
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.ops_segments set on_hold = false where id in (seg1, seg2);
  reset role;
  perform pg_temp.expect_days(wo_a, '2026-10-12', '2026-10-16', '5. återupptagna');
  perform pg_temp.expect_untouched(wo_a, stamp, '5. pausen');

  -- 6. Ett kort byter order: båda ordrarna räknas om.
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.ops_segments set work_order_id = wo_b where id = seg1;
  reset role;
  perform pg_temp.expect_days(wo_a, '2026-10-12', '2026-10-14', '6. ordern kortet lämnade');
  perform pg_temp.expect_days(wo_b, '2026-10-15', '2026-10-16', '6. ordern kortet kom till');

  -- 7. Service-rollen (som etappens arbetsbeskrivning skrivs med) lägger ett kort: triggern går, fast ingen roll
  -- har EXECUTE på funktionen.
  set local role service_role;
  insert into public.ops_segments (id, work_order_id, truck_id, start_day, end_day)
  values (seg3, wo_a, truck, '2026-10-01', '2026-10-01');
  reset role;
  perform pg_temp.expect_days(wo_a, '2026-10-01', '2026-10-14', '7. service-rollens kort');

  -- 8. Ta bort: räknas om; sista kortet bort = tomt.
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.ops_segments where id = seg3;
  reset role;
  perform pg_temp.expect_days(wo_a, '2026-10-12', '2026-10-14', '8. ett kort borttaget');
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.ops_segments where id = seg2;
  reset role;
  perform pg_temp.expect_days(wo_a, null, null, '8. sista kortet borttaget');
  perform pg_temp.expect_untouched(wo_a, stamp, '8. borttagningen');

  -- 9. Platshållare utan order: inget fel, ingen order rörs.
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.ops_segments (id, work_order_id, placeholder_title, truck_id, start_day, end_day, created_by)
  values (placeholder, null, 'Provplatshållare', truck, '2026-10-20', '2026-10-20', seller_id);
  update public.ops_segments set start_day = '2026-10-21', end_day = '2026-10-21' where id = placeholder;
  delete from public.ops_segments where id = placeholder;
  reset role;

  -- 10. Vakten: ingen session skriver datumen, inte ens admin som får ändra ordern, och inte service-rollen.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.crm_work_orders set planned_start_day = '2026-12-01', planned_end_day = '2026-12-01' where id = wo_a;
    raise exception '10. admin kunde skriva planerat datum';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.crm_work_orders set planned_start_day = null, planned_end_day = null where id = wo_b;
    raise exception '10. admin kunde tömma planerat datum';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.crm_work_orders (order_number, project_name, client_name, quote_type, created_by, assigned_to, planned_start_day, planned_end_day)
    values ('AO-CHECK-4A-X', 'Prov', 'Prov', 'business', admin_id, admin_id, '2026-12-01', '2026-12-01');
    raise exception '10. admin kunde skapa en order med planerat datum';
  exception when insufficient_privilege then null;
  end;
  reset role;
  set local role service_role;
  begin
    update public.crm_work_orders set planned_start_day = '2026-12-01', planned_end_day = '2026-12-01' where id = wo_a;
    raise exception '10. service-rollen kunde skriva planerat datum';
  exception when insufficient_privilege then null;
  end;
  reset role;
  perform pg_temp.expect_days(wo_a, null, null, '10. efter vakten');
  perform pg_temp.expect_days(wo_b, '2026-10-15', '2026-10-16', '10. efter vakten');

  -- 11. updated_at: en vanlig sparning bumpar den som förut (också en som inte ändrar något), och datumen står kvar.
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.crm_work_orders set notes = 'sparad' where id = wo_b;
  reset role;
  if (select w.updated_at from public.crm_work_orders w where w.id = wo_b) = stamp then
    raise exception '11. en vanlig sparning bumpade inte updated_at';
  end if;
  perform pg_temp.expect_days(wo_b, '2026-10-15', '2026-10-16', '11. efter sparningen');
  perform pg_temp.reset_stamp(wo_b, stamp);
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.crm_work_orders set notes = notes where id = wo_b;
  reset role;
  if (select w.updated_at from public.crm_work_orders w where w.id = wo_b) = stamp then
    raise exception '11. en sparning utan ändring bumpade inte updated_at (det gjorde den förut)';
  end if;
  -- Ägaren ändrar datumen OCH något annat i samma sats: det är en sparning, updated_at bumpas.
  perform pg_temp.reset_stamp(wo_b, stamp);
  update public.crm_work_orders set planned_start_day = '2026-10-15', planned_end_day = '2026-10-17', notes = 'båda'
   where id = wo_b;
  if (select w.updated_at from public.crm_work_orders w where w.id = wo_b) = stamp then
    raise exception '11. datum och en annan kolumn i samma sats bumpade inte updated_at';
  end if;
  -- Bara datumen (som schemats regel gör): updated_at står kvar.
  perform pg_temp.reset_stamp(wo_b, stamp);
  update public.crm_work_orders set planned_end_day = '2026-10-16' where id = wo_b;
  perform pg_temp.expect_untouched(wo_b, stamp, '11. bara datumen');

  -- 12. Sessionen läser datumen.
  perform set_config('request.jwt.claims', json_build_object('sub', seller_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.crm_work_orders where id = wo_b and planned_start_day = '2026-10-15';
  reset role;
  if n <> 1 then raise exception '12. säljaren läser inte planerat datum'; end if;

  -- 13. Radera ordern med kort (kaskaden): inget fel, korten borta.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.crm_work_orders where id = wo_b;
  get diagnostics n = row_count;
  reset role;
  if n <> 1 then raise exception '13. admin kunde inte radera ordern (% rader)', n; end if;
  if exists (select 1 from public.ops_segments where id = seg1) then raise exception '13. kortet finns kvar'; end if;

  raise notice 'planerat datum: alla kontroller gick igenom';
end $$;

rollback;
