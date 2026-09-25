-- Material quality samples captured from Egenkontroll (internal analytics)
-- One row per etapp (open/closed) per saved inspection when batch/density info exists.
-- Run this in your Supabase SQL editor.

create table if not exists public.material_quality_samples (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid null, -- optional (if auth added to main form later)
  order_id text null,
  project_number text null,
  installation_date date null,
  material_used text null,
  batch_number text null,
  fluffer_used boolean null, -- whether fluffer was used (captured from form checkbox)
  dammighet int2 null check (dammighet between 1 and 10),
  klumpighet int2 null check (klumpighet between 1 and 10),
  etapp_name text null,
  densitet numeric null, -- kg/m2 (as captured in the form)
  source_type text null check (source_type in ('open','closed')),
  source_row_index int2 null
);

-- RLS / policies intentionally omitted: installers have no accounts, data is internal-only.
-- If you later add auth, you can enable RLS:
-- alter table public.material_quality_samples enable row level security;
-- create policy "material_quality_samples_select_own" on public.material_quality_samples for select using (auth.uid() = user_id);
-- create policy "material_quality_samples_insert_own" on public.material_quality_samples for insert with check (auth.uid() = user_id);

create index if not exists idx_mqs_batch on public.material_quality_samples(batch_number);
create index if not exists idx_mqs_installation_date on public.material_quality_samples(installation_date);
create index if not exists idx_mqs_order_id on public.material_quality_samples(order_id);

-- If the table already existed before adding fluffer_used, run:
 alter table public.material_quality_samples add column if not exists fluffer_used boolean null;
