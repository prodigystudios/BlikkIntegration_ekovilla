-- Wave 7 — new CRM-first planning: denormalise the placer's name onto ops_segments.
--
-- Cards show "who put this job on the calendar" (a lightweight stand-in for full presence). The
-- placer's user id is already on created_by, but profiles SELECT RLS is self-only — a planner can't
-- read another planner's profile row — so we snapshot the display name at placement time, exactly
-- like crew member_name (ops_segment_crew) and the audit log's actor_name.
--
-- Nullable: rows placed before this migration simply show no creator badge. No RLS change — the
-- existing schedule.write policy already governs writes to this table.
--
-- DEPLOY ORDER: run AFTER 20260611_ops_planning_foundation.sql. Idempotent.

alter table public.ops_segments add column if not exists created_by_name text;
