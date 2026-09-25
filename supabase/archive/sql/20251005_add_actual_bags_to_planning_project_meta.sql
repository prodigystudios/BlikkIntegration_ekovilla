-- Adds actual (reported) bag count tracking to planning_project_meta
ALTER TABLE public.planning_project_meta
  ADD COLUMN IF NOT EXISTS actual_bags_used integer,
  ADD COLUMN IF NOT EXISTS actual_bags_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_bags_set_by text;

COMMENT ON COLUMN public.planning_project_meta.actual_bags_used IS 'Reported total number of bags actually used (egenkontroll)';
COMMENT ON COLUMN public.planning_project_meta.actual_bags_set_at IS 'Timestamp when actual bags value was set';
COMMENT ON COLUMN public.planning_project_meta.actual_bags_set_by IS 'User who set the actual bags value';
