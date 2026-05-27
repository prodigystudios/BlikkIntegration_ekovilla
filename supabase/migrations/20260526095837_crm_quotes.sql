create table if not exists public.crm_quotes (
	id uuid primary key default gen_random_uuid(),
	prospect_id uuid references public.crm_prospects(id) on delete set null,
	customer_name text,
	project_name text not null,
	description text,
	amount numeric(12, 2) not null check (amount >= 0),
	currency_code text not null default 'SEK',
	status text not null default 'draft' check (status in ('draft', 'sent', 'follow_up', 'won', 'lost')),
	quote_date date not null default current_date,
	follow_up_date date,
	notes text,
	created_by uuid not null references public.profiles(id) on delete cascade,
	assigned_to uuid not null references public.profiles(id) on delete restrict,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	constraint crm_quotes_reference_or_customer_check check (prospect_id is not null or customer_name is not null)
);

create index if not exists crm_quotes_assigned_status_idx on public.crm_quotes(assigned_to, status, follow_up_date);
create index if not exists crm_quotes_prospect_quote_date_idx on public.crm_quotes(prospect_id, quote_date desc);
create index if not exists crm_quotes_created_at_idx on public.crm_quotes(created_at desc);
create index if not exists crm_quotes_project_name_idx on public.crm_quotes(lower(project_name));

alter table public.crm_quotes enable row level security;

grant select, insert, update, delete on table public.crm_quotes to authenticated;

do $$
begin
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_quotes' and policyname = 'crm_quotes_select_visible') then
		drop policy "crm_quotes_select_visible" on public.crm_quotes;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_quotes' and policyname = 'crm_quotes_insert_sales_or_admin') then
		drop policy "crm_quotes_insert_sales_or_admin" on public.crm_quotes;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_quotes' and policyname = 'crm_quotes_update_visible') then
		drop policy "crm_quotes_update_visible" on public.crm_quotes;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_quotes' and policyname = 'crm_quotes_delete_creator_or_admin') then
		drop policy "crm_quotes_delete_creator_or_admin" on public.crm_quotes;
	end if;
end
$$;

create policy "crm_quotes_select_visible"
	on public.crm_quotes
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

create policy "crm_quotes_insert_sales_or_admin"
	on public.crm_quotes
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
		and (
			prospect_id is null
			or exists (
				select 1
				from public.crm_prospects prospect
				where prospect.id = prospect_id
					and (
						prospect.assigned_to = auth.uid()
						or prospect.created_by = auth.uid()
						or exists (
							select 1
							from public.profiles admin_profile
							where admin_profile.id = auth.uid()
								and admin_profile.role = 'admin'
						)
					)
			)
		)
	);

create policy "crm_quotes_update_visible"
	on public.crm_quotes
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

create policy "crm_quotes_delete_creator_or_admin"
	on public.crm_quotes
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

create or replace function public.set_timestamp_crm_quotes()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

drop trigger if exists set_timestamp_crm_quotes on public.crm_quotes;
create trigger set_timestamp_crm_quotes
before update on public.crm_quotes
for each row execute procedure public.set_timestamp_crm_quotes();
