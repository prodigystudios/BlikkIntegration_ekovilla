-- Admin får rätta andras tidrader — med revisionslogg (fas 4.8)
--
-- William 2026-08-14: admin ska kunna rätta när något blivit fel. Fram tills nu har regeln varit
-- att INGEN ändrar någon annans timmar: policyerna är `user_id = auth.uid()` rakt av, och vägen att
-- rätta har varit att öppna perioden så personen rättar själv.
--
-- Den regeln hade ett hål ingen adresserat: **en anställd som är sjukskriven, har slutat eller
-- helt enkelt inte svarar när lönen ska köras.** Då gick månaden inte att rätta alls. Med Blikk
-- borta är det här enda systemet, så hålet var inte längre teoretiskt.
--
-- ⚠️ LOGGEN ÄR INTE VALFRI. Utan den byter vi "kan inte rätta" mot "någon annans lön ändrades och
-- ingen kan säga av vem". Därför skrivs revisionsraden av en TRIGGER och inte av appen: en
-- serverväg som glömmer logga, eller en direkt UPDATE i SQL-editorn, ska inte kunna kringgå den.
--
-- ⚠️ ATTESTERAD TID ÄNDRAS INTE. Låset står kvar oförändrat: admin måste öppna perioden först,
-- rätta, och attestera igen. Kunde attesterad tid ändras vore attesten meningslös — och periodlåset,
-- som medvetet ligger på två ställen (trigger + policy), hade blivit dekoration. Att öppna perioden
-- kräver en anledning som syns för den anställde, så rättelsen lämnar spår i BÅDA ändarna.
--
-- ⚠️ KÖRS FÖRE KODEN. Additiv i schemat, men INTE i beteende: getEffectivePermissions failar closed,
-- så en route som vaktar på en nyckel databasen inte känner till nekar alla. Och utan policygrenen
-- nedan träffar adminens UPDATE noll rader UTAN fel, vilket routen svarar 404 på — om en rad som
-- syns i listan. PERMISSIONS.md: "The same rule applies to every later key ... each SQL-first".


-- ── 1. Nyckeln ───────────────────────────────────────────────────────────────
-- Egen nyckel och inte `time.approve`: att få attestera är att godkänna det någon annan skrivit,
-- att få rätta är att skriva i deras ställe. Två olika befogenheter, och den ena ska gå att ge utan
-- den andra — en arbetsledare kan tänkas attestera utan att någonsin få ändra siffrorna.
--
-- Speglar lib/auth/permissions.ts PERMISSION_KEYS (antalstestet vaktar pariteten: 44 → 45).
insert into public.permissions (key, description) values
  ('time.entry.write.all', 'Tid: rätta andras tidrader i en öppen period')
on conflict (key) do nothing;

insert into public.role_permissions (role, permission_key) values
  ('admin','time.entry.write.all')
on conflict do nothing;


-- ── 2. Revisionsloggen ───────────────────────────────────────────────────────
-- En rad per ändring som INTE gjordes av raden ägare. Egna ändringar loggas inte: de är den
-- normala vägen, och att logga varje sparning i /tid hade dränkt de rader man faktiskt vill hitta.
create table if not exists public.crm_time_entry_audit (
  id            uuid primary key default gen_random_uuid(),
  entry_id      uuid not null,
  -- Vems tid det gällde, och vem som ändrade. Båda behövs: "admin ändrade" utan att veta vems
  -- lön det rörde är oanvändbart, och tvärtom likaså.
  user_id       uuid not null,
  changed_by    uuid not null,
  action        text not null check (action in ('update','delete','insert')),
  -- Hela raden före och efter, som jsonb. Inte kolumn för kolumn: tabellen växer med tiden, och en
  -- logg som tappar ett fält när schemat ändras är sämre än ingen logg alls.
  before_data   jsonb,
  after_data    jsonb,
  -- ⚠️ INGEN `reason`-kolumn, och det är avsiktligt. Motiveringen finns redan ett steg tidigare:
  -- för att en admin ska KUNNA rätta måste perioden vara öppen, och att öppna den kräver en
  -- anledning som sparas på attestraden och visas för den anställde i /tid. Att be om samma
  -- förklaring en gång till per rad hade gett "." som standardsvar.
  --
  -- (En kolumn här skulle dessutom vara svår att fylla: `set_config(..., true)` är
  -- transaktionslokal och PostgREST kör varje anrop i sin egen transaktion, så appen kan inte sätta
  -- ett värde som triggern ser utan att hela ändringen görs i EN databasfunktion.)
  created_at    timestamptz not null default now()
);

create index if not exists crm_time_entry_audit_entry_idx on public.crm_time_entry_audit (entry_id, created_at desc);
create index if not exists crm_time_entry_audit_user_idx  on public.crm_time_entry_audit (user_id, created_at desc);

-- Loggen är läsbar för den som får se andras tid, och för den vars tid det gäller — den anställde
-- ska kunna se att någon rört hens rader. INGA insert/update/delete-policyer: raderna skrivs bara
-- av triggern nedan, som är security definer. En logg som går att redigera är inte en logg.
-- `force` och inte bara `enable`: utan den går tabellägaren förbi RLS, och revoke gäller inte
-- service_role. En logg som en serverväg kan tömma är ingen logg.
alter table public.crm_time_entry_audit enable row level security;
alter table public.crm_time_entry_audit force row level security;
grant select on public.crm_time_entry_audit to authenticated;
revoke insert, update, delete on public.crm_time_entry_audit from authenticated, anon;

drop policy if exists crm_time_entry_audit_select on public.crm_time_entry_audit;
create policy crm_time_entry_audit_select on public.crm_time_entry_audit
  for select to authenticated
  using (user_id = auth.uid() or public.has_permission('time.entry.read.all'));


-- ── 3. Ägarlåset ─────────────────────────────────────────────────────────────
-- ⚠️ EN TIDRAD FÅR ALDRIG BYTA ÄGARE. Att rätta ett fel är en sak; att flytta någons timmar till en
-- annan persons löneunderlag en helt annan.
--
-- Fram till nu höll RLS det: WITH CHECK krävde `user_id = auth.uid()`, så en PATCH som ändrade
-- ägaren avvisades oavsett vilken väg den kom. Admin-grenen nedan släpper det villkoret för den som
-- har time.entry.write.all — och WITH CHECK KAN INTE SE OLD, så den kan omöjligt jämföra gammal och
-- ny ägare. Utan den här triggern vore appens fältstrippning enda skyddet, och den gäller inte en
-- request som går direkt mot PostgREST med användarens egen session.
create or replace function public.enforce_time_entry_owner()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'En tidrad kan inte byta ägare';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_time_entry_owner on public.crm_time_entries;
create trigger enforce_time_entry_owner
  before update on public.crm_time_entries
  for each row execute function public.enforce_time_entry_owner();


-- ── 4. Triggern som loggar ───────────────────────────────────────────────────
-- security definer: loggen ska skrivas även om den som ändrar inte har rätt att skriva i
-- audit-tabellen — vilket ingen har, med flit.
create or replace function public.log_time_entry_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_owner  uuid;
  v_entry  uuid;
  v_before jsonb;
  v_after  jsonb;
begin
  -- ⚠️ EN GREN PER OPERATION, aldrig `coalesce(new.x, old.x)`.
  --
  -- I plpgsql är NEW OALLOKERAD i en delete-trigger och OLD i en insert-trigger, och att läsa ett
  -- fält ur en oallokerad record är ett fel — inte null. coalesce hjälper inte, den evaluerar båda
  -- argumenten. En sådan funktion hade fått VARJE insert och VARJE delete på crm_time_entries att
  -- misslyckas, alltså all tidrapportering och inte bara adminrättelserna.
  --
  -- enforce_time_period_lock i 20260812_time_approvals.sql undviker samma sak med flit; dess
  -- kommentar om "två grenar i stället för ett CASE" är samma fälla.
  if tg_op = 'DELETE' then
    v_owner := old.user_id; v_entry := old.id; v_before := to_jsonb(old); v_after := null;
  elsif tg_op = 'INSERT' then
    v_owner := new.user_id; v_entry := new.id; v_before := null;             v_after := to_jsonb(new);
  else
    -- ⚠️ ÄGAREN TAS UR OLD PÅ EN UPPDATERING. Tog vi den ur NEW skulle en ägarflytt bokföras under
    -- den som TOG timmarna, och om den som flyttade dem tog dem till sig själv blev actor = owner
    -- och hoppet nedan skrev ingen rad alls — spårlöst, alltså precis tvärtemot vad loggen finns
    -- för. Ägarlåset ovan gör flytten omöjlig, men loggen ska inte förlita sig på en annan trigger.
    v_owner := old.user_id; v_entry := old.id; v_before := to_jsonb(old);    v_after := to_jsonb(new);
  end if;

  -- Egna ändringar loggas inte. Den normala vägen i /tid ska inte fylla loggen med brus; det är
  -- ändringar av NÅGON ANNANS tid som behöver kunna spåras.
  --
  -- v_actor är null när ändringen kommer från en servicenyckel eller ett SQL-editor-anrop. Då
  -- loggas den — en ändring utan känd användare är precis det man vill hitta i efterhand.
  if v_actor is not null and v_actor = v_owner then
    return null;
  end if;

  insert into public.crm_time_entry_audit (entry_id, user_id, changed_by, action, before_data, after_data)
  values (
    v_entry,
    v_owner,
    -- changed_by är not null: en okänd aktör bokförs som nollan i stället för att raden faller bort.
    coalesce(v_actor, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(tg_op),
    v_before,
    v_after
  );

  -- AFTER-triggerns returvärde ignoreras, så null är rätt svar — och slipper röra record-variabler
  -- en gång till.
  return null;
end;
$$;

-- AFTER: loggen ska spegla vad som FAKTISKT hände. En BEFORE-trigger hade skrivit en revisionsrad
-- även för en ändring som sedan avvisades av en CHECK eller av låstriggern.
drop trigger if exists log_time_entry_change on public.crm_time_entries;
create trigger log_time_entry_change
  after insert or update or delete on public.crm_time_entries
  for each row execute function public.log_time_entry_change();


-- ── 5. Policygrenarna ────────────────────────────────────────────────────────
-- ⚠️ DE HÄR ERSÄTTER policyerna med samma namn i 20260812_time_approvals.sql. Kör den filen INNAN
-- den här, aldrig efter — annars försvinner admin-grenen tyst, precis som periodlåset gjorde när
-- 20260811-filerna kördes om. `create policy` har inget `or replace`.
--
-- Låsvillkoret står KVAR i båda grenarna och prövas mot RADENS ÄGARE, inte mot den som ändrar:
-- perioden som fryser är den anställdes, och en admin som rättar måste öppna just den. Det är hela
-- skälet till att attesterad tid förblir orörbar.
drop policy if exists crm_time_entries_update_own on public.crm_time_entries;
create policy crm_time_entries_update_own on public.crm_time_entries
  for update to authenticated
  using (
    (user_id = auth.uid() or public.has_permission('time.entry.write.all'))
    and not public.is_time_locked(user_id, work_date)
  )
  with check (
    (user_id = auth.uid() or public.has_permission('time.entry.write.all'))
    and not public.is_time_locked(user_id, work_date)
    and (
      work_order_id is null
      or exists (
        select 1 from public.crm_work_orders w
        where w.id = crm_time_entries.work_order_id and w.assigned_to = auth.uid()
      )
      or public.is_user_on_work_order(auth.uid(), work_order_id)
      or public.has_permission('crm.workorder.read')
    )
  );

drop policy if exists crm_time_entries_delete_own on public.crm_time_entries;
create policy crm_time_entries_delete_own on public.crm_time_entries
  for delete to authenticated
  using (
    (user_id = auth.uid() or public.has_permission('time.entry.write.all'))
    and not public.is_time_locked(user_id, work_date)
  );

-- INSERT lämnas ORÖRD: `user_id = auth.uid()` står kvar. Att admin ska kunna lägga till en rad åt
-- någon annan är ett större steg — det är inte att rätta ett fel utan att skapa underlag från
-- ingenting — och det har William inte bett om. Rättningen täcker det efterfrågade fallet.


-- ── Verifiering ──────────────────────────────────────────────────────────────
--   select key from public.permissions where key = 'time.entry.write.all';
--
--   select policyname, cmd, qual from pg_policies
--   where schemaname='public' and tablename='crm_time_entries' and cmd in ('UPDATE','DELETE');
--   -- båda ska nämna time.entry.write.all OCH is_time_locked(user_id, work_date)
--
--   select tgname from pg_trigger where tgrelid = 'public.crm_time_entries'::regclass;
--   -- ska innehålla BÅDE enforce_time_period_lock OCH log_time_entry_change
--
-- Att loggen biter (kör som admin, på någon ANNANS rad i en öppen period):
--   update public.crm_time_entries set note = note where id = '<uuid>';
--   select action, changed_by, created_at from public.crm_time_entry_audit
--    where entry_id = '<uuid>' order by created_at desc limit 1;
