-- Grupp C: Länbaserad leadrouting
-- En routingregel kopplar ett svenskt län till en säljare.
-- Vid import av en ringlista kan admin ange vilket län listan gäller —
-- systemet tilldelar då automatiskt leads till rätt säljare.

create table if not exists public.crm_routing_rules (
  id uuid primary key default gen_random_uuid(),
  county text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  priority int not null default 0,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),

  -- En regel per län
  constraint crm_routing_rules_county_unique unique (county)
);

create index if not exists crm_routing_rules_county_idx on public.crm_routing_rules (county);
create index if not exists crm_routing_rules_user_idx on public.crm_routing_rules (user_id);

-- RLS
alter table public.crm_routing_rules enable row level security;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_routing_rules' and policyname = 'crm_routing_rules_select_crm') then
    drop policy "crm_routing_rules_select_crm" on public.crm_routing_rules;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_routing_rules' and policyname = 'crm_routing_rules_manage_admin') then
    drop policy "crm_routing_rules_manage_admin" on public.crm_routing_rules;
  end if;
end
$$;

-- Alla CRM-användare (sales, admin) kan läsa regler (behövs för import)
create policy "crm_routing_rules_select_crm"
  on public.crm_routing_rules
  for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('sales', 'admin')
    )
  );

-- Bara admin kan skapa och ta bort regler
create policy "crm_routing_rules_manage_admin"
  on public.crm_routing_rules
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
