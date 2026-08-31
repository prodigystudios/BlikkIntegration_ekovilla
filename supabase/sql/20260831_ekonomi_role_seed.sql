-- Rollen `ekonomi` — STEG 2 AV 2: behörighetsknippet + uteslutningen ur löneunderlaget.
--
-- ⚠️ KÖRS SOM EN EGEN OMGÅNG, EFTER att 20260831_ekonomi_role.sql committat. PostgreSQL vägrar
-- använda ett nyss tillagt enum-värde i samma transaktion som la till det, och
-- role_permissions.role är typad public.user_role. Körs de ihop failar insert:en nedan.
--
-- ADDITIV. Inga befintliga rader ändras: en ny roll får ett nytt knippe, och funktionen nedan får
-- ett extra värde i sitt WHERE. Ingen kod behöver deployas före eller efter.
--
-- Kör i Supabase SQL-editorn.

-- ── 1. Knippet ───────────────────────────────────────────────────────────────
-- Vad hon ska kunna: se alla anställdas tidrader, och attestera månaden när hon kontrollerat den
-- (Williams beslut 2026-08-31 — lönen får inte fastna på en glömd knapp, och att månaden är klar
-- är rimligen hennes besked).
--
-- Vad hon MEDVETET inte får, och varför:
--
--   time.entry.write       Hon är inte anställd här. Hon har ingen egen tid att rapportera, och en
--                          skrivnyckel hade dessutom satt henne själv i attestlistan som en person
--                          med noll timmar (se punkt 2).
--   time.entry.write.all   Williams beslut: hon rapporterar avvikelser, den anställde rättar själv.
--                          Det är den dokumenterade designen — ingen ändrar någon annans timmar
--                          tyst — och det håller isär den som ändrar underlaget från den som
--                          godkänner det.
--   time.reference.manage  Tidkoder och frånvarotyper är kontorets, inte byråns.
--   crm.* / fortnox.*      Hon ska aldrig se en kund, ett pris eller en faktura. Se punkt 3.
--   planning.*             Samma sak.
--
-- time.payroll.read har hittills varit seedad men OANVÄND i hela kodbasen — den vaktar ingen route
-- i dag. Den tas med för att den är rätt namn på det hon gör, och för att en framtida export ska ha
-- en egen nyckel att hänga på i stället för att time.approve behöver spridas till den som bara
-- ska läsa.
insert into public.role_permissions (role, permission_key) values
  ('ekonomi','time.entry.read.all'),
  ('ekonomi','time.approve'),
  ('ekonomi','time.payroll.read')
on conflict do nothing;

-- ── 2. Hon ska inte stå i sitt eget underlag ─────────────────────────────────
-- time_approval_overview listar ALLA anställda, även de utan en enda rapporterad timme — en tom rad
-- är precis den information attestvyn finns för. Just därför måste den som inte ÄR anställd bort:
-- annars står lönebyrån själv i listan varje månad med 0 h och status `open`, som en permanent
-- falsklarm-rad i filtret "Inget rapporterat".
--
-- Enda ändringen mot 20260812_time_approvals.sql är WHERE-raden. Funktionen återskapas i sin helhet
-- eftersom `returns table` inte går att ändra med `create or replace`; grants:en efteråt är därför
-- inte kosmetik utan nödvändiga — `drop function` tar dem med sig.
drop function if exists public.time_approval_overview(date);

create function public.time_approval_overview(p_period_start date)
returns table (
  user_id               uuid,
  full_name             text,
  role                  text,
  status                text,
  submitted_at          timestamptz,
  approved_at           timestamptz,
  approved_by           uuid,
  approved_by_name      text,
  note                  text,
  work_minutes          bigint,
  absence_minutes       bigint,
  entry_count           bigint,
  compensation_amount   numeric,
  compensation_count    bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_next date;
begin
  -- Behörighetsgränsen. En definer-funktion utan den här raden är en öppen dörr till allas timmar.
  if not public.has_permission('time.approve') then
    raise exception 'Du har inte behörighet att attestera tid';
  end if;
  if p_period_start <> date_trunc('month', p_period_start::timestamp)::date then
    raise exception 'Perioden måste börja på den första i en månad';
  end if;

  v_next := (p_period_start + interval '1 month')::date;

  return query
  select
    p.id,
    p.full_name,
    p.role::text,
    coalesce(a.status, 'open'),
    a.submitted_at,
    a.approved_at,
    a.approved_by,
    ap.full_name,
    a.note,
    coalesce(e.work_minutes, 0),
    coalesce(e.absence_minutes, 0),
    coalesce(e.entry_count, 0),
    coalesce(c.total_amount, 0)::numeric,
    coalesce(c.row_count, 0)
  from public.profiles p
  left join public.crm_time_approvals a
    on a.user_id = p.id and a.period_start = p_period_start
  left join public.profiles ap on ap.id = a.approved_by
  left join lateral (
    select
      -- minutes_worked är sanningen; hours-fallbacken fångar de gamla kontorsraderna
      -- (source='legacy_office') som skrevs innan minuterna fanns.
      sum(case when t.kind <> 'absence' then coalesce(t.minutes_worked, round(t.hours * 60)::int) else 0 end)::bigint as work_minutes,
      sum(case when t.kind =  'absence' then coalesce(t.minutes_worked, round(t.hours * 60)::int) else 0 end)::bigint as absence_minutes,
      count(*)::bigint as entry_count
    from public.crm_time_entries t
    where t.user_id = p.id
      and t.work_date >= p_period_start
      and t.work_date < v_next
  ) e on true
  left join lateral (
    select sum(k.amount) as total_amount, count(*)::bigint as row_count
    from public.crm_time_compensations k
    where k.user_id = p.id
      and k.entry_date >= p_period_start
      and k.entry_date < v_next
  ) c on true
  -- konsult: extern roll utan time-nycklar, rapporterar aldrig tid.
  -- ekonomi: lönebyrån själv — hon läser listan, hon står inte i den.
  where p.role not in ('konsult','ekonomi')
  order by p.full_name nulls last, p.id;
end;
$$;

revoke all on function public.time_approval_overview(date) from public;
grant execute on function public.time_approval_overview(date) to authenticated;

-- ── 3. Skrivspärren i RLS måste känna till rollen ────────────────────────────
-- ⚠️ DET HÄR ÄR HÄLFTEN AV SKRIVSPÄRREN. Den andra halvan är isReadonlyRole() i lib/auth/route.ts,
-- och de MÅSTE ha samma rollista — de vaktar olika vägar till samma tabeller.
--
-- is_konsult_user() bär `NOT ...` i write-policyerna på planning_segments, planning_project_meta
-- och deras grannar (20260121_add_readonly_role_and_planning_write_guard.sql). Den listade bara
-- konsult och readonly, alltså: varje NY roll fick skriva i planeringen som default. Gamla
-- /plannering är dessutom en ren klientsida utan serverrollgrind, så en `ekonomi`-användare som
-- skrev adressen hade fått en fullt redigerbar planeringstavla — med kundnamn, adresser och
-- telefonnummer.
--
-- Funktionsnamnet är historiskt och beskriver inte längre urvalet. Det byts INTE här: namnet står i
-- tio policyer, och en omdöpning i samma ändring som en behörighetsfix gör bägge svårare att
-- granska. Läs det som "får inte skriva".
--
-- `p.role::text` behålls med flit — textjämförelsen är just det som gör att den här satsen kan ligga
-- i samma fil som seeden ovan, trots att 'ekonomi' är ett nytt enum-värde.
create or replace function public.is_konsult_user()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('konsult', 'readonly', 'ekonomi')
  );
$$;

-- ── 4. Om den tomma jobbkolumnen ─────────────────────────────────────────────
-- Noterat här därför att det ser ut som en bugg och är ett beslut: dagvyns tidrader embeddar
-- crm_work_orders (lib/domains/time/entries.ts), och SELECT-policyn på den tabellen kräver
-- crm.workorder.read, assigned_to eller besättning. `ekonomi` har inget av det, så embedden svarar
-- null och kolumnen "Orsak / jobb" saknar arbetsordern för henne.
--
-- Det är RÄTT: byrån ska inte få kundnamn per arbetad timme. Lös det INTE genom att ge rollen
-- crm.workorder.read. UI:t visar i stället en neutral markör så att gränsen inte läses som saknad
-- data. Frånvaroorsaker och internprojekt påverkas inte — de tabellerna är läsbara för alla
-- inloggade (20260811_time_reference_tables.sql), och byrån behöver orsaken i klartext.

-- ── Verifiering (kör efter applicering, en fråga i taget) ────────────────────
-- Förväntat: exakt tre rader, alla under time.*.
--
--   select role, permission_key from public.role_permissions where role = 'ekonomi' order by 2;
--
-- Ingen crm-, fortnox- eller planning-nyckel ska ha smugit in (förväntat: 0):
--
--   select count(*) from public.role_permissions
--   where role = 'ekonomi' and permission_key not like 'time.%';
--
-- Uteslutningen är live (förväntat: true):
--
--   select pg_get_functiondef(oid) like '%not in (''konsult'',''ekonomi'')%'
--   from pg_proc where proname = 'time_approval_overview';
--
-- Ingen befintlig roll tappade något (jämför mot samma fråga före körningen):
--
--   select role, count(*) from public.role_permissions group by role order by role;
