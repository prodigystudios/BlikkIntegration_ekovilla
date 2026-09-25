create extension if not exists pgcrypto;

create table if not exists public.document_publications (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.documents_files(id) on delete cascade,
  title text not null,
  description text,
  version_label text,
  due_at timestamptz,
  requires_approval boolean not null default true,
  published_by uuid references public.profiles(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_publications_file_idx on public.document_publications(file_id, created_at desc);
create index if not exists document_publications_active_idx on public.document_publications(archived_at, due_at);

create table if not exists public.document_publication_recipients (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.document_publications(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  source_type text not null default 'user' check (source_type in ('user', 'tag')),
  source_value text,
  created_at timestamptz not null default now(),
  unique (publication_id, recipient_user_id)
);

create index if not exists document_publication_recipients_publication_idx on public.document_publication_recipients(publication_id);
create index if not exists document_publication_recipients_user_idx on public.document_publication_recipients(recipient_user_id, created_at desc);

create table if not exists public.document_publication_receipts (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.document_publications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  approved_at timestamptz,
  approval_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (publication_id, user_id)
);

create index if not exists document_publication_receipts_user_idx on public.document_publication_receipts(user_id, updated_at desc);
create index if not exists document_publication_receipts_publication_idx on public.document_publication_receipts(publication_id);

create or replace function public.set_updated_at_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists document_publications_set_updated_at on public.document_publications;
create trigger document_publications_set_updated_at
before update on public.document_publications
for each row execute function public.set_updated_at_timestamp();

drop trigger if exists document_publication_receipts_set_updated_at on public.document_publication_receipts;
create trigger document_publication_receipts_set_updated_at
before update on public.document_publication_receipts
for each row execute function public.set_updated_at_timestamp();

alter table public.document_publications enable row level security;
alter table public.document_publication_recipients enable row level security;
alter table public.document_publication_receipts enable row level security;

drop policy if exists document_publications_select on public.document_publications;
create policy document_publications_select on public.document_publications
for select using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
  or exists (
    select 1
    from public.document_publication_recipients r
    where r.publication_id = document_publications.id
      and r.recipient_user_id = auth.uid()
  )
);

drop policy if exists document_publications_admin_write on public.document_publications;
create policy document_publications_admin_write on public.document_publications
for all using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists document_publication_recipients_select on public.document_publication_recipients;
create policy document_publication_recipients_select on public.document_publication_recipients
for select using (
  recipient_user_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists document_publication_recipients_admin_write on public.document_publication_recipients;
create policy document_publication_recipients_admin_write on public.document_publication_recipients
for all using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists document_publication_receipts_select on public.document_publication_receipts;
create policy document_publication_receipts_select on public.document_publication_receipts
for select using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists document_publication_receipts_insert on public.document_publication_receipts;
create policy document_publication_receipts_insert on public.document_publication_receipts
for insert with check (
  (
    user_id = auth.uid()
    and exists (
      select 1
      from public.document_publication_recipients r
      where r.publication_id = document_publication_receipts.publication_id
        and r.recipient_user_id = auth.uid()
    )
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

drop policy if exists document_publication_receipts_update on public.document_publication_receipts;
create policy document_publication_receipts_update on public.document_publication_receipts
for update using (
  (
    user_id = auth.uid()
    and exists (
      select 1
      from public.document_publication_recipients r
      where r.publication_id = document_publication_receipts.publication_id
        and r.recipient_user_id = auth.uid()
    )
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  (
    user_id = auth.uid()
    and exists (
      select 1
      from public.document_publication_recipients r
      where r.publication_id = document_publication_receipts.publication_id
        and r.recipient_user_id = auth.uid()
    )
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);