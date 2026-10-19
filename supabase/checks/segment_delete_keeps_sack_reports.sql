-- Beteendet bakom 20261016105146_segment_delete_keeps_sack_reports.sql, prövat mot en databas: ett kort som tas bort
-- tar inte med sig orderns säckrapporter.
--
-- BARA LOKALT. Skriptet lägger in provordrar med kort och rapporter, tar bort kort med riktiga sessioner (säljaren,
-- service-rollen), raderar ordrar, och rullar sedan tillbaka allt. Ett fel avbryter med ett meddelande som säger vad
-- som inte stämde. Kräver seedens testanvändare (<roll>@example.test) och minst två bilar i ops_trucks.
--
--   psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -v ON_ERROR_STOP=1 -f supabase/checks/segment_delete_keeps_sack_reports.sql
--
-- Fallen i 2, 3 och 3b har samma svar som resolveSegmentForDay ger på samma kort (tests/supabase/
-- segmentDeleteKeepsSackReportsSql.test.ts räknar om dem i TypeScript).

begin;

create function pg_temp.expect_segment(p_report uuid, p_segment uuid, p_label text) returns void
language plpgsql as $$
declare
  s uuid;
begin
  select r.segment_id into s from public.ops_segment_reports r where r.id = p_report;
  if s is null then
    raise exception '%: rapporten finns inte längre', p_label;
  end if;
  if s <> p_segment then
    raise exception '%: rapporten ligger på kortet %, väntat %', p_label, s, p_segment;
  end if;
end $$;

create function pg_temp.as_seller() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
end $$;

do $$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-000000000001';
  seller_id constant uuid := '00000000-0000-4000-8000-000000000002';
  -- 1. två kort samma dag (fallet #272)
  wo_dup constant uuid := 'b5b00000-0000-4000-8000-0000000000a0';
  dup_keep constant uuid := 'b5b00000-0000-4000-8000-0000000000a2';
  dup_gone constant uuid := 'b5b00000-0000-4000-8000-0000000000a1';
  r_partial constant uuid := 'b5b00000-0000-4000-8000-0000000001a1';
  r_final constant uuid := 'b5b00000-0000-4000-8000-0000000001a2';
  r_other constant uuid := 'b5b00000-0000-4000-8000-0000000001a3';
  -- 2. täckande kort först, annars närmaste
  wo_rule constant uuid := 'b5b00000-0000-4000-8000-0000000000b0';
  rule_cover constant uuid := 'b5b00000-0000-4000-8000-0000000000b1';
  rule_late constant uuid := 'b5b00000-0000-4000-8000-0000000000b2';
  rule_gone constant uuid := 'b5b00000-0000-4000-8000-0000000000b3';
  r_covered constant uuid := 'b5b00000-0000-4000-8000-0000000001b1';
  r_near_late constant uuid := 'b5b00000-0000-4000-8000-0000000001b2';
  r_near_cover constant uuid := 'b5b00000-0000-4000-8000-0000000001b3';
  -- 3. två täckande kort med samma start: lägsta id
  wo_tie constant uuid := 'b5b00000-0000-4000-8000-0000000000c0';
  tie_low constant uuid := 'b5b00000-0000-4000-8000-0000000000c1';
  tie_high constant uuid := 'b5b00000-0000-4000-8000-0000000000c2';
  tie_gone constant uuid := 'b5b00000-0000-4000-8000-0000000000c3';
  r_tie constant uuid := 'b5b00000-0000-4000-8000-0000000001c1';
  -- 3b. två täckande kort med olika start: tidigast start vinner, fast det har högre id
  wo_start constant uuid := 'b5b00000-0000-4000-8000-0000000000c4';
  start_late_low constant uuid := 'b5b00000-0000-4000-8000-0000000000c5';
  start_early_high constant uuid := 'b5b00000-0000-4000-8000-0000000000c7';
  start_gone constant uuid := 'b5b00000-0000-4000-8000-0000000000c6';
  r_start constant uuid := 'b5b00000-0000-4000-8000-0000000001c4';
  -- 4. orderns sista kort
  wo_last constant uuid := 'b5b00000-0000-4000-8000-0000000000d0';
  last_seg constant uuid := 'b5b00000-0000-4000-8000-0000000000d1';
  r_last constant uuid := 'b5b00000-0000-4000-8000-0000000001d1';
  -- 5. sista kortet utan rapporter, och en platshållare
  wo_empty constant uuid := 'b5b00000-0000-4000-8000-0000000000e0';
  empty_seg constant uuid := 'b5b00000-0000-4000-8000-0000000000e1';
  placeholder constant uuid := 'b5b00000-0000-4000-8000-0000000000e2';
  -- 6. service-rollen
  wo_service constant uuid := 'b5b00000-0000-4000-8000-0000000000f0';
  service_keep constant uuid := 'b5b00000-0000-4000-8000-0000000000f1';
  service_gone constant uuid := 'b5b00000-0000-4000-8000-0000000000f2';
  r_service constant uuid := 'b5b00000-0000-4000-8000-0000000001f1';
  -- 8. ett kort utan order med en rapport på sig
  orphan constant uuid := 'b5b00000-0000-4000-8000-0000000000e3';
  r_orphan constant uuid := 'b5b00000-0000-4000-8000-0000000001e3';
  truck1 uuid;
  truck2 uuid;
  n integer;
  total numeric;
  caught boolean;
begin
  select t.id into truck1 from public.ops_trucks t order by t.name limit 1;
  select t.id into truck2 from public.ops_trucks t order by t.name offset 1 limit 1;
  if truck2 is null then raise exception 'förutsättning: färre än två bilar i ops_trucks'; end if;

  insert into public.crm_work_orders (id, order_number, project_name, client_name, quote_type, created_by, assigned_to)
  values (wo_dup, 'AO-CHECK-SACK-1', 'Provorder 1', 'Provkund', 'business', admin_id, admin_id),
         (wo_rule, 'AO-CHECK-SACK-2', 'Provorder 2', 'Provkund', 'business', admin_id, admin_id),
         (wo_tie, 'AO-CHECK-SACK-3', 'Provorder 3', 'Provkund', 'business', admin_id, admin_id),
         (wo_start, 'AO-CHECK-SACK-3B', 'Provorder 3b', 'Provkund', 'business', admin_id, admin_id),
         (wo_last, 'AO-CHECK-SACK-4', 'Provorder 4', 'Provkund', 'business', admin_id, admin_id),
         (wo_empty, 'AO-CHECK-SACK-5', 'Provorder 5', 'Provkund', 'business', admin_id, admin_id),
         (wo_service, 'AO-CHECK-SACK-6', 'Provorder 6', 'Provkund', 'business', admin_id, admin_id);

  insert into public.ops_segments (id, work_order_id, truck_id, start_day, end_day, created_by) values
    (dup_gone, wo_dup, truck2, '2026-10-14', '2026-10-14', admin_id),
    (dup_keep, wo_dup, truck1, '2026-10-14', '2026-10-14', admin_id),
    (rule_cover, wo_rule, truck1, '2026-10-10', '2026-10-12', admin_id),
    (rule_late, wo_rule, truck1, '2026-10-20', '2026-10-20', admin_id),
    (rule_gone, wo_rule, truck2, '2026-10-10', '2026-10-10', admin_id),
    (tie_gone, wo_tie, truck2, '2026-10-10', '2026-10-10', admin_id),
    (tie_high, wo_tie, truck1, '2026-10-10', '2026-10-11', admin_id),
    (tie_low, wo_tie, truck2, '2026-10-10', '2026-10-10', admin_id),
    (start_gone, wo_start, truck2, '2026-10-10', '2026-10-10', admin_id),
    (start_late_low, wo_start, truck1, '2026-10-10', '2026-10-10', admin_id),
    (start_early_high, wo_start, truck1, '2026-10-09', '2026-10-11', admin_id),
    (last_seg, wo_last, truck1, '2026-10-14', '2026-10-14', admin_id),
    (empty_seg, wo_empty, truck1, '2026-10-14', '2026-10-14', admin_id),
    (service_gone, wo_service, truck2, '2026-10-14', '2026-10-14', admin_id),
    (service_keep, wo_service, truck1, '2026-10-14', '2026-10-14', admin_id);

  insert into public.ops_segment_reports
    (id, segment_id, work_order_id, report_day, sacks_blown, kind, material, construction, created_by, created_by_name)
  values
    (r_partial, dup_gone, wo_dup, '2026-10-14', 40, 'partial', 'KNAUF SUPAFIL', 'vind', admin_id, 'Prov'),
    (r_final, dup_gone, wo_dup, '2026-10-14', 194, 'final', 'KNAUF SUPAFIL', 'vind', admin_id, 'Prov'),
    (r_other, dup_keep, wo_dup, '2026-10-14', 5, 'partial', 'KNAUF SUPAFIL', null, admin_id, 'Prov'),
    (r_covered, rule_gone, wo_rule, '2026-10-11', 10, 'partial', null, null, admin_id, 'Prov'),
    (r_near_late, rule_gone, wo_rule, '2026-10-19', 11, 'partial', null, null, admin_id, 'Prov'),
    (r_near_cover, rule_gone, wo_rule, '2026-10-15', 12, 'partial', null, null, admin_id, 'Prov'),
    (r_tie, tie_gone, wo_tie, '2026-10-10', 13, 'partial', null, null, admin_id, 'Prov'),
    (r_start, start_gone, wo_start, '2026-10-10', 17, 'partial', null, null, admin_id, 'Prov'),
    (r_last, last_seg, wo_last, '2026-10-14', 14, 'final', null, null, admin_id, 'Prov'),
    (r_service, service_gone, wo_service, '2026-10-14', 15, 'final', null, null, admin_id, 'Prov');

  -- 1. Fallet #272: säljaren tar bort dubbletten. Båda rapporterna flyttas till kortet som blir kvar, med sina tal och
  -- sin sort; kortets egen rapport rörs inte.
  perform pg_temp.as_seller();
  set local role authenticated;
  delete from public.ops_segments where id = dup_gone;
  get diagnostics n = row_count;
  reset role;
  if n <> 1 then raise exception '1. säljaren kunde inte ta bort dubbletten (% rader)', n; end if;
  perform pg_temp.expect_segment(r_partial, dup_keep, '1. delrapporten');
  perform pg_temp.expect_segment(r_final, dup_keep, '1. egenkontrollen');
  perform pg_temp.expect_segment(r_other, dup_keep, '1. kortets egen rapport');
  select count(*), sum(r.sacks_blown) into n, total from public.ops_segment_reports r where r.work_order_id = wo_dup;
  if n <> 3 or total <> 239 then raise exception '1. ordern har % rapporter, % säck (väntat 3, 239)', n, total; end if;
  if not exists (select 1 from public.ops_segment_reports r where r.id = r_final and r.kind = 'final') then
    raise exception '1. egenkontrollen bytte sort';
  end if;

  -- 2. Täckande kort först, annars närmaste. Kvar: 10–12 okt och 20 okt.
  --    11 okt: täcks av 10–12.  19 okt: 20 okt ligger 1 dag bort, 10–12 sju.  15 okt: 10–12 ligger 3 bort, 20 okt fem.
  perform pg_temp.as_seller();
  set local role authenticated;
  delete from public.ops_segments where id = rule_gone;
  reset role;
  perform pg_temp.expect_segment(r_covered, rule_cover, '2. 11 okt (täckt)');
  perform pg_temp.expect_segment(r_near_late, rule_late, '2. 19 okt (närmast det senare kortet)');
  perform pg_temp.expect_segment(r_near_cover, rule_cover, '2. 15 okt (närmast det tidigare kortet)');

  -- 3. Två täckande kort med samma start: lägsta id vinner, oavsett bil och slutdag.
  perform pg_temp.as_seller();
  set local role authenticated;
  delete from public.ops_segments where id = tie_gone;
  reset role;
  perform pg_temp.expect_segment(r_tie, tie_low, '3. lika start');

  -- 3b. Två täckande kort med olika start: det som börjar tidigast vinner, fast det har högre id.
  perform pg_temp.as_seller();
  set local role authenticated;
  delete from public.ops_segments where id = start_gone;
  reset role;
  perform pg_temp.expect_segment(r_start, start_early_high, '3b. tidigast start före lägst id');

  -- 4. Orderns sista kort med en rapport: nekas med foreign_key_violation, kortet och rapporten står kvar.
  perform pg_temp.as_seller();
  set local role authenticated;
  caught := false;
  begin
    delete from public.ops_segments where id = last_seg;
  exception when foreign_key_violation then caught := true;
  end;
  reset role;
  if not caught then raise exception '4. det sista kortet med en rapport gick att ta bort'; end if;
  if not exists (select 1 from public.ops_segments where id = last_seg) then raise exception '4. kortet försvann'; end if;
  perform pg_temp.expect_segment(r_last, last_seg, '4. rapporten på det sista kortet');

  -- 5. Sista kortet UTAN rapporter, och en platshållare: tas bort som förut.
  perform pg_temp.as_seller();
  set local role authenticated;
  insert into public.ops_segments (id, work_order_id, placeholder_title, truck_id, start_day, end_day, created_by)
  values (placeholder, null, 'Provplatshållare', truck1, '2026-10-20', '2026-10-20', seller_id);
  delete from public.ops_segments where id in (empty_seg, placeholder);
  get diagnostics n = row_count;
  reset role;
  if n <> 2 then raise exception '5. kort utan rapporter gick inte att ta bort (% av 2)', n; end if;

  -- 6. Service-rollen får samma regel, fast ingen roll har EXECUTE på funktionen.
  set local role service_role;
  delete from public.ops_segments where id = service_gone;
  reset role;
  perform pg_temp.expect_segment(r_service, service_keep, '6. service-rollen');
  set local role service_role;
  caught := false;
  begin
    delete from public.ops_segments where id = service_keep;
  exception when foreign_key_violation then caught := true;
  end;
  reset role;
  if not caught then raise exception '6. service-rollen kunde ta bort det sista kortet med en rapport'; end if;

  -- 7. Ordern raderas med sitt sista kort och dess rapport: kaskaden går som förut.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.crm_work_orders where id = wo_last;
  get diagnostics n = row_count;
  reset role;
  if n <> 1 then raise exception '7. admin kunde inte radera ordern (% rader)', n; end if;
  if exists (select 1 from public.ops_segments where id = last_seg) then raise exception '7. kortet finns kvar'; end if;
  if exists (select 1 from public.ops_segment_reports where id = r_last) then raise exception '7. rapporten finns kvar'; end if;

  -- 8. Ett kort UTAN order med en rapport på sig (ingen väg i appen skapar det, men det får inte släppas till kaskaden):
  -- nekas. `w.id = null` är aldrig sant, så en ordervakt utan villkor hade sett det som en raderad order.
  insert into public.ops_segments (id, work_order_id, placeholder_title, truck_id, start_day, end_day, created_by)
  values (orphan, null, 'Provplatshållare med rapport', truck1, '2026-10-14', '2026-10-14', admin_id);
  insert into public.ops_segment_reports
    (id, segment_id, work_order_id, report_day, sacks_blown, kind, created_by, created_by_name)
  values (r_orphan, orphan, wo_dup, '2026-10-14', 18, 'partial', admin_id, 'Prov');
  perform pg_temp.as_seller();
  set local role authenticated;
  caught := false;
  begin
    delete from public.ops_segments where id = orphan;
  exception when foreign_key_violation then caught := true;
  end;
  reset role;
  if not caught then raise exception '8. ett kort utan order kunde tas bort med en rapport på sig'; end if;
  perform pg_temp.expect_segment(r_orphan, orphan, '8. rapporten på kortet utan order');

  raise notice 'säckrapporterna: kontrollerna 1–8 gick igenom';
end $$;

-- 9. Ordern raderas och kaskaden når KORTET innan den når rapporterna. Vilken av de två kaskaderna Postgres kör först
-- följer av i vilken ordning främmande nycklarna skapades, och det är inte samma i alla databaser. Här tas
-- rapporternas egen kaskad på work_order_id bort (inom transaktionen, rullas tillbaka), så kortets borttagning är den
-- enda vägen: triggern måste se att ordern är borta och släppa igenom, annars nekas raderingen av hela ordern.
alter table public.ops_segment_reports drop constraint ops_segment_reports_work_order_id_fkey;

do $$
declare
  admin_id constant uuid := '00000000-0000-4000-8000-000000000001';
  wo constant uuid := 'b5b00000-0000-4000-8000-0000000000a9';
  seg constant uuid := 'b5b00000-0000-4000-8000-0000000000a8';
  rep constant uuid := 'b5b00000-0000-4000-8000-0000000001a9';
  truck uuid;
  n integer;
begin
  select t.id into truck from public.ops_trucks t order by t.name limit 1;
  insert into public.crm_work_orders (id, order_number, project_name, client_name, quote_type, created_by, assigned_to)
  values (wo, 'AO-CHECK-SACK-9', 'Provorder 9', 'Provkund', 'business', admin_id, admin_id);
  insert into public.ops_segments (id, work_order_id, truck_id, start_day, end_day, created_by)
  values (seg, wo, truck, '2026-10-14', '2026-10-14', admin_id);
  insert into public.ops_segment_reports
    (id, segment_id, work_order_id, report_day, sacks_blown, kind, created_by, created_by_name)
  values (rep, seg, wo, '2026-10-14', 16, 'final', admin_id, 'Prov');

  perform set_config('request.jwt.claims', json_build_object('sub', admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  delete from public.crm_work_orders where id = wo;
  get diagnostics n = row_count;
  reset role;
  if n <> 1 then raise exception '9. ordern gick inte att radera (% rader)', n; end if;
  if exists (select 1 from public.ops_segments where id = seg) then raise exception '9. kortet finns kvar'; end if;
  if exists (select 1 from public.ops_segment_reports where id = rep) then raise exception '9. rapporten finns kvar'; end if;

  raise notice 'säckrapporterna: kontroll 9 gick igenom';
end $$;

rollback;
