-- Offertkalkylator: spara/ladda användarens kalkyler

create extension if not exists pgcrypto;

create table if not exists public.offert_calculations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  payload jsonb not null,
  subtotal numeric(12,2) not null default 0,
  total_before_rot numeric(12,2) not null default 0,
  rot_amount numeric(12,2) not null default 0,
  total_after_rot numeric(12,2) not null default 0
);

create index if not exists offert_calculations_user_id_created_at_idx
  on public.offert_calculations (user_id, created_at desc);

alter table public.offert_calculations enable row level security;

drop policy if exists "offert_calculations_select_own" on public.offert_calculations;
create policy "offert_calculations_select_own"
  on public.offert_calculations
  for select
  using (auth.uid() = user_id);

drop policy if exists "offert_calculations_insert_own" on public.offert_calculations;
create policy "offert_calculations_insert_own"
  on public.offert_calculations
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "offert_calculations_update_own" on public.offert_calculations;
create policy "offert_calculations_update_own"
  on public.offert_calculations
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "offert_calculations_delete_own" on public.offert_calculations;
create policy "offert_calculations_delete_own"
  on public.offert_calculations
  for delete
  using (auth.uid() = user_id);
