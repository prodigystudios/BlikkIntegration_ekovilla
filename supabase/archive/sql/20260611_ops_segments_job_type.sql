-- Wave 7 slice 4 — explicit job type per scheduled segment.
--
-- The planner tags a segment with a job type (Ekovilla / Vitull / Leverans / Utsugning /
-- Snickerier / Övrigt) that drives the card colour. Free text (the app offers a fixed set);
-- when unset the card falls back to the material inferred from the work order's line items.
--
-- Run AFTER 20260611_ops_planning_foundation.sql. Run in the Supabase SQL editor. Idempotent.

alter table public.ops_segments add column if not exists job_type text;
