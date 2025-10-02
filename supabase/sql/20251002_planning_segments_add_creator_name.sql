-- Add creator display name snapshot to planning segments
alter table public.planning_segments
  add column if not exists created_by_name text;

-- (Optional) future: enforce created_by = auth.uid() on insert via trigger
-- create or replace function public.planning_segments_set_creator()
-- returns trigger language plpgsql as $$
-- begin
--   if (TG_OP = 'INSERT') then
--     if NEW.created_by is null then NEW.created_by := auth.uid(); end if;
--   end if;
--   return NEW;
-- end; $$;
-- drop trigger if exists planning_segments_set_creator on public.planning_segments;
-- create trigger planning_segments_set_creator before insert on public.planning_segments
-- for each row execute procedure public.planning_segments_set_creator();
