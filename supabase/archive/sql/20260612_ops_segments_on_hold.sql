-- Wave 7 — new CRM-first planning: paused jobs (pausade jobb / on-hold).
--
-- A scheduled placement can be put on hold (customer postponed, material delayed, …). The job keeps
-- its slot on the board but is visually dimmed + badged "Pausad" so it isn't treated as active. This
-- is just a flag on the placement; RLS is already enforced by the existing ops_segments policies
-- (write = planning.schedule.write), so no new policy is needed.
--
-- DEPLOY ORDER: run AFTER 20260611_ops_planning_foundation.sql. Run in the Supabase SQL editor.
-- Idempotent.

alter table public.ops_segments add column if not exists on_hold boolean not null default false;
