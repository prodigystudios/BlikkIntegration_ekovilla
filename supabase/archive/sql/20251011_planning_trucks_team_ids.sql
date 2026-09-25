-- Add team member UUID columns to trucks and keep name snapshots in sync
alter table if exists public.planning_trucks
  add column if not exists team1_id uuid references public.profiles(id) on delete set null,
  add column if not exists team2_id uuid references public.profiles(id) on delete set null;

create index if not exists planning_trucks_team1_idx on public.planning_trucks(team1_id);
create index if not exists planning_trucks_team2_idx on public.planning_trucks(team2_id);

-- Best-effort backfill from existing names
update public.planning_trucks t
set team1_id = p.id
from public.profiles p
where t.team1_id is null
  and t.team_member1_name is not null
  and lower(p.full_name) = lower(t.team_member1_name);

update public.planning_trucks t
set team2_id = p.id
from public.profiles p
where t.team2_id is null
  and t.team_member2_name is not null
  and lower(p.full_name) = lower(t.team_member2_name);

-- Trigger to sync team member names when IDs change
create or replace function public.sync_truck_team_names()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('INSERT','UPDATE') then
    if new.team1_id is distinct from coalesce(old.team1_id, '00000000-0000-0000-0000-000000000000'::uuid) then
      select full_name into new.team_member1_name from public.profiles where id = new.team1_id;
    end if;
    if new.team2_id is distinct from coalesce(old.team2_id, '00000000-0000-0000-0000-000000000000'::uuid) then
      select full_name into new.team_member2_name from public.profiles where id = new.team2_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_truck_team_names on public.planning_trucks;
create trigger trg_sync_truck_team_names
before insert or update of team1_id, team2_id
on public.planning_trucks
for each row execute function public.sync_truck_team_names();
