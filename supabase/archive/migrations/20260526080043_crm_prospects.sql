create table if not exists public.crm_prospects (
	id uuid primary key default gen_random_uuid(),
	company_name text not null,
	organization_number text,
	contact_name text,
	phone text,
	email text,
	street_address text,
	postal_code text,
	city text,
	status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'quoted', 'won', 'lost')),
	source text,
	notes text,
	created_by uuid not null references public.profiles(id) on delete cascade,
	assigned_to uuid not null references public.profiles(id) on delete restrict,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists crm_prospects_assigned_status_idx on public.crm_prospects(assigned_to, status);
create index if not exists crm_prospects_created_at_idx on public.crm_prospects(created_at desc);
create index if not exists crm_prospects_company_name_idx on public.crm_prospects(lower(company_name));

alter table public.crm_prospects enable row level security;

grant select, insert, update, delete on table public.crm_prospects to authenticated;

do $$
begin
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_prospects' and policyname = 'crm_prospects_select_visible') then
		drop policy "crm_prospects_select_visible" on public.crm_prospects;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_prospects' and policyname = 'crm_prospects_insert_sales_or_admin') then
		drop policy "crm_prospects_insert_sales_or_admin" on public.crm_prospects;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_prospects' and policyname = 'crm_prospects_update_visible') then
		drop policy "crm_prospects_update_visible" on public.crm_prospects;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_prospects' and policyname = 'crm_prospects_delete_creator_or_admin') then
		drop policy "crm_prospects_delete_creator_or_admin" on public.crm_prospects;
	end if;
end
$$;

create policy "crm_prospects_select_visible"
	on public.crm_prospects
	for select
	using (
		auth.uid() = created_by
		or auth.uid() = assigned_to
		or exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role = 'admin'
		)
	);

create policy "crm_prospects_insert_sales_or_admin"
	on public.crm_prospects
	for insert
	to authenticated
	with check (
		created_by = auth.uid()
		and assigned_to = auth.uid()
		and exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role in ('sales', 'admin')
		)
	);

create policy "crm_prospects_update_visible"
	on public.crm_prospects
	for update
	using (
		auth.uid() = created_by
		or auth.uid() = assigned_to
		or exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role = 'admin'
		)
	)
	with check (
		auth.uid() = created_by
		or auth.uid() = assigned_to
		or exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role = 'admin'
		)
	);

create policy "crm_prospects_delete_creator_or_admin"
	on public.crm_prospects
	for delete
	using (
		auth.uid() = created_by
		or exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role = 'admin'
		)
	);

create or replace function public.set_timestamp_crm_prospects()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

drop trigger if exists set_timestamp_crm_prospects on public.crm_prospects;
create trigger set_timestamp_crm_prospects
before update on public.crm_prospects
for each row execute procedure public.set_timestamp_crm_prospects();
