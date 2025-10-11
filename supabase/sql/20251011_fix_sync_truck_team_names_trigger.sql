-- Fix sync trigger to be safer and preserve names when profiles are missing or empty
create or replace function public.sync_truck_team_names()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT','UPDATE') then
    -- Only replace names if a non-null, non-empty profile name exists
    if new.team1_id is distinct from coalesce(old.team1_id, '00000000-0000-0000-0000-000000000000'::uuid) then
      select nullif(trim(p.full_name), '') into new.team_member1_name from public.profiles p where p.id = new.team1_id;
      if new.team_member1_name is null then
        -- keep existing snapshot if profile has no name
        new.team_member1_name := coalesce(old.team_member1_name, new.team_member1_name);
      end if;
    end if;
    if new.team2_id is distinct from coalesce(old.team2_id, '00000000-0000-0000-0000-000000000000'::uuid) then
      select nullif(trim(p.full_name), '') into new.team_member2_name from public.profiles p where p.id = new.team2_id;
      if new.team_member2_name is null then
        new.team_member2_name := coalesce(old.team_member2_name, new.team_member2_name);
      end if;
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
