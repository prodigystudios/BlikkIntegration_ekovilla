-- Global article favorites — a small, SHARED (not per-user) set of Fortnox articles that float to
-- the top of every article list/picker. 99% of sellers use the same handful of articles daily
-- while the cache holds many rarely-used ones, so one shared favorites set (curated by any CRM
-- writer) keeps the common ones one glance away.
--
-- Kept in its OWN table (not a column on fortnox_articles_cache) so it survives every cache
-- re-sync from Fortnox. Reads go through the service-role client (listCachedFortnoxArticles), so
-- RLS here mainly gates the toggle writes.
--
-- DEPLOY ORDER: run after the permissions model (uses has_permission). Idempotent.

create table if not exists public.fortnox_article_favorites (
  article_number text primary key,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id) on delete set null
);

alter table public.fortnox_article_favorites enable row level security;
grant select, insert, delete on public.fortnox_article_favorites to authenticated;

-- Any CRM user may read the favorites; CRM writers (sales/admin, not konsult) toggle them.
drop policy if exists fortnox_article_favorites_select on public.fortnox_article_favorites;
create policy fortnox_article_favorites_select on public.fortnox_article_favorites
  for select to authenticated
  using (public.has_permission('crm.access'));

drop policy if exists fortnox_article_favorites_insert on public.fortnox_article_favorites;
create policy fortnox_article_favorites_insert on public.fortnox_article_favorites
  for insert to authenticated
  with check (public.has_permission('crm.write'));

drop policy if exists fortnox_article_favorites_delete on public.fortnox_article_favorites;
create policy fortnox_article_favorites_delete on public.fortnox_article_favorites
  for delete to authenticated
  using (public.has_permission('crm.write'));
