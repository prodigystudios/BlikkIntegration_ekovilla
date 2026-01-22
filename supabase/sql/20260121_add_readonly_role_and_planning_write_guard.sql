-- Add konsult role and restrict planning writes for that role
-- Date: 2026-01-21

BEGIN;

-- 1) Ensure user_role enum has 'konsult' (and rename legacy 'readonly' if present)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    -- If the legacy value exists, rename it.
    IF EXISTS (
      SELECT 1
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname = 'user_role' AND e.enumlabel = 'readonly'
    ) THEN
      BEGIN
        ALTER TYPE public.user_role RENAME VALUE 'readonly' TO 'konsult';
      EXCEPTION
        WHEN undefined_object THEN NULL;
        WHEN duplicate_object THEN NULL;
      END;
    END IF;

    -- Ensure 'konsult' exists (no-op if already present)
    BEGIN
      ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'konsult';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END$$;

-- 2) Helper predicates
CREATE OR REPLACE FUNCTION public.is_konsult_user()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      -- Use text comparison to avoid "unsafe use of new enum value" in the
      -- same transaction that adds/renames the enum value.
      AND p.role::text IN ('konsult', 'readonly')
  );
$$;

-- Back-compat helper (in case older code/policies reference it)
CREATE OR REPLACE FUNCTION public.is_readonly_user()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT public.is_konsult_user();
$$;

-- 3) Planning core tables: keep read for authenticated, deny writes for konsult
-- planning_segments
DROP POLICY IF EXISTS planning_segments_write ON public.planning_segments;
CREATE POLICY planning_segments_write ON public.planning_segments
  FOR ALL
  USING (auth.role() = 'authenticated' AND NOT public.is_konsult_user())
  WITH CHECK (auth.role() = 'authenticated' AND NOT public.is_konsult_user());

-- planning_project_meta
DROP POLICY IF EXISTS planning_project_meta_write ON public.planning_project_meta;
CREATE POLICY planning_project_meta_write ON public.planning_project_meta
  FOR ALL
  USING (auth.role() = 'authenticated' AND NOT public.is_konsult_user())
  WITH CHECK (auth.role() = 'authenticated' AND NOT public.is_konsult_user());

-- planning_segment_reports
DROP POLICY IF EXISTS planning_segment_reports_write ON public.planning_segment_reports;
CREATE POLICY planning_segment_reports_write ON public.planning_segment_reports
  FOR ALL
  USING (auth.role() = 'authenticated' AND NOT public.is_konsult_user())
  WITH CHECK (auth.role() = 'authenticated' AND NOT public.is_konsult_user());

-- 4) Ensure planning_segment_team_members is protected similarly
ALTER TABLE public.planning_segment_team_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS planning_segment_team_members_select ON public.planning_segment_team_members;
DROP POLICY IF EXISTS planning_segment_team_members_write ON public.planning_segment_team_members;
CREATE POLICY planning_segment_team_members_select ON public.planning_segment_team_members
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY planning_segment_team_members_write ON public.planning_segment_team_members
  FOR ALL
  USING (auth.role() = 'authenticated' AND NOT public.is_konsult_user())
  WITH CHECK (auth.role() = 'authenticated' AND NOT public.is_konsult_user());

-- 5) Tighten planning_day_notes (previously open to everyone)
ALTER TABLE public.planning_day_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read notes" ON public.planning_day_notes;
DROP POLICY IF EXISTS "insert notes" ON public.planning_day_notes;
DROP POLICY IF EXISTS "update notes" ON public.planning_day_notes;
DROP POLICY IF EXISTS "delete notes" ON public.planning_day_notes;

CREATE POLICY planning_day_notes_select ON public.planning_day_notes
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY planning_day_notes_insert ON public.planning_day_notes
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND NOT public.is_konsult_user());
CREATE POLICY planning_day_notes_update ON public.planning_day_notes
  FOR UPDATE USING (auth.role() = 'authenticated' AND NOT public.is_konsult_user())
  WITH CHECK (auth.role() = 'authenticated' AND NOT public.is_konsult_user());
CREATE POLICY planning_day_notes_delete ON public.planning_day_notes
  FOR DELETE USING (auth.role() = 'authenticated' AND NOT public.is_konsult_user());

COMMIT;
