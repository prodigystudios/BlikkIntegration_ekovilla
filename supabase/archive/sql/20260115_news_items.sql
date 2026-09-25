-- News items shown to users on dashboard (modal shows once per item via localStorage)

create table if not exists public.news_items (
  id uuid primary key default gen_random_uuid(),
  headline text not null,
  body text not null,
  image_url text null,
  created_at timestamptz not null default now(),
  created_by uuid null
);

alter table public.news_items enable row level security;

-- All authenticated users can read
drop policy if exists news_items_select_all on public.news_items;
create policy news_items_select_all on public.news_items
  for select using (auth.role() = 'authenticated');

-- Only admins can write
drop policy if exists news_items_admin_mod on public.news_items;
create policy news_items_admin_mod on public.news_items
  for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create index if not exists news_items_created_at_idx on public.news_items(created_at desc);
