alter table public.crm_calls
	alter column prospect_id drop not null,
	add column if not exists company_name text,
	add column if not exists organization_number text,
	add column if not exists contact_name text,
	add column if not exists phone text,
	add column if not exists email text,
	add column if not exists city text,
	add column if not exists source text;

alter table public.crm_calls
	drop constraint if exists crm_calls_reference_or_company_check;

alter table public.crm_calls
	add constraint crm_calls_reference_or_company_check check (
		prospect_id is not null
		or company_name is not null
	);

grant select, insert on table public.crm_calls to authenticated;

do $$
begin
	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_calls'
			and policyname = 'crm_calls_select_visible'
	) then
		drop policy "crm_calls_select_visible" on public.crm_calls;
	end if;

	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_calls'
			and policyname = 'crm_calls_insert_visible'
	) then
		drop policy "crm_calls_insert_visible" on public.crm_calls;
	end if;

end
$$;

create policy "crm_calls_select_visible"
	on public.crm_calls
	for select
	using (
		user_id = auth.uid()
		or prospect_id is null
		or exists (
			select 1
			from public.crm_prospects p
			where p.id = prospect_id
				and (p.assigned_to = auth.uid() or p.created_by = auth.uid())
		)
		or exists (
			select 1
			from public.profiles profile
			where profile.id = auth.uid()
				and profile.role = 'admin'
		)
	);

create policy "crm_calls_insert_visible"
	on public.crm_calls
	for insert
	to authenticated
	with check (
		user_id = auth.uid()
		and exists (
			select 1
			from public.profiles profile
			where profile.id = auth.uid()
				and profile.role in ('sales', 'admin')
		)
		and (
			prospect_id is null
			or exists (
				select 1
				from public.crm_prospects p
				where p.id = prospect_id
					and (
						p.assigned_to = auth.uid()
						or p.created_by = auth.uid()
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
