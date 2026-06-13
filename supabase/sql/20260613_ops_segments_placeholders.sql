-- Wave 7 — new CRM-first planning: placeholder cards (booked days before a CRM work order exists).
--
-- Sales reps need to block a truck/day on the calendar before the real order is created, so other
-- planners see "something is booked here". Such a segment has no work order yet — it carries its own
-- title/customer. A later slice will link a placeholder to the real work order once it exists.
--
-- So work_order_id becomes nullable, and a CHECK keeps every row anchored to EITHER a work order OR
-- a placeholder title (never neither). The FK (on delete cascade) stays — a nullable FK is fine.
--
-- DEPLOY ORDER: run AFTER 20260611_ops_planning_foundation.sql. Idempotent.

alter table public.ops_segments alter column work_order_id drop not null;
alter table public.ops_segments add column if not exists placeholder_title    text;
alter table public.ops_segments add column if not exists placeholder_customer text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ops_segments_job_or_placeholder') then
    alter table public.ops_segments
      add constraint ops_segments_job_or_placeholder
      check (work_order_id is not null or placeholder_title is not null);
  end if;
end $$;
