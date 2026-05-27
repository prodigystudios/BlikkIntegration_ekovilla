create table if not exists public.crm_ai_prospect_suggestions (
	id uuid primary key default gen_random_uuid(),
	company_name text not null,
	organization_number text,
	contact_name text,
	phone text,
	email text,
	city text,
	website text,
	source text,
	rationale text,
	notes text,
	status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
	created_by uuid not null references public.profiles(id) on delete cascade,
	reviewed_by uuid references public.profiles(id) on delete set null,
	approved_prospect_id uuid references public.crm_prospects(id) on delete set null,
	review_note text,
	reviewed_at timestamptz,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists crm_ai_prospect_suggestions_status_created_at_idx
	on public.crm_ai_prospect_suggestions(status, created_at desc);

create index if not exists crm_ai_prospect_suggestions_company_name_idx
	on public.crm_ai_prospect_suggestions(lower(company_name));

create index if not exists crm_ai_prospect_suggestions_approved_prospect_idx
	on public.crm_ai_prospect_suggestions(approved_prospect_id)
	where approved_prospect_id is not null;

alter table public.crm_ai_prospect_suggestions enable row level security;

grant select, insert, update on table public.crm_ai_prospect_suggestions to authenticated;

do $$
begin
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_ai_prospect_suggestions' and policyname = 'crm_ai_prospect_suggestions_select_visible') then
		drop policy "crm_ai_prospect_suggestions_select_visible" on public.crm_ai_prospect_suggestions;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_ai_prospect_suggestions' and policyname = 'crm_ai_prospect_suggestions_insert_sales_or_admin') then
		drop policy "crm_ai_prospect_suggestions_insert_sales_or_admin" on public.crm_ai_prospect_suggestions;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_ai_prospect_suggestions' and policyname = 'crm_ai_prospect_suggestions_update_sales_or_admin') then
		drop policy "crm_ai_prospect_suggestions_update_sales_or_admin" on public.crm_ai_prospect_suggestions;
	end if;
end
$$;

create policy "crm_ai_prospect_suggestions_select_visible"
	on public.crm_ai_prospect_suggestions
	for select
	using (
		exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role in ('sales', 'admin')
		)
	);

create policy "crm_ai_prospect_suggestions_insert_sales_or_admin"
	on public.crm_ai_prospect_suggestions
	for insert
	to authenticated
	with check (
		created_by = auth.uid()
		and exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role in ('sales', 'admin')
		)
	);

create policy "crm_ai_prospect_suggestions_update_sales_or_admin"
	on public.crm_ai_prospect_suggestions
	for update
	using (
		exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role in ('sales', 'admin')
		)
	)
	with check (
		exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role in ('sales', 'admin')
		)
	);

create or replace function public.set_timestamp_crm_ai_prospect_suggestions()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

drop trigger if exists set_timestamp_crm_ai_prospect_suggestions on public.crm_ai_prospect_suggestions;
create trigger set_timestamp_crm_ai_prospect_suggestions
before update on public.crm_ai_prospect_suggestions
for each row execute procedure public.set_timestamp_crm_ai_prospect_suggestions();
