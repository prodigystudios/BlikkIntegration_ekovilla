-- Add required metadata fields for saved offert calculations

alter table public.offert_calculations
  add column if not exists address text not null default '',
  add column if not exists city text not null default '',
  add column if not exists quote_date date not null default current_date,
  add column if not exists salesperson text not null default '';

-- Optional: basic index for filtering/sorting by quote_date
create index if not exists offert_calculations_user_id_quote_date_idx
  on public.offert_calculations (user_id, quote_date desc);
