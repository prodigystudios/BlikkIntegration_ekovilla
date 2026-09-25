-- Ensure new name-based team columns exist (switch from old UUID member columns)
alter table public.planning_trucks
  add column if not exists team_member1_name text,
  add column if not exists team_member2_name text;

-- (Optional) Drop old uuid columns if they still exist (uncomment if desired)
-- alter table public.planning_trucks drop column if exists team_member1 cascade;
-- alter table public.planning_trucks drop column if exists team_member2 cascade;
