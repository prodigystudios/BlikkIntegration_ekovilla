-- Parity assertion for the permission seed (run AFTER 20260608_permissions_model.sql).
--
-- Proves the role seed reproduces today's role behavior EXACTLY: for every permission key,
-- the set of roles that hold it must equal the set of roles the old guard/RLS predicate
-- admitted. This is the safety oracle for Phase 1 — every row must show ok = true, and the
-- two completeness checks at the bottom must return zero rows.
--
-- Oracle (today's behavior):
--   reads          → sales, konsult, admin   (requireCrmUser / SELECT policies w/ konsult)
--   writes + push  → sales, admin            (requireCrmWriter)
--   routingrule.read → sales, admin          (RLS SELECT excludes konsult)
--   admin-managed  → admin                   (requireCrmAdmin / admin-only RLS)

with expected(key, roles) as (
  values
    -- reads: sales + konsult + admin
    ('crm.prospect.read',     array['admin','konsult','sales']),
    ('crm.call.read',         array['admin','konsult','sales']),
    ('crm.customer.read',     array['admin','konsult','sales']),
    ('crm.contact.read',      array['admin','konsult','sales']),
    ('crm.opportunity.read',  array['admin','konsult','sales']),
    ('crm.offer.read',        array['admin','konsult','sales']),
    ('crm.workorder.read',    array['admin','konsult','sales']),
    ('crm.task.read',         array['admin','konsult','sales']),
    ('crm.report.read',       array['admin','konsult','sales']),
    ('crm.coach.read',        array['admin','konsult','sales']),
    ('crm.goal.read',         array['admin','konsult','sales']),
    ('fortnox.read',          array['admin','konsult','sales']),
    ('crm.access',            array['admin','konsult','sales']),
    -- writes / Fortnox actions / meta write / routingrule.read: sales + admin
    ('crm.prospect.write',    array['admin','sales']),
    ('crm.call.write',        array['admin','sales']),
    ('crm.customer.write',    array['admin','sales']),
    ('crm.contact.write',     array['admin','sales']),
    ('crm.opportunity.write', array['admin','sales']),
    ('crm.offer.write',       array['admin','sales']),
    ('crm.workorder.write',   array['admin','sales']),
    ('crm.task.write',        array['admin','sales']),
    ('crm.routingrule.read',  array['admin','sales']),
    ('fortnox.offer.push',    array['admin','sales']),
    ('fortnox.workorder.push',array['admin','sales']),
    ('fortnox.invoice.create',array['admin','sales']),
    ('fortnox.customer.sync', array['admin','sales']),
    ('crm.write',             array['admin','sales']),
    -- admin-managed: admin only
    ('crm.goal.manage',       array['admin']),
    ('crm.routingrule.manage',array['admin']),
    ('crm.aiprospect.read',   array['admin']),
    ('crm.aiprospect.manage', array['admin']),
    ('crm.ringlist.manage',   array['admin']),
    ('crm.article.manage',    array['admin']),
    ('crm.unit.manage',       array['admin']),
    ('crm.admin',             array['admin'])
),
actual as (
  select permission_key as key, array_agg(role::text order by role::text) as roles
  from public.role_permissions
  group by permission_key
)
select
  e.key,
  (select array_agg(r order by r) from unnest(e.roles) r) as expected_roles,
  coalesce(a.roles, array[]::text[])                      as actual_roles,
  (select array_agg(r order by r) from unnest(e.roles) r) = coalesce(a.roles, array[]::text[]) as ok
from expected e
left join actual a on a.key = e.key
order by ok nulls first, e.key;

-- Completeness check 1: every catalog key must appear in the oracle above (else 0 rows).
-- (Edit the oracle if you add a key.)
select 'catalog key missing from oracle' as problem, p.key
from public.permissions p
where p.key not in (
  'crm.prospect.read','crm.call.read','crm.customer.read','crm.contact.read',
  'crm.opportunity.read','crm.offer.read','crm.workorder.read','crm.task.read',
  'crm.report.read','crm.coach.read','crm.goal.read','fortnox.read','crm.access',
  'crm.prospect.write','crm.call.write','crm.customer.write','crm.contact.write',
  'crm.opportunity.write','crm.offer.write','crm.workorder.write','crm.task.write',
  'crm.routingrule.read','fortnox.offer.push','fortnox.workorder.push',
  'fortnox.invoice.create','fortnox.customer.sync','crm.write',
  'crm.goal.manage','crm.routingrule.manage','crm.aiprospect.read','crm.aiprospect.manage',
  'crm.ringlist.manage','crm.article.manage','crm.unit.manage','crm.admin'
);

-- Completeness check 2: every seeded role_permission must reference a real catalog key
-- (FK already guarantees this, but kept for parity with a future free-form seed).
select 'orphan role_permission' as problem, rp.role, rp.permission_key
from public.role_permissions rp
left join public.permissions p on p.key = rp.permission_key
where p.key is null;
