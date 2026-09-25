-- Add client notification tracking columns to planning_project_meta
-- Safe to run multiple times (IF NOT EXISTS used)
ALTER TABLE public.planning_project_meta
  ADD COLUMN IF NOT EXISTS client_notified boolean,
  ADD COLUMN IF NOT EXISTS client_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_notified_by text;

-- Optional index to query/filter notified projects quickly
CREATE INDEX IF NOT EXISTS idx_planning_project_meta_client_notified
  ON public.planning_project_meta (client_notified);

COMMENT ON COLUMN public.planning_project_meta.client_notified IS 'Whether the customer has been notified (planner mail / phone)';
COMMENT ON COLUMN public.planning_project_meta.client_notified_at IS 'Timestamp when customer notification was marked';
COMMENT ON COLUMN public.planning_project_meta.client_notified_by IS 'Name or identifier of user who marked notification';
