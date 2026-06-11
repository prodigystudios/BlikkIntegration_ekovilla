-- Planning (Wave 7, CRM-first rebuild) permission keys — catalog + role seed.
--
-- Net-new keys for the NEW planning/scheduling surface (app/planering, ops_* tables). The
-- old planning (app/plannering) never used the permission model; this is the first time
-- planning joins RBAC. ADDITIVE and idempotent.
--
-- DEPLOY ORDER: run this BEFORE the app code that calls requirePermission('planning.*') and
-- BEFORE 20260611_ops_planning_foundation.sql (whose RLS predicates call has_permission on
-- these keys). getEffectivePermissions() fails closed, so keys must exist first.
--
-- Mirrors lib/auth/permissions.ts PERMISSION_KEYS (the count test guards parity).
-- Run AFTER 20260608_permissions_model.sql. Run in the Supabase SQL editor.

insert into public.permissions (key, description) values
  ('planning.schedule.read',  'Planning: view the schedule/calendar'),
  ('planning.schedule.write', 'Planning: place/move/remove scheduled jobs'),
  ('planning.truck.manage',   'Planning: manage trucks'),
  ('planning.depot.manage',   'Planning: manage depots and deliveries')
on conflict (key) do nothing;

-- Role seed (confirm exact roles as planning rolls out — adjustable later in the admin UI):
--   admin   → full planning access
--   sales   → view + schedule (place/move jobs)
--   konsult → read-only schedule (consistent with their CRM read-only access)
--   member  → none (installers reach their jobs via ownership/dashboard, a later slice)
insert into public.role_permissions (role, permission_key) values
  ('admin','planning.schedule.read'),   ('admin','planning.schedule.write'),
  ('admin','planning.truck.manage'),    ('admin','planning.depot.manage'),
  ('sales','planning.schedule.read'),   ('sales','planning.schedule.write'),
  ('konsult','planning.schedule.read')
on conflict do nothing;
