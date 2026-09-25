-- Tid & lön (fas 4) — tidraden blir löneunderlag: crm_work_order_time_entries → crm_time_entries.
--
-- Fas 4.2. Tabellen finns sedan 20260530064347 men är byggd för intern uppföljning på kontoret:
-- work_date, hours, note, och work_order_id NOT NULL. Lön kräver klockslag, rast, frånvaro,
-- interntid och restid — och frånvaro har per definition ingen arbetsorder.
--
-- ⚠️ NAMNBYTE, INTE NY TABELL. Det värsta tänkbara utfallet i hela fas 4 är att timmar finns på två
-- ställen: en ny tabell bredvid den gamla ger kontorets Tid-flik en annan summa än löneunderlaget
-- för samma jobb, vilket är precis den klyvning fasen ska stänga. `rename` behåller data, index,
-- triggers, grants OCH policyer (de följer tabellens OID), så de sovande crew-policyerna från
-- 20260810_crm_work_order_crew_access.sql överlever intakt. Policyerna döps om i syskonfilen
-- 20260811_time_entries_rls.sql.
--
-- ⚠️ TVÅ ÄLDRE FILER REFERERAR DET GAMLA NAMNET och är skrivna för att kunna köras om:
--   supabase/migrations/20260530064347_crm_work_order_activity.sql  (create table if not exists)
--   supabase/sql/20260810_crm_work_order_crew_access.sql            (create policy … on …)
-- Kör någon om dem EFTER den här filen skapas en tom spöktabell med policyer på. Skadan är skräp,
-- inte dataförlust — all kod pekar på det nya namnet — men båda filerna har fått en
-- SUPERSEDED-header i samma commit. Läs den innan du kör något gammalt.
--
-- DEPLOY-ORDNING: efter 20260811_time_permissions.sql och 20260811_time_reference_tables.sql
-- (FK:erna nedan pekar på referenstabellerna). Kör 20260811_time_entries_rls.sql direkt efter.
-- Idempotent. Kör i Supabase SQL-editorn.

-- ── 1. Namnbytet ─────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.crm_work_order_time_entries') is not null
     and to_regclass('public.crm_time_entries') is null then
    alter table public.crm_work_order_time_entries rename to crm_time_entries;
  end if;
end $$;

-- ── 2. Diskriminator + mål ───────────────────────────────────────────────────
-- Befintliga rader är alla arbetsordertid — de kunde inte vara något annat, work_order_id var
-- NOT NULL. Kolumnen får inget default: `kind` ska alltid sättas medvetet, och CHECK:en nedan
-- binder den ändå till vilket mål som är ifyllt.
alter table public.crm_time_entries add column if not exists kind text;
update public.crm_time_entries set kind = 'work_order' where kind is null;
alter table public.crm_time_entries alter column kind set not null;

alter table public.crm_time_entries add column if not exists internal_project_id uuid;
alter table public.crm_time_entries add column if not exists absence_type_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_time_entries_internal_project_fkey') then
    alter table public.crm_time_entries
      add constraint crm_time_entries_internal_project_fkey
      foreign key (internal_project_id) references public.crm_internal_projects(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_time_entries_absence_type_fkey') then
    alter table public.crm_time_entries
      add constraint crm_time_entries_absence_type_fkey
      foreign key (absence_type_id) references public.crm_absence_types(id) on delete restrict;
  end if;
end $$;

-- Frånvaro har ingen arbetsorder. Interntid heller.
alter table public.crm_time_entries alter column work_order_id drop not null;

-- ⚠️ CASCADE → RESTRICT. I dag försvinner tidrader när arbetsordern raderas. Ingen kodväg raderar
-- arbetsordrar (bara status 'cancelled'), så det är en sovande mina snarare än en aktiv bugg — men
-- i det ögonblick lönen bor här är en `delete` i Supabase-dashboarden lika med raderat löneunderlag.
-- `set null` går inte: det bryter mot CHECK:en nedan. Constraintnamnet är kvar från före namnbytet
-- (PostgreSQL döper inte om constraints när en tabell byter namn), därför båda varianterna.
alter table public.crm_time_entries drop constraint if exists crm_work_order_time_entries_work_order_id_fkey;
alter table public.crm_time_entries drop constraint if exists crm_time_entries_work_order_id_fkey;
alter table public.crm_time_entries
  add constraint crm_time_entries_work_order_id_fkey
  foreign key (work_order_id) references public.crm_work_orders(id) on delete restrict;

-- ── 3. Klockslag, rast och minuter ───────────────────────────────────────────
-- `time`, inte `timestamptz`: kollektivavtalet menar VÄGGKLOCKA. timestamptz + Europe/Stockholm gör
-- sommartidsnatten till 23 eller 25 timmar och tvingar varje läsare att komma ihåg konverteringen.
-- end_time <= start_time betyder att passet passerade midnatt — inget extra fält behövs.
alter table public.crm_time_entries add column if not exists start_time time;
alter table public.crm_time_entries add column if not exists end_time time;
alter table public.crm_time_entries add column if not exists break_minutes integer not null default 0;

-- Heltalsminuter är SANNINGEN; `hours` härleds. All matematik i minuter hela vägen till
-- presentationen: 0,01 h avrundningsfel × 25 rader × 12 personer × 12 månader blir timmar per år.
alter table public.crm_time_entries add column if not exists minutes_worked integer;

alter table public.crm_time_entries add column if not exists time_code_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_time_entries_time_code_fkey') then
    alter table public.crm_time_entries
      add constraint crm_time_entries_time_code_fkey
      foreign key (time_code_id) references public.crm_time_codes(id) on delete restrict;
  end if;
end $$;

-- ── 4. Resa ──────────────────────────────────────────────────────────────────
-- Kolumner, inte egen tabell: en resa hör till dagens jobb och 1:0..1 håller löneläsmodellen till en
-- enda scan. Priset, uttalat: två separata resor samma dag summeras till en.
--
-- Företagsbilsblocket från Blikks modal (mätarställning, adress start/mål/slut) följer INTE med —
-- korjournal_trips + lib/domains/korjournal är redan den riktiga körjournalen, och två halvdåliga
-- körjournaler är sämre än en. Beslutet är dessutom bara km + "till lön": ingen sats, inget belopp.
alter table public.crm_time_entries add column if not exists travel_km numeric(7,1);
alter table public.crm_time_entries add column if not exists travel_km_billable numeric(7,1);
alter table public.crm_time_entries add column if not exists travel_to_salary boolean not null default false;
alter table public.crm_time_entries add column if not exists travel_note text;

-- ── 5. Härkomst ──────────────────────────────────────────────────────────────
-- Kolumnen ADDAS med default 'legacy_office' så befintliga rader (kontorsflikens uppföljningstid,
-- utan klockslag) märks korrekt, och defaulten flyttas sedan till 'crm' för allt nytt. Det är
-- avsiktligt gjort i två steg i stället för en UPDATE med gissad WHERE-sats: en omkörning kan då
-- aldrig råka märka om riktiga tidrader.
alter table public.crm_time_entries add column if not exists source text not null default 'legacy_office';
alter table public.crm_time_entries alter column source set default 'crm';

-- ── 6. Constraints ───────────────────────────────────────────────────────────
-- Exakt ett mål — Blikks idCount-regel, som i dag bara finns i en route
-- (app/api/blikk/time-reports/route.ts) och alltså inte gäller något annat anrop. Formen binder
-- `kind` till målet, så diskriminatorn kan aldrig ljuga om datat.
--
-- NOT VALID är nyckeln: regeln tvingas på alla NYA och ÄNDRADE rader men lämnar de befintliga
-- kontorsraderna ifred. De är giltiga ändå (alla har work_order_id och kind='work_order'), men
-- NOT VALID gör migreringen ögonblicklig och riskfri även om någon rad skulle avvika.
alter table public.crm_time_entries drop constraint if exists crm_time_entries_target_check;
alter table public.crm_time_entries add constraint crm_time_entries_target_check check (
  (kind = 'work_order' and work_order_id is not null and internal_project_id is null and absence_type_id is null)
  or (kind = 'internal' and internal_project_id is not null and work_order_id is null and absence_type_id is null)
  or (kind = 'absence'  and absence_type_id is not null and work_order_id is null and internal_project_id is null)
) not valid;

alter table public.crm_time_entries drop constraint if exists crm_time_entries_minutes_check;
alter table public.crm_time_entries add constraint crm_time_entries_minutes_check check (
  minutes_worked is null or (minutes_worked > 0 and minutes_worked <= 1440)
) not valid;

alter table public.crm_time_entries drop constraint if exists crm_time_entries_break_check;
alter table public.crm_time_entries add constraint crm_time_entries_break_check check (
  break_minutes >= 0 and break_minutes < 1440
) not valid;

-- ⚠️ KLOCKSLAGSKRAVET LIGGER MEDVETET INTE HÄR — det hör till fas 4.6.
-- Kontorets Tid-flik (app/crm/arbetsorder/WorkOrderTimeTab.tsx) skriver fortfarande rader med bara
-- datum + timmar. Ett krav på start_time/end_time nu hade fått den att sluta fungera mitt i fasen,
-- vilket bryter mot att varje steg ska vara deploybart för sig. När fliken blivit läsbar och all
-- inmatning går genom det nya formuläret läggs det på, färdigskrivet:
--
--   alter table public.crm_time_entries add constraint crm_time_entries_clock_check check (
--     source <> 'crm' or kind = 'absence'
--     or (start_time is not null and end_time is not null and minutes_worked is not null)
--   ) not valid;
--
-- ⚠️ `kind = 'absence'` i undantaget är inte slarv: lönebyrån vill ha frånvaro i TIMMAR
-- ("Frånvarotimmar" i hennes layout), inte som ett pass med start och slut. En halv dag VAB är fyra
-- timmar, inte 08:00–12:00. Arbetstid däremot måste ha klockslag — hon härleder övertidsersättningen
-- ur dem.
--
-- Fram till dess är domänlagret (lib/domains/time) enda garanten för att nya arbetsrader har
-- klockslag.

-- ── 7. hours härleds ur minuterna ────────────────────────────────────────────
-- Klienten räknar timmarna i dag och servern litar på den (components/dashboard/TimeReportModal.tsx
-- skickar totalHours). Här räknas de om oavsett vad som skickas in. `hours` behålls för kontorets
-- Tid-flik och de gamla raderna; den skrivs bara när minuter finns, så en legacy-rad som sätter
-- hours direkt fungerar oförändrat.
--
-- Trigger, inte generated column: en generated column kräver drop+add av en befintlig NOT NULL-kolumn
-- och hade nollat legacy-värdena på vägen.
create or replace function public.set_crm_time_entry_hours()
returns trigger
language plpgsql
as $$
begin
  if new.minutes_worked is not null then
    new.hours = round(new.minutes_worked::numeric / 60, 2);
  end if;
  return new;
end;
$$;

drop trigger if exists set_crm_time_entry_hours on public.crm_time_entries;
create trigger set_crm_time_entry_hours
before insert or update on public.crm_time_entries
for each row execute procedure public.set_crm_time_entry_hours();

-- ── Verifiering (kör efter applicering) ──────────────────────────────────────
-- Kolumner och nullbarhet:
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns where table_name = 'crm_time_entries' order by ordinal_position;
--
-- Befintliga rader ska vara oförändrade utom kind='work_order' och source='legacy_office':
--   select kind, source, count(*), count(start_time) as med_klockslag from public.crm_time_entries
--   group by kind, source;
--
-- FK:n ska vara RESTRICT, inte CASCADE:
--   select conname, confdeltype from pg_constraint
--   where conrelid = 'public.crm_time_entries'::regclass and contype = 'f';
--   -- confdeltype: 'r' = restrict, 'c' = cascade, 'a' = no action
--
-- Triggern ska räkna om timmarna (rulla tillbaka, det här är bara ett prov):
--   begin;
--     update public.crm_time_entries set minutes_worked = 510 where id = (select id from public.crm_time_entries limit 1);
--     select minutes_worked, hours from public.crm_time_entries where minutes_worked = 510;  -- 510 → 8.50
--   rollback;
