-- Tid & lön (fas 4) — traktamenten, utlägg och milersättning.
--
-- Lönebyrån (2026-08-11): "de behöver kunna lägga in traktamenten, utlägg, milersättning med belopp
-- och datum". Ingen av dem fanns i modellen — tidraden hade bara travel_km och en "till lön"-flagga.
--
-- EGNA POSTER, INTE FÄLT PÅ TIDRADEN. En ersättning har sitt eget datum och hör inte till ett visst
-- arbetspass: ett utlägg kan finnas en dag man inte jobbat, och två utlägg samma dag ska synas som
-- två rader och inte summeras ihop till ett belopp ingen känner igen.
--
-- ⚠️ BÅDE `quantity` OCH `amount` LAGRAS, alltid. Vem som fyller i beloppet — den anställde nu, eller
-- systemet ur en sats senare — är då en fråga om formuläret och inte om databasen, och att byta håll
-- blir en ändring i inmatningen i stället för en migrering.
--
-- Det finns ett skäl till att beloppet lagras även om systemet en dag räknar ut det: räknas det ur en
-- sats vid VISNING, och satsen ändras i januari, så ändras december månads underlag retroaktivt
-- nästa gång någon öppnar det. Ett lagrat belopp är fruset i tiden, vilket är vad ett löneunderlag
-- ska vara. Ingen sats finns i koden i dag.
--
-- DEPLOY-ORDNING: efter BÅDE 20260811_time_permissions.sql (RLS anropar has_permission) OCH
-- 20260811_time_reference_tables.sql — triggern nedan använder set_timestamp_time_reference() som
-- skapas där. Följer man bara den första avbryts skriptet mitt i: tabellen finns, RLS är påslagen,
-- men inga policyer hinner skapas, vilket ger en tabell ingen kan läsa. Idempotent.

create table if not exists public.crm_time_compensations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete restrict,
  entry_date  date not null,
  -- travel = milersättning, per_diem = traktamente, expense = utlägg.
  kind        text not null check (kind in ('travel', 'per_diem', 'expense')),
  -- Mil för travel, dagar för per_diem, null för utlägg. Informativ: beloppet är det som gäller.
  quantity    numeric(8, 1) check (quantity is null or quantity >= 0),
  amount      numeric(10, 2) not null check (amount >= 0),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists crm_time_compensations_user_date_idx
  on public.crm_time_compensations (user_id, entry_date desc);

drop trigger if exists set_timestamp_crm_time_compensations on public.crm_time_compensations;
create trigger set_timestamp_crm_time_compensations
before update on public.crm_time_compensations
for each row execute procedure public.set_timestamp_time_reference();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Samma regler som tidraderna, av samma skäl: det här är löneunderlag och personuppgift. Man ser och
-- skriver sitt eget; den som har time.entry.read.all ser allas. Ändra och radera är rent
-- ägarskopat — ingen ska kunna röra någon annans utlägg tyst.
--
-- Ingen besättningsgren här: ett utlägg hör till en person, aldrig till ett jobb, så det finns
-- ingen arbetsorder att härleda åtkomst ur.
alter table public.crm_time_compensations enable row level security;
grant select, insert, update, delete on public.crm_time_compensations to authenticated;

drop policy if exists crm_time_compensations_select on public.crm_time_compensations;
create policy crm_time_compensations_select on public.crm_time_compensations
  for select to authenticated
  using (user_id = auth.uid() or public.has_permission('time.entry.read.all'));

drop policy if exists crm_time_compensations_insert on public.crm_time_compensations;
create policy crm_time_compensations_insert on public.crm_time_compensations
  for insert to authenticated
  with check (user_id = auth.uid() and public.has_permission('time.entry.write'));

drop policy if exists crm_time_compensations_update_own on public.crm_time_compensations;
create policy crm_time_compensations_update_own on public.crm_time_compensations
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists crm_time_compensations_delete_own on public.crm_time_compensations;
create policy crm_time_compensations_delete_own on public.crm_time_compensations
  for delete to authenticated
  using (user_id = auth.uid());

-- ── Verifiering ──────────────────────────────────────────────────────────────
--   select policyname, cmd from pg_policies
--   where schemaname='public' and tablename='crm_time_compensations' order by cmd;
--
-- Beloppet ska aldrig kunna vara negativt eller saknas:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.crm_time_compensations'::regclass and contype = 'c';
