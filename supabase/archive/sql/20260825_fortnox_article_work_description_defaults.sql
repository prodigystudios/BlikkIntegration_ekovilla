-- Artiklar som normalt hör hemma i arbetsbeskrivningen.
--
-- Arbetsbeskrivningen (måttblocket i internal_handoff.handoff_notes) listade förut bara m3-rader
-- med yta och tjocklek — vägg, vind, snedtak. Moment som säljs per antal eller meter (brandmatta,
-- sarg runt lucka) syntes aldrig, trots att installatören ska utföra dem.
--
-- Men alla antalsrader hör inte dit: vindduk lämnas ofta till kunden i förväg och installatören
-- utför inget moment för den. Står den i beskrivningen läses den som ett arbetsmoment som inte
-- finns. Därför är det ett aktivt val per rad, och den här tabellen bär bara STANDARDVALET per
-- artikel så säljaren slipper ta ställning på nytt i varje offert.
--
-- Närvaro i tabellen = "ta normalt med i arbetsbeskrivningen". Frånvaro = nej. Samma set-modell
-- som fortnox_article_favorites, och av samma skäl:
--
-- Egen tabell, INTE en kolumn på fortnox_articles_cache, så flaggan överlever varje omsynk från
-- Fortnox. Läsningen går via service-role-klienten (listCachedFortnoxArticles), så RLS här gatar
-- i praktiken skrivningarna.
--
-- Standarden läses BARA när en offertrad skapas och persisteras sedan på raden
-- (line_items[].include_in_description). Den appliceras aldrig retroaktivt: måttblockets utdata
-- jämförs byte för byte mot redan sparade offerter (adoptExistingMeasurementBlock), och en
-- retroaktiv flagga hade låst varje befintlig offert på inaktuella mått.
--
-- DEPLOY ORDER: kör FÖRE koden. listCachedFortnoxArticles läser tabellen, och PostgREST svarar
-- 400 - inte tomt - på en saknad relation. Idempotent.

create table if not exists public.fortnox_article_work_description_defaults (
  article_number text primary key,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id) on delete set null
);

alter table public.fortnox_article_work_description_defaults enable row level security;
grant select, insert, delete on public.fortnox_article_work_description_defaults to authenticated;

-- Any CRM user may read the defaults; CRM writers (sales/admin, not konsult) toggle them.
drop policy if exists fortnox_article_work_description_defaults_select on public.fortnox_article_work_description_defaults;
create policy fortnox_article_work_description_defaults_select on public.fortnox_article_work_description_defaults
  for select to authenticated
  using (public.has_permission('crm.access'));

drop policy if exists fortnox_article_work_description_defaults_insert on public.fortnox_article_work_description_defaults;
create policy fortnox_article_work_description_defaults_insert on public.fortnox_article_work_description_defaults
  for insert to authenticated
  with check (public.has_permission('crm.write'));

drop policy if exists fortnox_article_work_description_defaults_delete on public.fortnox_article_work_description_defaults;
create policy fortnox_article_work_description_defaults_delete on public.fortnox_article_work_description_defaults
  for delete to authenticated
  using (public.has_permission('crm.write'));
