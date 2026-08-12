-- Tid & lön (fas 4.4) — attest per person och kalendermånad, och låset som gör den värd något.
--
-- Utan attest är ett löneunderlag bara en läsning av en tabell som fortfarande kan ändras. Den här
-- filen inför perioden som ett tillstånd: `open` → `submitted` → `approved`, och gör att en period
-- som lämnats in eller attesterats inte längre går att skriva i.
--
-- FYRA BESLUT SOM STYR FORMEN (William, 2026-08-12):
--   1. Perioden är en KALENDERMÅNAD. Ingen brytdag, inga halvmånader — CHECK:en nedan tillåter bara
--      den första i månaden som periodstart, så en avvikande period kan inte smyga in via ett
--      direktanrop.
--   2. Den anställde får ÅNGRA sin egen inlämning så länge den inte attesterats. `submitted` låser
--      alltså skrivningen, men den som lämnat in kan öppna igen själv. Efter `approved` är det bara
--      någon med time.approve.
--   3. Admin får attestera direkt från `open`. Lönen måste kunna köras även för den som är sjuk,
--      slutat eller bara glömt trycka på knappen.
--   4. Inga notiser i det här steget.
--
-- ⚠️ SKRIVNINGAR GÅR BARA GENOM RPC:n. Tabellen har SELECT-policy men INGA insert/update/delete-
-- policyer, och grants för dem är återkallade. Med en vanlig UPDATE-policy hade den anställde kunnat
-- sätta status='approved' på sin egen rad med en PATCH mot PostgREST — attesten hade varit en
-- självbetjäningsknapp. set_time_period_status() är den enda vägen in, och den känner
-- övergångsmatrisen.
--
-- ⚠️ LÅSET ÄR BÅDE POLICY OCH TRIGGER, med flit. Policyn är den läsbara garantin på normalvägen och
-- ger ett rent nekande. Triggern är den OVILLKORLIGA: getSupabaseAdmin() går förbi RLS helt, så en
-- policy ensam hade inte hindrat en serverväg (eller en Supabase-dashboard) från att ändra en
-- attesterad månad.
--
-- DEPLOY-ORDNING: efter 20260811_time_permissions.sql (has_permission på nycklarna),
-- 20260811_time_entries_reshape.sql + _rls.sql och 20260811_time_compensations.sql.
-- Den här filen ÄGER numera write-policyerna på BÅDA de tabellerna — se SUPERSEDED-noterna i
-- respektive fil. Kör den SIST av tid-filerna, och kör om den om någon av dem körts om.
-- Idempotent (kör den två gånger i SQL-editorn innan du litar på den).

-- ── 1. Tabellen ──────────────────────────────────────────────────────────────
-- period_end lagras INTE. Ett härlett värde som ligger bredvid sin källa kan hamna i otakt, och
-- "månaden som börjar här" är hela sanningen — slutet räknas ut där det behövs (i SQL nedan, i
-- lib/domains/time/approvals.ts på appsidan).
create table if not exists public.crm_time_approvals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete restrict,
  period_start  date not null,
  status        text not null default 'open' check (status in ('open', 'submitted', 'approved')),
  submitted_at  timestamptz,
  approved_at   timestamptz,
  approved_by   uuid references public.profiles(id) on delete set null,
  -- Senaste återöppningen. Sparas för att frågan "varför ändrades den här månaden efter attest"
  -- ska gå att besvara utan att gissa.
  reopened_at   timestamptz,
  -- Anledningen vid återöppning; fritext från adminytan.
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Kalendermånad, inte "en period".
--
-- ⚠️ `::timestamp` är inte utfyllnad. `date_trunc('month', <date>)` löser till timestamptz-varianten
-- (timestamptz är den föredragna typen i datumkategorin), och den är STABLE — en CHECK-constraint
-- avvisar den med "functions in check constraint must be marked IMMUTABLE". Den explicita casten
-- pekar ut timestamp-varianten, som är immutable. Samma skrivsätt används i funktionerna nedan för
-- att inte två ställen ska svara olika på vad en periodstart är.
alter table public.crm_time_approvals drop constraint if exists crm_time_approvals_period_start_check;
alter table public.crm_time_approvals add constraint crm_time_approvals_period_start_check
  check (period_start = date_trunc('month', period_start::timestamp)::date);

-- Bär on conflict-målet i RPC:n. En person kan ha exakt en rad per månad.
create unique index if not exists crm_time_approvals_user_period_idx
  on public.crm_time_approvals (user_id, period_start);
-- Adminvyns fråga: "vilka har lämnat in augusti?"
create index if not exists crm_time_approvals_period_status_idx
  on public.crm_time_approvals (period_start, status);

drop trigger if exists set_timestamp_crm_time_approvals on public.crm_time_approvals;
create trigger set_timestamp_crm_time_approvals
before update on public.crm_time_approvals
for each row execute procedure public.set_timestamp_time_reference();

-- ── 2. RLS: läsning här, skrivning bara via RPC ──────────────────────────────
alter table public.crm_time_approvals enable row level security;
grant select on public.crm_time_approvals to authenticated;
-- Uttryckligt återkallande, inte bara "vi grantade aldrig": en tidigare körning, en dashboard-klick
-- eller ett framtida `grant all` skulle annars öppna PATCH-vägen förbi övergångsmatrisen.
revoke insert, update, delete on public.crm_time_approvals from authenticated;

drop policy if exists crm_time_approvals_select on public.crm_time_approvals;
create policy crm_time_approvals_select on public.crm_time_approvals
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_permission('time.approve')
    or public.has_permission('time.entry.read.all')
  );

-- ── 3. is_time_locked ────────────────────────────────────────────────────────
-- Sanningen om huruvida en persons datum ligger i en stängd period. Både triggern och policyerna
-- frågar den här, så de kan aldrig svara olika.
--
-- security definer: triggern körs som den som skriver, och den som skriver ska inte behöva kunna
-- LÄSA attestraden för att hindras av den. Funktionen lämnar bara ifrån sig en boolean.
create or replace function public.is_time_locked(p_user_id uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.crm_time_approvals a
    where a.user_id = p_user_id
      -- BÅDA låser. `submitted` räcker: annars kan någon ändra i underlaget medan granskningen
      -- pågår, och granskaren attesterar något annat än det hen tittade på.
      and a.status in ('submitted', 'approved')
      and p_date >= a.period_start
      and p_date < (a.period_start + interval '1 month')
  );
$$;

revoke all on function public.is_time_locked(uuid, date) from public;
grant execute on function public.is_time_locked(uuid, date) to authenticated;

-- ── 4. Låstriggern ───────────────────────────────────────────────────────────
-- En funktion för båda tabellerna. Datumkolumnen heter olika (`work_date` / `entry_date`) och
-- skickas därför in som triggerargument; raden läses via to_jsonb så samma kropp duger till båda.
-- Alternativet — två nästan identiska funktioner — hade betytt att en rättning kan landa i den ena.
--
-- BÅDE gammal och ny rad prövas. Bara den nya hade räckt för INSERT, men inte för UPDATE: att flytta
-- en rad UT ur en attesterad månad ändrar den månadens summa lika mycket som att ändra den på plats.
-- DELETE prövar den gamla, av samma skäl.
create or replace function public.enforce_time_period_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date_column text := tg_argv[0];
begin
  if tg_op in ('UPDATE', 'DELETE') then
    if public.is_time_locked(
         (to_jsonb(old) ->> 'user_id')::uuid,
         (to_jsonb(old) ->> v_date_column)::date
       ) then
      raise exception 'Perioden är inlämnad eller attesterad och kan inte ändras';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if public.is_time_locked(
         (to_jsonb(new) ->> 'user_id')::uuid,
         (to_jsonb(new) ->> v_date_column)::date
       ) then
      raise exception 'Perioden är inlämnad eller attesterad och kan inte ändras';
    end if;
  end if;

  -- En before-trigger måste returnera OLD på DELETE och NEW annars, annars avbryts operationen.
  -- Två grenar i stället för ett CASE: `old` och `new` är record-variabler och en CASE över dem
  -- tvingar plpgsql att typa uttrycket vid kompilering.
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- `raise exception` utan errcode ger SQLSTATE P0001, som PostgREST lämnar vidare med meddelandet
-- intakt. Routelagret mappar P0001 på tid-ytan till 409 + det svenska meddelandet.
drop trigger if exists enforce_time_period_lock on public.crm_time_entries;
create trigger enforce_time_period_lock
before insert or update or delete on public.crm_time_entries
for each row execute procedure public.enforce_time_period_lock('work_date');

drop trigger if exists enforce_time_period_lock on public.crm_time_compensations;
create trigger enforce_time_period_lock
before insert or update or delete on public.crm_time_compensations
for each row execute procedure public.enforce_time_period_lock('entry_date');

-- ── 5. Övergångsmatrisen ─────────────────────────────────────────────────────
-- Enda skrivvägen in i tabellen. Matrisen speglas i canTransition() i lib/domains/time/approvals.ts
-- så knappen kan vara rätt innan anropet görs — men det är HÄR den gäller. Ändras den ena måste den
-- andra följa med; testet tests/time/approvals.test.ts beskriver samma matris i ord.
--
--   open      → submitted   bara en själv (och man måste få rapportera tid alls)
--   open      → approved    time.approve  (beslut 3: lönen får inte fastna på en glömd knapp)
--   submitted → approved    time.approve
--   submitted → open        en själv (ångra) ELLER time.approve (skicka tillbaka)
--   approved  → open        bara time.approve
--
-- Samma status igen är en tyst no-op, inte ett fel: dubbelklick och en långsam uppkoppling ska inte
-- ge ett rött meddelande om något som redan är sant.
create or replace function public.set_time_period_status(
  p_user_id      uuid,
  p_period_start date,
  p_status       text,
  p_note         text default null
)
returns public.crm_time_approvals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor       uuid := auth.uid();
  v_is_self     boolean;
  v_can_approve boolean;
  v_current     text;
  v_row         public.crm_time_approvals;
begin
  if v_actor is null then
    raise exception 'Inte inloggad';
  end if;
  if p_status not in ('open', 'submitted', 'approved') then
    raise exception 'Okänd status: %', p_status;
  end if;
  if p_period_start <> date_trunc('month', p_period_start::timestamp)::date then
    raise exception 'Perioden måste börja på den första i en månad';
  end if;

  v_is_self     := (p_user_id = v_actor);
  v_can_approve := public.has_permission('time.approve');

  -- FOR UPDATE: två samtidiga anrop (t.ex. den anställde ångrar i samma sekund som admin
  -- attesterar) ska inte kunna läsa samma utgångsstatus och båda skriva.
  select * into v_row
  from public.crm_time_approvals
  where user_id = p_user_id and period_start = p_period_start
  for update;

  v_current := coalesce(v_row.status, 'open');

  if v_current = p_status then
    -- Ingen rad alls + status 'open' = redan sant, inget att skriva.
    return v_row;
  end if;

  if p_status = 'submitted' then
    if not v_is_self then
      raise exception 'Bara den anställde kan lämna in sin egen period';
    end if;
    if not public.has_permission('time.entry.write') then
      raise exception 'Du har inte behörighet att rapportera tid';
    end if;
    if v_current <> 'open' then
      raise exception 'Perioden är redan attesterad';
    end if;

  elsif p_status = 'approved' then
    if not v_can_approve then
      raise exception 'Du har inte behörighet att attestera tid';
    end if;

  else -- 'open'
    if v_current = 'approved' and not v_can_approve then
      raise exception 'Perioden är attesterad och kan bara öppnas av en attestansvarig';
    end if;
    if v_current = 'submitted' and not (v_is_self or v_can_approve) then
      raise exception 'Du kan bara ångra din egen inlämning';
    end if;
  end if;

  insert into public.crm_time_approvals as a (
    user_id, period_start, status, submitted_at, approved_at, approved_by, reopened_at, note
  )
  values (
    p_user_id,
    p_period_start,
    p_status,
    case when p_status = 'submitted' then now() end,
    case when p_status = 'approved'  then now() end,
    case when p_status = 'approved'  then v_actor end,
    case when p_status = 'open'      then now() end,
    p_note
  )
  on conflict (user_id, period_start) do update set
    status = excluded.status,
    -- Tidsstämplarna sätts om från grunden vid varje övergång i stället för att ackumuleras. En
    -- kvarlämnad approved_at på en öppnad period hade läst som att den fortfarande vore attesterad.
    submitted_at = case when excluded.status = 'submitted' then now()
                        when excluded.status = 'open'      then null
                        else a.submitted_at end,
    approved_at  = case when excluded.status = 'approved'  then now()  else null end,
    approved_by  = case when excluded.status = 'approved'  then v_actor else null end,
    reopened_at  = case when excluded.status = 'open'      then now()  else a.reopened_at end,
    note         = p_note,
    updated_at   = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_time_period_status(uuid, date, text, text) from public;
grant execute on function public.set_time_period_status(uuid, date, text, text) to authenticated;

-- ── 6. Adminöversikten ───────────────────────────────────────────────────────
-- Attestvyn behöver, per person och månad: status + hur mycket som faktiskt är rapporterat. Det
-- kräver att man ser ANDRAS profiler, och profiles har self-select-RLS (auth_roles_setup.sql). Utan
-- den här funktionen hade routen behövt getSupabaseAdmin(), alltså full service-role för en ren
-- läsning — samma resonemang som get_my_crm_jobs: hellre en definer-funktion vars urval ÄR
-- säkerhetsgränsen än en nyckel som öppnar allt.
--
-- Alla anställda listas, även de som inte rapporterat något: en tom rad är precis den information
-- attestvyn finns för. konsult utesluts — extern roll utan time-nycklar, de rapporterar aldrig tid.
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
  where p.role <> 'konsult'
  order by p.full_name nulls last, p.id;
end;
$$;

revoke all on function public.time_approval_overview(date) from public;
grant execute on function public.time_approval_overview(date) to authenticated;

-- ── 7. Låset i policyerna ────────────────────────────────────────────────────
-- ⚠️ DE HÄR FYRA + TVÅ POLICYERNA ÄGS NUMERA AV DEN HÄR FILEN. De är kopior av dem i
-- 20260811_time_entries_rls.sql respektive 20260811_time_compensations.sql, med lås-villkoret
-- tillagt på skrivningarna. Körs någon av de filerna om EFTER den här måste den här köras om igen —
-- båda har fått en SUPERSEDED-header som säger det.
--
-- Låset ligger SIST i varje and-kedja med flit: `user_id = auth.uid()` är en kolumnjämförelse och
-- avgör de allra flesta nekanden innan is_time_locked ens behöver frågas.
--
-- SELECT rörs inte. En attesterad månad ska fortfarande gå att LÄSA — den är ju underlaget.

-- Tidrader
drop policy if exists crm_time_entries_insert on public.crm_time_entries;
create policy crm_time_entries_insert on public.crm_time_entries
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.has_permission('time.entry.write')
    and (
      work_order_id is null
      or exists (
        select 1 from public.crm_work_orders w
        where w.id = crm_time_entries.work_order_id and w.assigned_to = auth.uid()
      )
      or public.is_user_on_work_order(auth.uid(), work_order_id)
      or public.has_permission('crm.workorder.read')
    )
    and not public.is_time_locked(auth.uid(), work_date)
  );

drop policy if exists crm_time_entries_update_own on public.crm_time_entries;
create policy crm_time_entries_update_own on public.crm_time_entries
  for update to authenticated
  -- USING prövar den GAMLA raden, WITH CHECK den nya. Båda behöver låset: annars går en rad att
  -- flytta in i eller ut ur en stängd månad, vilket ändrar den månadens summa lika mycket som en
  -- ändring på plats.
  using (
    user_id = auth.uid()
    and not public.is_time_locked(auth.uid(), work_date)
  )
  with check (
    user_id = auth.uid()
    and (
      work_order_id is null
      or exists (
        select 1 from public.crm_work_orders w
        where w.id = crm_time_entries.work_order_id and w.assigned_to = auth.uid()
      )
      or public.is_user_on_work_order(auth.uid(), work_order_id)
      or public.has_permission('crm.workorder.read')
    )
    and not public.is_time_locked(auth.uid(), work_date)
  );

drop policy if exists crm_time_entries_delete_own on public.crm_time_entries;
create policy crm_time_entries_delete_own on public.crm_time_entries
  for delete to authenticated
  using (
    user_id = auth.uid()
    and not public.is_time_locked(auth.uid(), work_date)
  );

-- Ersättningar. Samma regel: traktamenten och utlägg är också löneunderlag och fryser med perioden.
drop policy if exists crm_time_compensations_insert on public.crm_time_compensations;
create policy crm_time_compensations_insert on public.crm_time_compensations
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.has_permission('time.entry.write')
    and not public.is_time_locked(auth.uid(), entry_date)
  );

drop policy if exists crm_time_compensations_update_own on public.crm_time_compensations;
create policy crm_time_compensations_update_own on public.crm_time_compensations
  for update to authenticated
  using (user_id = auth.uid() and not public.is_time_locked(auth.uid(), entry_date))
  with check (user_id = auth.uid() and not public.is_time_locked(auth.uid(), entry_date));

drop policy if exists crm_time_compensations_delete_own on public.crm_time_compensations;
create policy crm_time_compensations_delete_own on public.crm_time_compensations
  for delete to authenticated
  using (user_id = auth.uid() and not public.is_time_locked(auth.uid(), entry_date));

-- ── Verifiering (kör efter applicering) ──────────────────────────────────────
--
-- ⚠️ LÄS DEN HÄR RADEN FÖRST: i Supabase SQL-editorn är `auth.uid()` NULL. Du kör som tabellägare
-- utan session, inte som en inloggad användare. Allt som hänger på auth.uid() —
-- set_time_period_status, time_approval_overview, samtliga RLS-policyer — svarar därför fel här
-- ("Inte inloggad", "Du har inte behörighet"), och det säger ingenting om att koden är trasig.
-- Samma fälla som SUPABASE_CONVENTIONS.md → "Measuring what a policy costs" beskriver.
--
-- Dela alltså upp verifieringen:
--   A. Allt sessionsberoende testas I APPEN (/tid och Admin → Attest).
--   B. Bara det som är oberoende av vem som frågar testas i editorn: punkt 1, 2 och 3 nedan.
--
-- ── A. I appen ───────────────────────────────────────────────────────────────
--   • Lämna in en månad i /tid → Ändra/Ta bort/Rapportera ska försvinna på månadens dagar.
--   • Försök ändå (t.ex. via kontorets Tid-flik på en arbetsorder) → 409 med svensk text,
--     inte 500 och inte "Tidraden hittades inte".
--   • "Ångra inlämning" → raderna går att röra igen.
--   • Admin → Attest → Attestera → nu ska "Ångra" vara borta för den anställde; bara
--     "Öppna igen" (med anledning) fungerar, och anledningen ska synas i personens /tid.
--   • Som en riktig member (installatör): rapportera, lämna in, ångra. Det är den enda
--     persona vars RLS-väg aldrig har setts neka på riktigt.
--
-- ── B. I SQL-editorn ─────────────────────────────────────────────────────────
-- 1. Låset ska gälla ÄVEN förbi RLS — det är hela poängen med triggern. Som tabellägare:
--      update public.crm_time_entries set note = note where id = '<rad i inlämnad månad>';
--    → "Perioden är inlämnad eller attesterad och kan inte ändras".
--    ⚠️ "0 rows" är INTE godkänt — då fanns raden inte och du mätte ingenting. Kontrollera först:
--      select id, user_id, work_date from public.crm_time_entries
--       where work_date >= '<periodstart>' and work_date < '<periodstart + 1 mån>';
--
-- 2. Policyinventering — sex skrivpolicyer ska nämna is_time_locked, ingen SELECT-policy ska göra det:
--      select tablename, policyname, cmd,
--             coalesce(qual, '') || ' ' || coalesce(with_check, '') like '%is_time_locked%' as har_las
--      from pg_policies
--      where schemaname = 'public' and tablename in ('crm_time_entries', 'crm_time_compensations')
--      order by tablename, cmd, policyname;
--
-- 3. Grants — authenticated ska ha SELECT och inget annat på attesttabellen:
--      select privilege_type from information_schema.role_table_grants
--      where table_name = 'crm_time_approvals' and grantee = 'authenticated';
--    Kommer något annat än SELECT tillbaka är PATCH-vägen förbi övergångsmatrisen öppen.
