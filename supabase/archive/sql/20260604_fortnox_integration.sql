-- Fortnox integration: OAuth token storage and article cache

-- Token storage (one row per provider, i.e. one Fortnox connection)
create table if not exists public.fortnox_integrations (
  id             uuid        primary key default gen_random_uuid(),
  provider       text        not null default 'fortnox',
  access_token   text        not null,
  refresh_token  text        not null,
  expires_at     timestamptz not null,
  scope          text,
  connected_by   uuid        references auth.users(id) on delete set null,
  connected_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint fortnox_integrations_provider_unique unique (provider)
);

-- Tokens are sensitive: only service role writes; admins can read via RLS
alter table public.fortnox_integrations enable row level security;

create policy "Admins can read fortnox_integrations"
  on public.fortnox_integrations for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Article cache populated by sync jobs (service role)
create table if not exists public.fortnox_articles_cache (
  article_number  text        primary key,
  description     text,
  sales_price     numeric,
  purchase_price  numeric,
  unit            text,
  article_type    text,
  active          boolean     not null default true,
  raw             jsonb,
  last_fetched_at timestamptz not null default now()
);

alter table public.fortnox_articles_cache enable row level security;

create policy "CRM users can read fortnox_articles_cache"
  on public.fortnox_articles_cache for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('sales', 'admin')
    )
  );

-- Index for article lookup by number
create index if not exists fortnox_articles_cache_active_idx
  on public.fortnox_articles_cache (active, article_number);
