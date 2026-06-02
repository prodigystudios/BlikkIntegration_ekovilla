-- Skapa crm_opportunities-tabellen
create table if not exists public.crm_opportunities (
	id uuid primary key default gen_random_uuid(),
	prospect_id uuid references public.crm_prospects(id) on delete set null,
	title text not null,
	status text not null default 'qualified' check (status in ('qualified', 'quoted', 'won', 'lost')),
	notes text,
	created_by uuid not null references auth.users(id),
	assigned_to uuid not null references auth.users(id),
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

-- Lägg till opportunity_id på crm_calls (nullable, samtal kan kopplas till antingen prospekt eller affärsmöjlighet)
alter table public.crm_calls
	add column if not exists opportunity_id uuid references public.crm_opportunities(id) on delete set null;

-- Lägg till opportunity_id på crm_quotes
alter table public.crm_quotes
	add column if not exists opportunity_id uuid references public.crm_opportunities(id) on delete set null;

-- Trigger för updated_at
create or replace function public.set_crm_opportunities_updated_at()
returns trigger language plpgsql as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

drop trigger if exists crm_opportunities_set_updated_at on public.crm_opportunities;
create trigger crm_opportunities_set_updated_at
	before update on public.crm_opportunities
	for each row execute function public.set_crm_opportunities_updated_at();

-- Aktivera RLS
alter table public.crm_opportunities enable row level security;

-- RLS-policyer
do $$
begin
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_opportunities' and policyname = 'crm_opportunities_select_visible') then
		drop policy "crm_opportunities_select_visible" on public.crm_opportunities;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_opportunities' and policyname = 'crm_opportunities_insert_sales_or_admin') then
		drop policy "crm_opportunities_insert_sales_or_admin" on public.crm_opportunities;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_opportunities' and policyname = 'crm_opportunities_insert_admin_manage') then
		drop policy "crm_opportunities_insert_admin_manage" on public.crm_opportunities;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_opportunities' and policyname = 'crm_opportunities_update_visible') then
		drop policy "crm_opportunities_update_visible" on public.crm_opportunities;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_opportunities' and policyname = 'crm_opportunities_delete_assigned_or_admin') then
		drop policy "crm_opportunities_delete_assigned_or_admin" on public.crm_opportunities;
	end if;
end
$$;

create policy "crm_opportunities_select_visible"
	on public.crm_opportunities
	for select
	using (
		auth.uid() = assigned_to
		or exists (
			select 1 from public.profiles p
			where p.id = auth.uid() and p.role = 'admin'
		)
	);

create policy "crm_opportunities_insert_sales_or_admin"
	on public.crm_opportunities
	for insert
	to authenticated
	with check (
		created_by = auth.uid()
		and assigned_to = auth.uid()
		and exists (
			select 1 from public.profiles p
			where p.id = auth.uid() and p.role in ('sales', 'admin')
		)
	);

create policy "crm_opportunities_insert_admin_manage"
	on public.crm_opportunities
	for insert
	to authenticated
	with check (
		created_by = auth.uid()
		and exists (
			select 1 from public.profiles p
			where p.id = auth.uid() and p.role = 'admin'
		)
	);

create policy "crm_opportunities_update_visible"
	on public.crm_opportunities
	for update
	using (
		auth.uid() = assigned_to
		or exists (
			select 1 from public.profiles p
			where p.id = auth.uid() and p.role = 'admin'
		)
	)
	with check (
		auth.uid() = assigned_to
		or exists (
			select 1 from public.profiles p
			where p.id = auth.uid() and p.role = 'admin'
		)
	);

create policy "crm_opportunities_delete_assigned_or_admin"
	on public.crm_opportunities
	for delete
	using (
		auth.uid() = assigned_to
		or exists (
			select 1 from public.profiles p
			where p.id = auth.uid() and p.role = 'admin'
		)
	);
