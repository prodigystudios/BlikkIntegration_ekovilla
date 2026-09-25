-- Offertkalkylator: add status + next meeting date metadata

alter table public.offert_calculations
  add column if not exists status text not null default 'Återkoppling',
  add column if not exists next_meeting_date date;

-- Ensure status is one of allowed values
alter table public.offert_calculations
  drop constraint if exists offert_calculations_status_check;

alter table public.offert_calculations
  add constraint offert_calculations_status_check
  check (status in ('Återkoppling', 'Bekräftad', 'Förlorad'));

create index if not exists offert_calculations_user_id_status_idx
  on public.offert_calculations (user_id, status);

create index if not exists offert_calculations_user_id_next_meeting_date_idx
  on public.offert_calculations (user_id, next_meeting_date);
