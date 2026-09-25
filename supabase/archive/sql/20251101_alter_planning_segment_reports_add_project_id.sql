-- Link partial reports to project directly and preserve history when segments are removed/moved
BEGIN;

-- 1) Add project_id (denormalized) for stable project mapping
ALTER TABLE public.planning_segment_reports
  ADD COLUMN IF NOT EXISTS project_id text;

-- Backfill existing rows from current segments
UPDATE public.planning_segment_reports r
SET project_id = s.project_id
FROM public.planning_segments s
WHERE r.segment_id = s.id
  AND r.project_id IS NULL;

-- 2) Relax FK: preserve reports if a segment is deleted (keep history)
-- Drop existing FK constraint (name is system-generated; find and drop dynamically)
DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.constraint_schema = kcu.constraint_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'planning_segment_reports'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'segment_id'
  LIMIT 1;
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.planning_segment_reports DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

-- Make segment_id nullable so we can set it NULL when segment is removed
ALTER TABLE public.planning_segment_reports
  ALTER COLUMN segment_id DROP NOT NULL;

-- Recreate FK with ON DELETE SET NULL
ALTER TABLE public.planning_segment_reports
  ADD CONSTRAINT planning_segment_reports_segment_fk
  FOREIGN KEY (segment_id)
  REFERENCES public.planning_segments(id)
  ON DELETE SET NULL;

-- 3) Helpful indexes
CREATE INDEX IF NOT EXISTS planning_segment_reports_project_idx ON public.planning_segment_reports(project_id);
CREATE INDEX IF NOT EXISTS planning_segment_reports_created_idx ON public.planning_segment_reports(created_at);

COMMIT;
