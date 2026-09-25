do $$
begin
	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_quotes'
			and policyname = 'crm_quotes_select_visible'
	) then
		drop policy "crm_quotes_select_visible" on public.crm_quotes;
	end if;

	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_quotes'
			and policyname = 'crm_quotes_insert_sales_or_admin'
	) then
		drop policy "crm_quotes_insert_sales_or_admin" on public.crm_quotes;
	end if;

	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_quotes'
			and policyname = 'crm_quotes_insert_admin_manage'
	) then
		drop policy "crm_quotes_insert_admin_manage" on public.crm_quotes;
	end if;

	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_quotes'
			and policyname = 'crm_quotes_update_visible'
	) then
		drop policy "crm_quotes_update_visible" on public.crm_quotes;
	end if;

	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_quotes'
			and policyname = 'crm_quotes_delete_creator_or_admin'
	) then
		drop policy "crm_quotes_delete_creator_or_admin" on public.crm_quotes;
	end if;

	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_quotes'
			and policyname = 'crm_quotes_delete_assigned_or_admin'
	) then
		drop policy "crm_quotes_delete_assigned_or_admin" on public.crm_quotes;
	end if;
end
$$;

create policy "crm_quotes_select_visible"
	on public.crm_quotes
	for select
	using (
		auth.uid() = assigned_to
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
					and prospect.assigned_to = auth.uid()
			)
		)
	);

create policy "crm_quotes_insert_admin_manage"
	on public.crm_quotes
	for insert
	to authenticated
	with check (
		created_by = auth.uid()
		and exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role = 'admin'
		)
	);

create policy "crm_quotes_update_visible"
	on public.crm_quotes
	for update
	using (
		auth.uid() = assigned_to
		or exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role = 'admin'
		)
	)
	with check (
		auth.uid() = assigned_to
		or exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role = 'admin'
		)
	);

create policy "crm_quotes_delete_assigned_or_admin"
	on public.crm_quotes
	for delete
	using (
		auth.uid() = assigned_to
		or exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role = 'admin'
		)
	);