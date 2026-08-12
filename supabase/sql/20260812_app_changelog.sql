-- Changelog: vad som fixats, tillkommit och förbättrats i appen.
--
-- PROBLEMET DEN LÖSER: ändringar går ut utan att någon vet om dem. Fyra PR:er 2026-08-12 ändrade hur
-- ordern beter sig och inget av det syntes för användarna.
--
-- TVÅ KÄLLOR, EN LISTA. Den här tabellen håller FRITT SKRIVNA poster. Publicerade appärenden
-- (`app_tickets.changelog_note` + `changelog_published_at`) är den andra källan och bor kvar där —
-- ett stängt ärende ÄR redan posten, och att kopiera texten hit hade skapat två sanningar som kan
-- glida isär. Sammanslagningen sker i läsningen (lib/domains/changelog/merge.ts), inte i databasen.
--
-- Varför fria poster alls: de flesta ändringar kommer inte från ett rapporterat ärende. Utan dem
-- blir loggen missvisande gles och ser ut som att nästan inget händer.
--
-- DEPLOY-ORDNING: helt ADDITIV (ny tabell, inget befintligt ändras), så ordningen SQL/kod spelar
-- ingen roll. Körs SQL:en efter koden svarar changelog-routen 500 tills tabellen finns; ingenting
-- annat påverkas och inget läses fel. Kör i Supabase SQL editor. Idempotent.

create table if not exists public.app_changelog_entries (
  id           uuid primary key default gen_random_uuid(),

  -- 'fixed' = något som var trasigt fungerar nu, 'new' = något som inte fanns, 'improved' = något
  -- som fanns men blev bättre. Samma tre som ärendena mappas till (bug→fixed, idea→new), så en
  -- läsare inte behöver veta vilken källa raden kom ifrån.
  category     text not null,
  title        text not null,
  -- Valfri utveckling under rubriken. En changelog-post ska gå att läsa på en rad; body är för de
  -- gånger raden inte räcker.
  body         text,

  -- NULL = utkast, syns inte för någon. Sätts när posten publiceras, och är sorteringsnyckeln —
  -- inte created_at, så en post kan skrivas i förväg och dateras när den faktiskt gick ut.
  published_at timestamptz,

  -- Beständig visningskopia: `profiles` är self-read-only, så namnet går inte att läsa upp senare.
  created_by      uuid references public.profiles(id) on delete set null,
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint app_changelog_category_chk check (category in ('fixed', 'new', 'improved')),
  constraint app_changelog_title_chk    check (length(btrim(title)) > 0)
);

-- Listan läses alltid publicerat-först. Partiellt index: utkasten är få och läses bara av admin.
create index if not exists app_changelog_published_idx
  on public.app_changelog_entries (published_at desc)
  where published_at is not null;

alter table public.app_changelog_entries enable row level security;
grant select, insert, update, delete on public.app_changelog_entries to authenticated;

-- Alla inloggade läser PUBLICERADE poster. Utkast ser bara admin — annars läcker en halvfärdig
-- formulering ut till hela företaget.
drop policy if exists app_changelog_select on public.app_changelog_entries;
create policy app_changelog_select on public.app_changelog_entries
  for select to authenticated
  using (published_at is not null or public.is_app_ticket_admin());

-- Bara admin skriver. Återanvänder predikatet från appärendena med flit: det är samma person som
-- håller i backloggen och skriver changeloggen, och två predikat hade kunnat glida isär.
drop policy if exists app_changelog_write on public.app_changelog_entries;
create policy app_changelog_write on public.app_changelog_entries
  for all to authenticated
  using (public.is_app_ticket_admin())
  with check (public.is_app_ticket_admin());

-- ── Verifiering (kör efter applicering) ──────────────────────────────────────
--
-- 1. Två policyer, och skrivpolicyn ska gälla alla kommandon.
--
--      select policyname, cmd from pg_policies
--      where schemaname = 'public' and tablename = 'app_changelog_entries' order by policyname;
--
-- 2. Tom titel ska nekas (förväntat: fel om app_changelog_title_chk).
--
--      insert into public.app_changelog_entries (category, title, created_by_name)
--      values ('fixed', '   ', 'Test');
--
-- 3. Okänd kategori ska nekas (förväntat: fel om app_changelog_category_chk).
--
--      insert into public.app_changelog_entries (category, title, created_by_name)
--      values ('breaking', 'x', 'Test');
--
-- 4. Så här ser den sammanslagna listan ut i SQL — samma två källor som koden slår ihop.
--    Bra att köra en gång efter första publiceringen, så du ser att båda vägarna landar rätt.
--
--      select 'entry' as kalla, category, title, published_at
--      from public.app_changelog_entries where published_at is not null
--      union all
--      select 'ticket', case when kind = 'bug' then 'fixed' else 'new' end, changelog_note, changelog_published_at
--      from public.app_tickets where changelog_published_at is not null
--      order by published_at desc;
