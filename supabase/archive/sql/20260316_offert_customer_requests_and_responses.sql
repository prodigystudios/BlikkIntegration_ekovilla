-- Customer data collection per offer (public token link)

create extension if not exists pgcrypto;

create table if not exists public.offert_customer_requests (
  id uuid primary key default gen_random_uuid(),
  offert_id uuid not null,
  seller_user_id uuid not null,
  seller_email text not null default '',
  token_hash text not null unique,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  submitted_at timestamptz null,
  revoked_at timestamptz null,
  expires_at timestamptz null
);

create index if not exists offert_customer_requests_offert_id_idx
  on public.offert_customer_requests(offert_id);

create index if not exists offert_customer_requests_seller_user_id_idx
  on public.offert_customer_requests(seller_user_id);

create index if not exists offert_customer_requests_status_idx
  on public.offert_customer_requests(status);

create table if not exists public.offert_customer_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.offert_customer_requests(id) on delete cascade,

  person1_name text not null default '',
  person1_personnummer text not null default '',
  person2_name text not null default '',
  person2_personnummer text not null default '',

  delivery_address text not null default '',
  postal_code text not null default '',
  city text not null default '',
  property_designation text not null default '',

  phone text not null default '',
  email text not null default '',

  existing_insulation text not null default '',
  attic_hatch_type text not null default '',
  other_info text not null default '',

  signature_data_url text not null default '',
  signature_signed_at timestamptz not null default now(),

  submitted_at timestamptz not null default now()
);

create unique index if not exists offert_customer_responses_request_id_uidx
  on public.offert_customer_responses(request_id);
