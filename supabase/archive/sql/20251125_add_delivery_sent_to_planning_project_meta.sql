-- Track outgoing delivery (utleverans) sent status on project meta
ALTER TABLE public.planning_project_meta
  ADD COLUMN IF NOT EXISTS delivery_sent boolean,
  ADD COLUMN IF NOT EXISTS delivery_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_sent_by text;

CREATE INDEX IF NOT EXISTS idx_planning_project_meta_delivery_sent
  ON public.planning_project_meta (delivery_sent);

COMMENT ON COLUMN public.planning_project_meta.delivery_sent IS 'Whether outgoing delivery (jobType Leverans) has been marked as sent';
COMMENT ON COLUMN public.planning_project_meta.delivery_sent_at IS 'Timestamp when delivery was marked as sent';
COMMENT ON COLUMN public.planning_project_meta.delivery_sent_by IS 'User who marked delivery as sent';
