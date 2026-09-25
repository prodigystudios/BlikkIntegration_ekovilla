-- Grupp A: Kontakt-unifiering
-- Lägger till customer_stage, source och notes på crm_customers
-- Migrerar befintliga crm_prospects in i crm_customers

-- 1. Ny kolumn: customer_stage
alter table public.crm_customers
  add column if not exists customer_stage text not null default 'customer'
  check (customer_stage in ('prospect', 'customer', 'fortnox_customer'));

-- 2. Källa och anteckningar (fanns i crm_prospects, saknas i crm_customers)
alter table public.crm_customers
  add column if not exists source text;

alter table public.crm_customers
  add column if not exists notes text;

-- 3. Index för stage-filtrering
create index if not exists crm_customers_stage_idx
  on public.crm_customers (customer_stage);

-- 4. Migrera crm_prospects → crm_customers med customer_stage = 'prospect'
--    ON CONFLICT skyddar mot dubbletter (t.ex. redan konverterade prospekt)
insert into public.crm_customers (
  customer_type,
  customer_stage,
  company_name,
  organization_number,
  visit_address,
  invoice_address,
  source_prospect_id,
  source,
  notes,
  status,
  sync_status,
  assigned_to,
  created_by,
  created_at,
  updated_at
)
select
  'business'::text,
  'prospect'::text,
  p.company_name,
  p.organization_number,
  case
    when p.street_address is not null or p.postal_code is not null or p.city is not null
    then jsonb_build_object('street', p.street_address, 'postal_code', p.postal_code, 'city', p.city)
    else null
  end,
  case
    when p.street_address is not null or p.postal_code is not null or p.city is not null
    then jsonb_build_object('street', p.street_address, 'postal_code', p.postal_code, 'city', p.city)
    else null
  end,
  p.id,
  p.source,
  p.notes,
  case when p.status = 'lost' then 'inactive' else 'active' end,
  'not_synced'::text,
  coalesce(p.assigned_to, p.created_by),
  p.created_by,
  p.created_at,
  p.updated_at
from public.crm_prospects p
where not exists (
  select 1 from public.crm_customers c2 where c2.source_prospect_id = p.id
);

-- 5. Skapa primärcontakter i crm_customer_contacts för migrerade prospekt
insert into public.crm_customer_contacts (customer_id, name, phone, email, is_primary, created_at)
select
  c.id,
  p.contact_name,
  p.phone,
  p.email,
  true,
  p.created_at
from public.crm_prospects p
join public.crm_customers c on c.source_prospect_id = p.id
where p.contact_name is not null
  and not exists (
    select 1 from public.crm_customer_contacts cc where cc.customer_id = c.id
  );

-- 6. Länka befintliga samtal (crm_calls.customer_id) till de migrerade kundposterna
update public.crm_calls cl
set customer_id = c.id
from public.crm_customers c
where c.source_prospect_id = cl.prospect_id
  and cl.customer_id is null
  and cl.prospect_id is not null;

-- 7. Uppdatera customer_stage till 'fortnox_customer' där fortnox_customer_id är satt
update public.crm_customers
set customer_stage = 'fortnox_customer'
where fortnox_customer_id is not null
  and customer_stage = 'customer';
