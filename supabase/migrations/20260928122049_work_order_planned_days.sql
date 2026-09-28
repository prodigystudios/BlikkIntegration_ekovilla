-- Planerat datum på alla arbetsordrar: första och sista dagen på schemat.
--
-- BAKGRUND
-- RESELLER_PORTAL_CRM_PLAN.md, fas 4a ("Planerat datum (alla arbetsordrar)", beslut 2). Arbetsordern vet i dag inte
-- när jobbet ligger på schemat; det står bara i ops_segments. Fas 4b ska tala om för butiken när dess jobb är planerat,
-- och egenkontrollen har ett eget uppslag av "planerad dag". Två nya kolumner ger en enda definition:
--
--   planned_start_day  första start_day bland orderns kort i ops_segments som inte är pausade (on_hold)
--   planned_end_day    sista end_day bland samma kort. Ett endagsjobb har samma dag i båda.
--
-- Båda är null när inget kort ligger kvar, eller när alla är pausade. Platshållare (utan order) räknas aldrig.
--
-- BARA DATABASEN SKRIVER DEM (William 2026-09-28)
-- Schemat är fortfarande sanningen; kolumnerna är en skrivskyddad kopia. Planering v2:s princip "det som ligger på
-- schemat bor i ops_segments, aldrig på arbetsordern" revideras alltså medvetet: kopian kan inte glida isär.
--
--   * ops_segments_sync_planned_days (AFTER-trigger på ops_segments) räknar om orderns datum vid insert, delete och
--     update av work_order_id, start_day, end_day eller on_hold. Ordningen på dagen, jobbtypen, arbetsbeskrivningen och
--     bekräftelserna rör aldrig ordern. Den skriver bara när datumen faktiskt ändras.
--   * SECURITY DEFINER: säljare får flytta alla kort (planning.schedule.write), men RLS på crm_work_orders släpper bara
--     den ansvariga och admin. Som invoker hade en säljare som flyttar en kollegas kort uppdaterat 0 rader utan fel,
--     och kopian hade glidit isär. Fast search_path (tom), allt fullt kvalificerat, ingen EXECUTE för någon roll
--     (en triggerfunktion går inte att anropa direkt ändå; EXECUTE prövas bara när triggern skapas).
--   * Ordern LÅSES innan datumen räknas (for no key update), och räkningen görs i ett eget steg. Utan låset hade två
--     kort på samma order som flyttas i samma stund kunnat skriva ett gammalt värde: i READ COMMITTED räknas en
--     underfråga i UPDATE:n på ögonblicksbilden från före låsväntan. "no key update" och inte "update": ett nytt kort
--     håller FOR KEY SHARE på ordern (FK-kontrollen), och två samtidiga nya kort hade annars låst varandra.
--     Priset: raderas en order i samma sekund som någon flyttar ett av dess kort kan Postgres avbryta den ena
--     (deadlock); den görs om.
--   * crm_work_orders_guard_planned_days (BEFORE-trigger på crm_work_orders) vägrar varje annan skrivning av
--     kolumnerna, från sessionen OCH service-rollen: bara tabellens ägare (triggern ovan, som security definer, och
--     migreringarna) får ändra dem. En ny order har dem alltid tomma.
--
-- updated_at (William 2026-09-28)
-- En dragning ändrar INTE arbetsorderns updated_at. updated_at betyder "någon sparade ordern", och fas 3c använder den
-- som krockkontroll när butikens kund kopplas; en dragning mitt i en koppling hade gett 409 portal_job_changed.
-- set_timestamp_crm_work_orders lämnar därför updated_at orörd när BARA planned_* ändrats (resten av raden jämförs).
-- En uppdatering som inte ändrar något alls bumpar den fortfarande, som förut. crm_work_orders ligger inte i realtime-
-- publikationen, så ingen sida laddar om på en ändring av ordern.
--
-- Radering: ops_segments.work_order_id är on delete cascade. När ordern raderas hittar triggern ingen order att låsa
-- och gör ingenting.
--
-- ENGÅNGSIFYLLNADEN görs efter att triggrarna finns, i samma transaktion: ALTER TABLE låser crm_work_orders tills
-- migreringen är klar, så en dragning under pushen väntar och hamnar aldrig i en lucka. Den rör inte updated_at.
-- Efterkontrollen räknar om varje order och avbryter pushen om något inte stämmer.
--
-- ÅTKOMST
-- authenticated läser crm_work_orders med en grant på tabellnivå, som omfattar de nya kolumnerna. Inga nya grants.
--
-- Additiv: två nya kolumner, två nya triggrar, och set_timestamp_crm_work_orders som bara skiljer sig när planned_*
-- ändrats (vilket ingen kod gör). MÅSTE till prod FÖRE koden: koden läser kolumnerna. Idempotent, kan köras om.

-- Korten först, sedan ordern: ett kort som läggs under pushen håller ops_segments och väntar på ordern
-- (FK-kontrollen). Tog migreringen ordern först och korten sist (create trigger) hade de låst varandra.
-- I ett do-block: supabase db push kör filen utan transaktionsblock, och där vägrar LOCK TABLE (prövat).
-- Låset hålls ändå till slutet; filen körs som en enda transaktion.
do $$ begin lock table public.ops_segments in share row exclusive mode; end $$;

alter table public.crm_work_orders add column if not exists planned_start_day date;
alter table public.crm_work_orders add column if not exists planned_end_day date;

alter table public.crm_work_orders drop constraint if exists crm_work_orders_planned_days_check;
alter table public.crm_work_orders
  add constraint crm_work_orders_planned_days_check check (
    (planned_start_day is null and planned_end_day is null)
    or (planned_start_day is not null and planned_end_day is not null and planned_end_day >= planned_start_day)
  );

comment on column public.crm_work_orders.planned_start_day is
  'Första start_day bland orderns kort i ops_segments som inte är pausade (on_hold); null utan kort. Skrivs bara av triggern ops_segments_sync_planned_days.';
comment on column public.crm_work_orders.planned_end_day is
  'Sista end_day bland orderns kort i ops_segments som inte är pausade (on_hold); null utan kort. Skrivs bara av triggern ops_segments_sync_planned_days.';

-- ------------------------------------------------------------------------------------------------ updated_at

-- Samma funktion som i baslinjen, med ett undantag: när BARA planned_* ändrats står updated_at kvar.
-- search_path måste med: create or replace ersätter funktionens inställningar (20260926131158 satte den).
create or replace function public.set_timestamp_crm_work_orders()
  returns trigger
  language plpgsql
  set search_path = public
as $function$
begin
  if new.planned_start_day is distinct from old.planned_start_day
     or new.planned_end_day is distinct from old.planned_end_day then
    if (to_jsonb(new) - array['planned_start_day', 'planned_end_day', 'updated_at'])
       = (to_jsonb(old) - array['planned_start_day', 'planned_end_day', 'updated_at']) then
      new.updated_at = old.updated_at;
      return new;
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$function$;

-- ------------------------------------------------------------------------------------------------ vakten

create or replace function public.crm_work_orders_guard_planned_days()
  returns trigger
  language plpgsql
  security invoker
  set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.planned_start_day is null and new.planned_end_day is null then
      return new;
    end if;
  elsif new.planned_start_day is not distinct from old.planned_start_day
    and new.planned_end_day is not distinct from old.planned_end_day then
    return new;
  end if;

  -- Datumen ändras. Bara tabellens ägare: schemats trigger (security definer) och migreringarna.
  if current_user = (select pg_catalog.pg_get_userbyid(c.relowner) from pg_catalog.pg_class c where c.oid = tg_relid) then
    return new;
  end if;

  raise exception using
    errcode = 'insufficient_privilege',
    message = 'crm_work_orders.planned_start_day och planned_end_day skrivs bara av schemat',
    hint = 'Datumen räknas ur ops_segments av triggern ops_segments_sync_planned_days. Flytta kortet i planeringen.';
end;
$$;

revoke all on function public.crm_work_orders_guard_planned_days() from public, anon, authenticated, service_role;

drop trigger if exists crm_work_orders_guard_planned_days on public.crm_work_orders;
create trigger crm_work_orders_guard_planned_days
  before insert or update on public.crm_work_orders
  for each row execute function public.crm_work_orders_guard_planned_days();

-- ------------------------------------------------------------------------------------------------ schemats regel

create or replace function public.ops_segments_sync_planned_days()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  ids uuid[];
  wo uuid;
  first_day date;
  last_day date;
begin
  if tg_op = 'INSERT' then
    ids := array[new.work_order_id];
  elsif tg_op = 'DELETE' then
    ids := array[old.work_order_id];
  elsif (old.work_order_id, old.start_day, old.end_day, old.on_hold)
        is not distinct from (new.work_order_id, new.start_day, new.end_day, new.on_hold) then
    return null;
  elsif old.work_order_id is not distinct from new.work_order_id then
    ids := array[new.work_order_id];
  else
    -- Kortet bytte order: båda räknas om, låsta i id-ordning så att två motsatta byten inte låser varandra.
    select array_agg(x order by x) into ids
      from unnest(array[old.work_order_id, new.work_order_id]) as x
     where x is not null;
  end if;

  foreach wo in array ids loop
    -- Platshållare saknar order.
    continue when wo is null;

    -- Lås först, räkna sedan i ett eget steg: då ser räkningen det en samtidig flytt av ett annat kort på samma
    -- order hann spara. Ordern finns inte längre när den raderas (kaskaden): då finns inget att räkna om.
    perform 1 from public.crm_work_orders w where w.id = wo for no key update;
    continue when not found;

    select min(s.start_day), max(s.end_day)
      into first_day, last_day
      from public.ops_segments s
     where s.work_order_id = wo
       and not s.on_hold;

    update public.crm_work_orders w
       set planned_start_day = first_day,
           planned_end_day = last_day
     where w.id = wo
       and (w.planned_start_day is distinct from first_day or w.planned_end_day is distinct from last_day);
  end loop;

  return null;
end;
$$;

revoke all on function public.ops_segments_sync_planned_days() from public, anon, authenticated, service_role;

drop trigger if exists ops_segments_sync_planned_days on public.ops_segments;
create trigger ops_segments_sync_planned_days
  after insert or delete or update of work_order_id, start_day, end_day, on_hold on public.ops_segments
  for each row execute function public.ops_segments_sync_planned_days();

-- ------------------------------------------------------------------------------------------------ ifyllnaden

update public.crm_work_orders w
   set planned_start_day = d.first_day,
       planned_end_day = d.last_day
  from (
    select s.work_order_id, min(s.start_day) as first_day, max(s.end_day) as last_day
      from public.ops_segments s
     where s.work_order_id is not null
       and not s.on_hold
     group by s.work_order_id
  ) d
 where w.id = d.work_order_id
   and (w.planned_start_day is distinct from d.first_day or w.planned_end_day is distinct from d.last_day);

-- ------------------------------------------------------------------------------------------------ efterkontroll

do $$
declare
  fn text;
  who text;
  cfg text[];
  owner_oid oid;
  n integer;
begin
  -- Kolumnerna: datum, och läsbara för sessionen som resten av ordern.
  foreach fn in array array['planned_start_day', 'planned_end_day'] loop
    select count(*) into n from pg_catalog.pg_attribute a
     where a.attrelid = 'public.crm_work_orders'::regclass and a.attname = fn and not a.attisdropped
       and a.atttypid = 'date'::regtype;
    if n <> 1 then raise exception 'planerat datum: crm_work_orders.% saknas eller är inte date', fn; end if;
    if not has_column_privilege('authenticated', 'public.crm_work_orders', fn, 'SELECT') then
      raise exception 'planerat datum: authenticated kan inte läsa crm_work_orders.%', fn;
    end if;
  end loop;

  -- Schemats regel: security definer, tomt search_path, ägd av tabellernas ägare (annars släpper vakten den inte,
  -- eller så biter RLS på ordern).
  select c.relowner into owner_oid from pg_catalog.pg_class c where c.oid = 'public.crm_work_orders'::regclass;
  if owner_oid <> (select c.relowner from pg_catalog.pg_class c where c.oid = 'public.ops_segments'::regclass) then
    raise exception 'planerat datum: crm_work_orders och ops_segments har olika ägare';
  end if;
  select p.proconfig into cfg from pg_catalog.pg_proc p
   where p.oid = 'public.ops_segments_sync_planned_days()'::regprocedure and p.prosecdef and p.proowner = owner_oid;
  if cfg is null or cfg <> array['search_path=""'] then
    raise exception 'planerat datum: ops_segments_sync_planned_days är inte security definer med tomt search_path och tabellernas ägare (%)', cfg;
  end if;

  -- Vakten: invoker (current_user ska vara den som skriver), tomt search_path.
  select p.proconfig into cfg from pg_catalog.pg_proc p
   where p.oid = 'public.crm_work_orders_guard_planned_days()'::regprocedure and not p.prosecdef;
  if cfg is null or cfg <> array['search_path=""'] then
    raise exception 'planerat datum: crm_work_orders_guard_planned_days är inte invoker med tomt search_path (%)', cfg;
  end if;

  -- Tidsstämpeln behöll sitt search_path.
  select p.proconfig into cfg from pg_catalog.pg_proc p
   where p.oid = 'public.set_timestamp_crm_work_orders()'::regprocedure;
  if cfg is null or cfg <> array['search_path=public'] then
    raise exception 'planerat datum: set_timestamp_crm_work_orders har tappat search_path (%)', cfg;
  end if;

  -- Ingen roll kör funktionerna (has_function_privilege räknar in PUBLIC).
  foreach fn in array array['public.ops_segments_sync_planned_days()', 'public.crm_work_orders_guard_planned_days()'] loop
    foreach who in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(who, fn, 'EXECUTE') then
        raise exception 'planerat datum: % kan köra %', who, fn;
      end if;
    end loop;
  end loop;

  -- Triggrarna finns, är på, och är av rätt slag (tgtype: 1 rad, 2 before, 4 insert, 8 delete, 16 update).
  select count(*) into n from pg_catalog.pg_trigger t
   where t.tgrelid = 'public.ops_segments'::regclass and t.tgname = 'ops_segments_sync_planned_days'
     and t.tgenabled = 'O' and t.tgtype = 1 + 4 + 8 + 16
     and t.tgfoid = 'public.ops_segments_sync_planned_days()'::regprocedure
     and (select array_agg(a.attname::text order by a.attname) from pg_catalog.pg_attribute a
           where a.attrelid = t.tgrelid and a.attnum = any(t.tgattr))
         = array['end_day', 'on_hold', 'start_day', 'work_order_id'];
  if n <> 1 then raise exception 'planerat datum: triggern på ops_segments saknas eller är fel'; end if;
  select count(*) into n from pg_catalog.pg_trigger t
   where t.tgrelid = 'public.crm_work_orders'::regclass and t.tgname = 'crm_work_orders_guard_planned_days'
     and t.tgenabled = 'O' and t.tgtype = 1 + 2 + 4 + 16
     and t.tgfoid = 'public.crm_work_orders_guard_planned_days()'::regprocedure;
  if n <> 1 then raise exception 'planerat datum: vakten på crm_work_orders saknas eller är fel'; end if;

  -- Ifyllnaden: varje order stämmer med schemat.
  select count(*) into n
    from public.crm_work_orders w
    left join (
      select s.work_order_id, min(s.start_day) as first_day, max(s.end_day) as last_day
        from public.ops_segments s
       where s.work_order_id is not null and not s.on_hold
       group by s.work_order_id
    ) d on d.work_order_id = w.id
   where w.planned_start_day is distinct from d.first_day or w.planned_end_day is distinct from d.last_day;
  if n <> 0 then raise exception 'planerat datum: % arbetsordrar stämmer inte med schemat', n; end if;
end $$;
