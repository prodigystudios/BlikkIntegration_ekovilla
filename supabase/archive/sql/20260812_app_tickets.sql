-- Appärenden (ticket-/supportsystem för APPEN: buggar + funktionsönskemål).
--
-- VARFÖR EN EGEN DOMÄN OCH INTE FELANMÄLAN. `fault_reports` handlar om företagets fysiska grejer
-- (truck, lastbil, isoleringsmaskin) och fan-outar till en admin-hanterad lista arbetsledare. Det
-- här handlar om appen, och mottagaren är EN person: utvecklaren. Merparten av
-- felanmälningsdomänen — recipients-tabellen, e-postutskicken, fan-out-maskineriet — hade alltså
-- varit dödvikt här. Värdet ligger i att ärendena blir en BESTÄNDIG BACKLOG som går att följa upp,
-- inte i utskick. Modellen nedan är byggd för det: status, vad som är kvar, vad som är gjort.
--
-- DEPLOY-ORDNING: helt ADDITIV (ny tabell, ny funktion, inga ändringar på befintliga objekt), så
-- ordningen mellan SQL och kod spelar ingen roll. Körs SQL:en efter koden svarar routen 500 tills
-- tabellen finns — inget läses fel, ingenting skrivs sönder. Kör i Supabase SQL editor. Idempotent.
--
-- ADMIN-GRINDEN: rollbaserad (`profiles.role = 'admin'`), inte en ny permission-nyckel. Skälet är
-- att backloggen bor under `/admin`, och den ytan är rollgatad i hela appen (se app/admin/page.tsx
-- och fault_report_recipients-policyerna). PERMISSIONS.md håller RBAC till CRM/Fortnox/tid/planering
-- och säger uttryckligen att adminytorna migreras senare — då flyttar den här med, på ett ställe.

-- ---------------------------------------------------------------------------
-- Admin-predikat
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER så policyerna kan läsa `profiles` utan att gå via dess egen RLS (och utan
-- rekursion), STABLE så den beräknas ~en gång per query i stället för en gång per rad. Samma
-- mönster som is_fault_report_recipient() och has_permission().
create or replace function public.is_app_ticket_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;
grant execute on function public.is_app_ticket_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Ärenden
-- ---------------------------------------------------------------------------

create table if not exists public.app_tickets (
  id             uuid primary key default gen_random_uuid(),

  -- Nullable för att matcha ON DELETE SET NULL (en NOT NULL-kolumn + SET NULL avbryter
  -- profilraderingen). reporter_name är den beständiga visningskopian: `profiles` är self-read-only,
  -- så admin kan inte läsa om rapportörens namn i efterhand. Samma resonemang som fault_reports.
  reporter_id    uuid references public.profiles(id) on delete set null,
  reporter_name  text not null,

  -- 'bug' = något är trasigt, 'idea' = önskemål. Grundskillnaden i backloggen.
  kind           text not null,
  -- Vilken del av appen det gäller. Rapportören väljer; page_path fylls automatiskt.
  area           text not null,
  -- Kort etikett så backloggen går att skanna, + hela beskrivningen.
  title          text not null,
  description    text not null,
  -- Sidan användaren stod på när hen tryckte Rapportera (t.ex. "/crm/arbetsorder/<uuid>"). Fylls av
  -- klienten, inte av användaren — det är oftast mer exakt än vald area.
  page_path      text,

  status         text not null default 'new',
  -- Vad som gjordes / varför det inte blir av. Syns för rapportören, så hen slutar fråga.
  resolution     text,

  -- Skärmbild. Bucket sparas per rad (som documents_files) så en framtida bucketflytt inte gör
  -- gamla rader olästbara. Filen ligger under prefixet Support/ i den befintliga bucketen —
  -- ingen ny bucket, inga nya storage-policyer: läsning sker alltid via en signerad URL som
  -- servern skapar med service-role-nyckeln, efter att den gatat på RLS-villkoren nedan.
  screenshot_bucket text,
  screenshot_path   text,

  -- FÖRBEREDER CHANGELOGGEN (nästa bygg). Ett stängt ärende kan publiceras som en changelog-rad:
  -- changelog_note är den publika texten, changelog_published_at att den är ute. Changelog-vyn
  -- läser härifrån och kan sedan unionas med handskrivna poster i sin egen tabell — därför ligger
  -- bara de två kolumnerna här, inga antaganden om changeloggens schema.
  changelog_note         text,
  changelog_published_at timestamptz,

  handled_by     uuid references public.profiles(id) on delete set null,
  handled_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint app_tickets_kind_chk   check (kind in ('bug', 'idea')),
  constraint app_tickets_status_chk check (status in ('new', 'planned', 'in_progress', 'done', 'declined')),
  constraint app_tickets_area_chk   check (area in (
    'crm', 'planning', 'field', 'self_check', 'time', 'documents', 'korjournal', 'account', 'other'
  )),
  -- Bucket och path hör ihop: antingen finns båda eller ingen. Utan detta kan en halv referens
  -- uppstå och läsningen får gissa vilken bucket som gällde.
  constraint app_tickets_screenshot_chk check (
    (screenshot_bucket is null and screenshot_path is null)
    or (screenshot_bucket is not null and screenshot_path is not null)
  )
);

create index if not exists app_tickets_reporter_idx on public.app_tickets (reporter_id, created_at desc);
create index if not exists app_tickets_status_idx   on public.app_tickets (status, created_at desc);
-- Partiellt: changeloggen läser bara publicerade rader, och de är en liten delmängd.
create index if not exists app_tickets_changelog_idx
  on public.app_tickets (changelog_published_at desc)
  where changelog_published_at is not null;

alter table public.app_tickets enable row level security;
grant select, insert, update on public.app_tickets to authenticated;

-- Alla inloggade rapporterar, men bara som sig själva.
drop policy if exists app_tickets_insert on public.app_tickets;
create policy app_tickets_insert on public.app_tickets
  for insert to authenticated
  with check (reporter_id = auth.uid());

-- Rapportören ser sina egna, admin ser alla.
drop policy if exists app_tickets_select on public.app_tickets;
create policy app_tickets_select on public.app_tickets
  for select to authenticated
  using (reporter_id = auth.uid() or public.is_app_ticket_admin());

-- Bara admin ändrar status/svar/changelog. Rapportören kan INTE redigera sitt ärende i efterhand —
-- backloggen ska inte kunna ändras under fötterna på den som håller i den. Matchande SELECT-policy
-- finns ovan (UPDATE ⇒ SELECT-regeln).
drop policy if exists app_tickets_update on public.app_tickets;
create policy app_tickets_update on public.app_tickets
  for update to authenticated
  using (public.is_app_ticket_admin())
  with check (public.is_app_ticket_admin());

-- ── Verifiering (kör efter applicering) ──────────────────────────────────────
--
-- 1. Policyerna ska vara tre, och funktionen ska svara.
--
--      select policyname, cmd from pg_policies
--      where schemaname = 'public' and tablename = 'app_tickets' order by policyname;
--
--      select public.is_app_ticket_admin();   -- true för dig, false för en installatör
--
-- 2. Constraint-listan ska innehålla alla fyra checkarna.
--
--      select conname from pg_constraint
--      where conrelid = 'public.app_tickets'::regclass and contype = 'c' order by conname;
--
-- 3. Halv skärmbildsreferens ska nekas (förväntat: fel om app_tickets_screenshot_chk).
--
--      insert into public.app_tickets (reporter_id, reporter_name, kind, area, title, description, screenshot_bucket)
--      values (auth.uid(), 'Test', 'bug', 'crm', 'x', 'y', 'pdfs');
