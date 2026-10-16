-- Ett kort som tas bort från schemat tar inte längre med sig orderns säckrapporter.
--
-- BAKGRUND (2026-10-15, #272 och #279)
-- ops_segment_reports.segment_id är on delete cascade mot ops_segments. Båda ordrarna låg på två kort samma dag (två
-- bilar). Rapporterna kopplas till ETT kort (resolveSegmentForDay i lib/domains/planning/sackLedger.ts: täckande kort
-- först, sedan tidigast start, sedan id), och just det kortet var dubbletten som städades bort. Egenkontrollens 194 säck
-- på #272 och en delrapport på #279 försvann utan ett ord, ur huvudboken OCH ur depån (förbrukningen räknas ur
-- rapporterna). Rapporterna hör till arbetsordern; kortet avgör bara vilken bil, och därmed depå, säckarna dras från.
--
-- REGELN
--   * Kortet har inga rapporter (alltid fallet för en platshållare): ingenting ändras.
--   * Ordern har ett annat kort: rapporterna flyttas dit, var och en till det kort resolveSegmentForDay hade valt för
--     rapportdagen bland de kort som blir kvar. Avstånd 0 = kortet täcker dagen; sedan tidigast start, sedan id. Samma
--     ordning som i TypeScript, så en rapport hamnar där den hade hamnat om dubbletten aldrig funnits.
--   * Det är orderns sista kort: borttagningen NEKAS (foreign_key_violation, samma felkod som en restrict-referens).
--     Planeringens DELETE-rutt svarar 409 och tavlan visar texten. Kortet kan flyttas eller pausas i stället.
--   * Ordern själv raderas (on delete cascade från crm_work_orders): släpps igenom som förut. Ordern syns då inte längre
--     i triggern, och rapporterna går med ordern via sin egen kaskad på work_order_id.
--   * Målet väljs bland ALLA orderns kort, pausade och andra etappers inräknade, precis som resolveSegmentForDay gör när
--     rapporten skrivs. Regeln står alltså två gånger, här och i TypeScript; sackLedger.ts pekar hit.
--
-- SYNLIGT, INTE TYST
-- Flyttas rapporterna byter säckarna bil och därmed depå. DELETE-rutten räknar dem före borttagningen och skriver
-- antalet i aktivitetsloggen och i svaret, och tavlan säger det i sin toast.
--
-- VARFÖR I DATABASEN
-- Varje väg som tar bort ett kort får regeln, också service-rollen och framtida rutter. Samma form som
-- ops_segments_sync_planned_days (20260928122049) och ops_segments_sync_work_order_status (20261006185916):
--   * SECURITY DEFINER, tomt search_path, allt fullt kvalificerat, ingen EXECUTE för någon roll. Som invoker hade
--     flytten gått under RLS på ops_segment_reports, och en roll som får ta bort kort men inte uppdatera rapporter hade
--     uppdaterat 0 rader utan fel, varpå kaskaden raderat dem ändå.
--   * BEFORE DELETE, inte AFTER: rapporterna måste vara flyttade innan kaskaden på segment_id går.
--
-- SAMTIDIGHET
-- Två kort på samma order som tas bort i samma stund: flytten pekar om rapporterna till det andra kortet, och
-- FK-kontrollen måste låsa det kortet — som den andra borttagningen redan håller. Postgres avbryter då den ena
-- (deadlock, eller foreign_key_violation om den andra hann bli klar). Den som avbryts har inte tagit bort något, och
-- rapporterna ligger kvar på ett kort som finns. Inget eget orderlås behövs för att ingenting ska försvinna. I det
-- andra fallet visar tavlan beskedet om orderns enda kort, vilket då stämmer först efter en omladdning; känt och
-- ofarligt.
--
-- ÅTKOMST
-- Inga nya tabeller eller kolumner, inga nya grants. Triggerfunktionen får ingen EXECUTE (den prövas bara när triggern
-- skapas).
--
-- ORDNING MOT KODEN
-- Stramar åt: det sista kortet med rapporter går inte längre att ta bort. Koden (409-mappningen i
-- app/api/crm/planering/segments/[id]/route.ts) ska ut först eller samtidigt; den gör ingenting utan triggern. Går
-- migreringen först svarar rutten 500 med databasens text, som tavlan visar som den är. Idempotent, kan köras om.

-- ------------------------------------------------------------------------------------------------ regeln

create or replace function public.ops_segments_keep_sack_reports()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  n integer;
begin
  -- Inga rapporter (det vanliga, och alltid för en platshållare): ingenting att rädda.
  if not exists (select 1 from public.ops_segment_reports r where r.segment_id = old.id) then
    return old;
  end if;

  -- Ordern raderas: kaskaden från crm_work_orders går efter att orderraden tagits bort, så den syns inte här.
  -- Bara när kortet HAR en order. Ett kort utan order med rapporter på sig ska nekas nedan, inte släppas till
  -- kaskaden (`w.id = null` är aldrig sant, så utan villkoret hade det sett ut som en raderad order).
  if old.work_order_id is not null
     and not exists (select 1 from public.crm_work_orders w where w.id = old.work_order_id) then
    return old;
  end if;

  if not exists (
    select 1 from public.ops_segments s where s.work_order_id = old.work_order_id and s.id <> old.id
  ) then
    select count(*) into n from public.ops_segment_reports r where r.segment_id = old.id;
    raise exception using
      errcode = 'foreign_key_violation',
      message = format('Kortet har säckrapporter (%s st) och är orderns enda kort på schemat', n),
      hint = 'Flytta eller pausa kortet i stället. Tas det bort försvinner säckarna ur huvudboken och depån.';
  end if;

  -- Avstånd 0 = kortet täcker rapportdagen. Samma ordning som resolveSegmentForDay: närmast, tidigast start, id.
  update public.ops_segment_reports r
     set segment_id = (
       select s.id
         from public.ops_segments s
        where s.work_order_id = old.work_order_id
          and s.id <> old.id
        order by greatest(s.start_day - r.report_day, r.report_day - s.end_day, 0), s.start_day, s.id
        limit 1
     )
   where r.segment_id = old.id;

  return old;
end;
$$;

revoke all on function public.ops_segments_keep_sack_reports() from public, anon, authenticated, service_role;

drop trigger if exists ops_segments_keep_sack_reports on public.ops_segments;
create trigger ops_segments_keep_sack_reports
  before delete on public.ops_segments
  for each row execute function public.ops_segments_keep_sack_reports();

-- ------------------------------------------------------------------------------------------------ efterkontroll

do $$
declare
  fn text := 'public.ops_segments_keep_sack_reports()';
  who text;
  cfg text[];
  owner_oid oid;
  n integer;
begin
  -- Security definer, tomt search_path, ägd av tabellernas ägare (annars biter RLS på rapporterna).
  select c.relowner into owner_oid from pg_catalog.pg_class c where c.oid = 'public.ops_segment_reports'::regclass;
  if owner_oid <> (select c.relowner from pg_catalog.pg_class c where c.oid = 'public.ops_segments'::regclass) then
    raise exception 'säckrapporterna: ops_segment_reports och ops_segments har olika ägare';
  end if;
  select p.proconfig into cfg from pg_catalog.pg_proc p
   where p.oid = fn::regprocedure and p.prosecdef and p.proowner = owner_oid;
  if cfg is null or cfg <> array['search_path=""'] then
    raise exception 'säckrapporterna: % är inte security definer med tomt search_path och tabellernas ägare (%)', fn, cfg;
  end if;

  -- Ingen roll kör funktionen (has_function_privilege räknar in PUBLIC).
  foreach who in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(who, fn, 'EXECUTE') then
      raise exception 'säckrapporterna: % kan köra %', who, fn;
    end if;
  end loop;

  -- Triggern finns, är på, och är av rätt slag (tgtype: 1 rad, 2 before, 8 delete).
  select count(*) into n from pg_catalog.pg_trigger t
   where t.tgrelid = 'public.ops_segments'::regclass and t.tgname = 'ops_segments_keep_sack_reports'
     and t.tgenabled = 'O' and t.tgtype = 1 + 2 + 8
     and t.tgfoid = fn::regprocedure;
  if n <> 1 then raise exception 'säckrapporterna: triggern på ops_segments saknas eller är fel'; end if;
end $$;
