-- Tid & lön (fas 4) — referensdata: tidkoder, internprojekt, frånvarotyper.
--
-- Fas 4.1. Idag bor de här listorna i BLIKK och hämtas live vid varje modalöppning
-- (/v1/Admin/Timecodes, /v1/Admin/InternalProjects, /v1/Admin/AbsenceProjects). Kopplas Blikk bort
-- försvinner de — därför egna tabeller, med en engångsimport av dagens innehåll och admin som
-- underhåller dem efteråt.
--
-- ADDITIVT. Inget befintligt rörs; `blikk_timecodes` / `blikk_activities` (24h-cachen i
-- lib/blikkCache.ts) lever kvar tills fas 4.7 städar bort dem.
--
-- DEPLOY-ORDNING: efter 20260811_time_permissions.sql (RLS:en anropar has_permission på
-- time.reference.manage). Idempotent. Kör i Supabase SQL-editorn.
--
-- AKTIVITET UTGÅR MEDVETET. Blikks fjärde lista (aktivitet: "Lösullsentrepenad"/"Intern") får ingen
-- tabell: den har ingen konsument efter Blikk — faktureringen går via Fortnox och artikelraderna —
-- och dagens modal tvingar redan fram värdet genom namnmatchning, vilket är själva symptomet på att
-- ingen läser det. Att lägga till den senare är additivt.

-- ── Delad updated_at-trigger ─────────────────────────────────────────────────
-- Repot har annars en trigger-funktion per tabell (set_timestamp_crm_prospects, …). Här är det tre
-- syskontabeller med identisk form, så en delad funktion i stället för tre kopior.
create or replace function public.set_timestamp_time_reference()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── Tidkoder ─────────────────────────────────────────────────────────────────
create table if not exists public.crm_time_codes (
  id            uuid primary key default gen_random_uuid(),
  code          text,
  name          text not null,
  -- Lönesorten byrån räknar på. FRITEXT med flit: vi vet inte vad byrån kallar sina lönearter, och
  -- ingen sats, inget belopp och ingen regel får bo i koden. Admin fyller i den efter importen.
  payroll_code  text,
  billable      boolean,
  requires_note boolean not null default false,
  sort_index    integer not null default 0,
  is_active     boolean not null default true,
  -- Behålls för alltid, inte bara under importen: det är spårbarheten som svarar på "varför ser
  -- mars annorlunda ut" när byrån frågar efter att Blikk är borta.
  blikk_id      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- Icke-partiellt med flit: PostgREST kan inte uttrycka ett partiellt index predikat i sin
-- on-conflict-inferens, så en `upsert(..., { onConflict: 'blikk_id' })` skulle misslyckas. NULL
-- räknas ändå som distinkt i ett unikt index, så handpålagda rader utan Blikk-ursprung går bra.
create unique index if not exists crm_time_codes_blikk_id_uniq on public.crm_time_codes (blikk_id);
create index if not exists crm_time_codes_active_idx on public.crm_time_codes (is_active, sort_index, name);

-- ── Internprojekt ────────────────────────────────────────────────────────────
create table if not exists public.crm_internal_projects (
  id            uuid primary key default gen_random_uuid(),
  code          text,
  name          text not null,
  payroll_code  text,
  -- Blikks commentRequiredWhenTimeReporting: tvingar fram en beskrivning i formuläret.
  requires_note boolean not null default false,
  sort_index    integer not null default 0,
  is_active     boolean not null default true,
  blikk_id      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists crm_internal_projects_blikk_id_uniq on public.crm_internal_projects (blikk_id);
create index if not exists crm_internal_projects_active_idx on public.crm_internal_projects (is_active, sort_index, name);

-- ── Frånvarotyper ────────────────────────────────────────────────────────────
create table if not exists public.crm_absence_types (
  id            uuid primary key default gen_random_uuid(),
  code          text,
  name          text not null,
  payroll_code  text,
  requires_note boolean not null default false,
  sort_index    integer not null default 0,
  is_active     boolean not null default true,
  blikk_id      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists crm_absence_types_blikk_id_uniq on public.crm_absence_types (blikk_id);
create index if not exists crm_absence_types_active_idx on public.crm_absence_types (is_active, sort_index, name);

-- ── Triggers ─────────────────────────────────────────────────────────────────
drop trigger if exists set_timestamp_crm_time_codes on public.crm_time_codes;
create trigger set_timestamp_crm_time_codes
before update on public.crm_time_codes
for each row execute procedure public.set_timestamp_time_reference();

drop trigger if exists set_timestamp_crm_internal_projects on public.crm_internal_projects;
create trigger set_timestamp_crm_internal_projects
before update on public.crm_internal_projects
for each row execute procedure public.set_timestamp_time_reference();

drop trigger if exists set_timestamp_crm_absence_types on public.crm_absence_types;
create trigger set_timestamp_crm_absence_types
before update on public.crm_absence_types
for each row execute procedure public.set_timestamp_time_reference();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Läsning är öppen för alla inloggade: varje anställd ska kunna välja frånvarotyp i formuläret, och
-- listorna är inte hemliga (namnen stod redan i Blikks dropdown för alla). Skrivning kräver
-- time.reference.manage (bara admin).
--
-- INGEN radering exponeras. Historiken får aldrig tappa sin lönesort — inaktivera i stället
-- (is_active = false), då försvinner raden ur formuläret men finns kvar bakom gamla tidrader. Från
-- och med fas 4.2 backas det dessutom av FK:er med `restrict`.
alter table public.crm_time_codes        enable row level security;
alter table public.crm_internal_projects enable row level security;
alter table public.crm_absence_types     enable row level security;

grant select, insert, update on public.crm_time_codes        to authenticated;
grant select, insert, update on public.crm_internal_projects to authenticated;
grant select, insert, update on public.crm_absence_types     to authenticated;

drop policy if exists crm_time_codes_select on public.crm_time_codes;
create policy crm_time_codes_select on public.crm_time_codes
  for select to authenticated using (true);

drop policy if exists crm_time_codes_insert on public.crm_time_codes;
create policy crm_time_codes_insert on public.crm_time_codes
  for insert to authenticated with check (public.has_permission('time.reference.manage'));

drop policy if exists crm_time_codes_update on public.crm_time_codes;
create policy crm_time_codes_update on public.crm_time_codes
  for update to authenticated
  using (public.has_permission('time.reference.manage'))
  with check (public.has_permission('time.reference.manage'));

drop policy if exists crm_internal_projects_select on public.crm_internal_projects;
create policy crm_internal_projects_select on public.crm_internal_projects
  for select to authenticated using (true);

drop policy if exists crm_internal_projects_insert on public.crm_internal_projects;
create policy crm_internal_projects_insert on public.crm_internal_projects
  for insert to authenticated with check (public.has_permission('time.reference.manage'));

drop policy if exists crm_internal_projects_update on public.crm_internal_projects;
create policy crm_internal_projects_update on public.crm_internal_projects
  for update to authenticated
  using (public.has_permission('time.reference.manage'))
  with check (public.has_permission('time.reference.manage'));

drop policy if exists crm_absence_types_select on public.crm_absence_types;
create policy crm_absence_types_select on public.crm_absence_types
  for select to authenticated using (true);

drop policy if exists crm_absence_types_insert on public.crm_absence_types;
create policy crm_absence_types_insert on public.crm_absence_types
  for insert to authenticated with check (public.has_permission('time.reference.manage'));

drop policy if exists crm_absence_types_update on public.crm_absence_types;
create policy crm_absence_types_update on public.crm_absence_types
  for update to authenticated
  using (public.has_permission('time.reference.manage'))
  with check (public.has_permission('time.reference.manage'));

-- ── Verifiering (kör efter applicering) ──────────────────────────────────────
--   select tablename, policyname, cmd from pg_policies
--   where schemaname='public' and tablename in ('crm_time_codes','crm_internal_projects','crm_absence_types')
--   order by tablename, cmd;
--
-- Efter importen (Admin → Tidkoder → "Importera från Blikk"): kontrollera att inget saknar
-- lönesort innan fas 4.5 kör skarpt underlag.
--   select 'tidkod' as typ, name, payroll_code from public.crm_time_codes where is_active and payroll_code is null
--   union all select 'internprojekt', name, payroll_code from public.crm_internal_projects where is_active and payroll_code is null
--   union all select 'frånvaro', name, payroll_code from public.crm_absence_types where is_active and payroll_code is null;
