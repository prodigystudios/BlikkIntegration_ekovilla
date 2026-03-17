-- Offertkalkylator: autogenererat offertnummer per år (YYYY-#####)

-- Stores offer number parts; formatted in app as `${year}-${seq.toString().padStart(5,'0')}`.
alter table public.offert_calculations
  add column if not exists offert_number_year int,
  add column if not exists offert_number_seq int;

-- Yearly counters (internal). Intentionally no RLS/policies; only touched via trigger function.
create table if not exists public.offert_number_counters (
  year int primary key,
  last_seq int not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function public.assign_offert_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  y int;
  s int;
begin
  -- Allow manual override (imports/backfills).
  if new.offert_number_year is not null and new.offert_number_seq is not null then
    return new;
  end if;

  if new.created_at is null then
    new.created_at = now();
  end if;

  y := extract(year from new.created_at)::int;

  insert into public.offert_number_counters(year, last_seq, updated_at)
  values (y, 1, now())
  on conflict (year) do update
    set last_seq = public.offert_number_counters.last_seq + 1,
        updated_at = now()
  returning last_seq into s;

  new.offert_number_year := y;
  new.offert_number_seq := s;

  return new;
end;
$$;

drop trigger if exists trg_assign_offert_number on public.offert_calculations;
create trigger trg_assign_offert_number
before insert on public.offert_calculations
for each row execute function public.assign_offert_number();

-- Backfill existing rows (deterministic order per year)
with ordered as (
  select
    id,
    extract(year from created_at)::int as y,
    row_number() over (
      partition by extract(year from created_at)::int
      order by created_at asc, id asc
    ) as rn
  from public.offert_calculations
  where offert_number_year is null or offert_number_seq is null
)
update public.offert_calculations oc
set offert_number_year = o.y,
    offert_number_seq = o.rn
from ordered o
where oc.id = o.id;

-- Sync counters to current max per year
insert into public.offert_number_counters(year, last_seq, updated_at)
select
  offert_number_year,
  max(offert_number_seq) as last_seq,
  now() as updated_at
from public.offert_calculations
where offert_number_year is not null and offert_number_seq is not null
group by offert_number_year
on conflict (year) do update
set last_seq = greatest(public.offert_number_counters.last_seq, excluded.last_seq),
    updated_at = now();

alter table public.offert_calculations
  alter column offert_number_year set not null,
  alter column offert_number_seq set not null;

create unique index if not exists offert_calculations_offert_number_uidx
  on public.offert_calculations (offert_number_year, offert_number_seq);

create index if not exists offert_calculations_user_id_offert_number_idx
  on public.offert_calculations (user_id, offert_number_year desc, offert_number_seq desc);
