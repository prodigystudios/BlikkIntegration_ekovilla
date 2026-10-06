-- Arbetsorderns status följer schemat: "Ej planerad" blir "Planerad" när ordern läggs ut, och tillbaka när den tas bort.
--
-- REGELN (William 2026-10-06)
--   * Ett kort läggs på en order som står som draft ("Ej planerad") -> scheduled ("Planerad").
--   * Det sista kortet tas bort och ordern står som scheduled -> draft.
--   * Alla andra statusar rörs aldrig. En order som är Pågående, ska faktureras eller är avbruten behåller sin status
--     hur många kort som än läggs ut eller tas bort.
--   * Ett pausat kort (on_hold) räknas: det ligger kvar på schemat. (planned_start_day/planned_end_day hoppar över
--     pausade kort, men de svarar på frågan "vilka dagar", inte "ligger ordern på schemat".)
--   * Platshållare (utan order) rör ingen order.
--
-- VARFÖR I DATABASEN
-- Säljare får lägga ut alla ordrar (planning.schedule.write), men RLS på crm_work_orders släpper bara den ansvariga och
-- admin. En statusändring från klienten hade alltså uppdaterat 0 rader utan fel när någon lägger ut en kollegas order,
-- och statusen hade stått kvar som Ej planerad. Triggern täcker dessutom varje väg in: dra, klicka, månadsvyns
-- bilväljare, kopiera till bil, avplanera.
--
-- Samma form som ops_segments_sync_planned_days (20260928122049), av samma skäl:
--   * SECURITY DEFINER, tomt search_path, allt fullt kvalificerat, ingen EXECUTE för någon roll.
--   * Ordern LÅSES (for no key update) innan korten räknas, och räkningen görs i ett eget steg. Två kort på samma order
--     som tas bort i samma stund ser då varandras borttagning: den som kommer sist till låset räknar noll kort och
--     sätter tillbaka Ej planerad. Utan låset hade båda sett det andra kortet och ordern stått kvar som Planerad utan
--     ett enda kort.
--
-- FÖLJDER AV STATUSBYTET
--   * updated_at bumpas (set_timestamp_crm_work_orders). Statusen är en riktig ändring av ordern, till skillnad från
--     planerat datum som bara är en kopia av schemat. Det sker bara vid första utläggningen och sista avplaneringen.
--   * Portalen: crm_work_orders_mark_portal_job markerar jobbet, men jobState.ts härleder "planerad" ur datumen, inte
--     ur statusen. Butiken ser alltså ingenting nytt.
--   * Fortnox: ingenting. Statusen når Fortnox bara vid Avbruten, och den går via PATCH-routen.
--
-- ENGÅNGSRÄTTNINGEN (William 2026-10-06): ordrar som redan ligger på schemat men står som draft blir scheduled. Inte
-- omvänt: en scheduled order utan kort kan ha fått statusen för hand, och den lämnas i fred.
--
-- Additiv: en ny funktion och en ny trigger, och rättningen. Kan gå till prod före koden (koden läser bara statusen).
-- Idempotent, kan köras om.

-- Korten först, sedan ordern: samma låsordning som 20260928122049. Ett kort som läggs under pushen håller
-- ops_segments och väntar på ordern (FK-kontrollen). I ett do-block: supabase db push kör filen utan transaktionsblock,
-- och där vägrar LOCK TABLE. Låset hålls ändå till slutet; filen körs som en enda transaktion.
do $$ begin lock table public.ops_segments in share row exclusive mode; end $$;

-- ------------------------------------------------------------------------------------------------ schemats regel

create or replace function public.ops_segments_sync_work_order_status()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  ids uuid[];
  wo uuid;
  placed boolean;
begin
  if tg_op = 'INSERT' then
    ids := array[new.work_order_id];
  elsif tg_op = 'DELETE' then
    ids := array[old.work_order_id];
  elsif old.work_order_id is not distinct from new.work_order_id then
    return null;
  else
    -- Kortet bytte order: båda räknas om, låsta i id-ordning så att två motsatta byten inte låser varandra.
    select array_agg(x order by x) into ids
      from unnest(array[old.work_order_id, new.work_order_id]) as x
     where x is not null;
  end if;

  foreach wo in array coalesce(ids, array[]::uuid[]) loop
    -- Platshållare saknar order.
    continue when wo is null;

    -- Lås först, räkna sedan i ett eget steg. Ordern finns inte längre när den raderas (kaskaden): då finns inget att
    -- ändra.
    perform 1 from public.crm_work_orders w where w.id = wo for no key update;
    continue when not found;

    placed := exists (select 1 from public.ops_segments s where s.work_order_id = wo);

    -- Bara de två övergångarna. Villkoret på nuvarande status gör att allt annat (Pågående, Fakturera ...) står kvar.
    update public.crm_work_orders w
       set status = case when placed then 'scheduled' else 'draft' end
     where w.id = wo
       and w.status = case when placed then 'draft' else 'scheduled' end;
  end loop;

  return null;
end;
$$;

revoke all on function public.ops_segments_sync_work_order_status() from public, anon, authenticated, service_role;

drop trigger if exists ops_segments_sync_work_order_status on public.ops_segments;
create trigger ops_segments_sync_work_order_status
  after insert or delete or update of work_order_id on public.ops_segments
  for each row execute function public.ops_segments_sync_work_order_status();

-- ------------------------------------------------------------------------------------------------ rättningen

update public.crm_work_orders w
   set status = 'scheduled'
 where w.status = 'draft'
   and exists (select 1 from public.ops_segments s where s.work_order_id = w.id);

-- ------------------------------------------------------------------------------------------------ efterkontroll

do $$
declare
  fn text := 'public.ops_segments_sync_work_order_status()';
  who text;
  cfg text[];
  owner_oid oid;
  n integer;
begin
  -- Security definer, tomt search_path, ägd av tabellernas ägare (annars biter RLS på ordern).
  select c.relowner into owner_oid from pg_catalog.pg_class c where c.oid = 'public.crm_work_orders'::regclass;
  if owner_oid <> (select c.relowner from pg_catalog.pg_class c where c.oid = 'public.ops_segments'::regclass) then
    raise exception 'orderstatus: crm_work_orders och ops_segments har olika ägare';
  end if;
  select p.proconfig into cfg from pg_catalog.pg_proc p
   where p.oid = fn::regprocedure and p.prosecdef and p.proowner = owner_oid;
  if cfg is null or cfg <> array['search_path=""'] then
    raise exception 'orderstatus: % är inte security definer med tomt search_path och tabellernas ägare (%)', fn, cfg;
  end if;

  -- Ingen roll kör funktionen (has_function_privilege räknar in PUBLIC).
  foreach who in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(who, fn, 'EXECUTE') then
      raise exception 'orderstatus: % kan köra %', who, fn;
    end if;
  end loop;

  -- Triggern finns, är på, och är av rätt slag (tgtype: 1 rad, 4 insert, 8 delete, 16 update), bara på work_order_id.
  select count(*) into n from pg_catalog.pg_trigger t
   where t.tgrelid = 'public.ops_segments'::regclass and t.tgname = 'ops_segments_sync_work_order_status'
     and t.tgenabled = 'O' and t.tgtype = 1 + 4 + 8 + 16
     and t.tgfoid = fn::regprocedure
     and (select array_agg(a.attname::text order by a.attname) from pg_catalog.pg_attribute a
           where a.attrelid = t.tgrelid and a.attnum = any(t.tgattr))
         = array['work_order_id'];
  if n <> 1 then raise exception 'orderstatus: triggern på ops_segments saknas eller är fel'; end if;

  -- Rättningen: ingen order står som Ej planerad med ett kort på schemat.
  select count(*) into n
    from public.crm_work_orders w
   where w.status = 'draft'
     and exists (select 1 from public.ops_segments s where s.work_order_id = w.id);
  if n <> 0 then raise exception 'orderstatus: % ordrar står som Ej planerad trots kort på schemat', n; end if;
end $$;
