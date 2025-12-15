-- Add status_label and status_color to planning_project_meta for persisted status display
BEGIN;

ALTER TABLE planning_project_meta
  ADD COLUMN IF NOT EXISTS status_label text,
  ADD COLUMN IF NOT EXISTS status_color text; -- hex or named color from Blikk API

-- Ensure upsert conflicts target a unique key on project_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' AND indexname = 'planning_project_meta_project_id_key'
  ) THEN
    -- Create a unique constraint (named index) on project_id
    ALTER TABLE planning_project_meta
      ADD CONSTRAINT planning_project_meta_project_id_key UNIQUE (project_id);
  END IF;
END $$;

COMMIT;