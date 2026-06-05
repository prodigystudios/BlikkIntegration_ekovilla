-- Add Fortnox sync tracking fields to crm_quotes

alter table public.crm_quotes
  add column if not exists fortnox_offer_number text,
  add column if not exists fortnox_sync_status  text not null default 'not_synced'
    check (fortnox_sync_status in ('not_synced', 'pending', 'synced', 'failed')),
  add column if not exists fortnox_synced_at    timestamptz;

create index if not exists crm_quotes_fortnox_offer_number_idx
  on public.crm_quotes (fortnox_offer_number)
  where fortnox_offer_number is not null;
