alter table public.offert_calculations
  add column if not exists internal_note text not null default '',
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_timestamp_offert_calculations()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists offert_calculations_set_timestamp on public.offert_calculations;
create trigger offert_calculations_set_timestamp
before update on public.offert_calculations
for each row execute function public.set_timestamp_offert_calculations();

create index if not exists offert_calculations_user_id_updated_at_idx
  on public.offert_calculations (user_id, updated_at desc);