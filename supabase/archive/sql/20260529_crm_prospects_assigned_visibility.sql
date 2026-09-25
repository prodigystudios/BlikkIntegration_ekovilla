do $$
begin
	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_prospects'
			and policyname = 'crm_prospects_select_visible'
	) then
		drop policy "crm_prospects_select_visible" on public.crm_prospects;
	end if;

	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_prospects'
			and policyname = 'crm_prospects_insert_sales_or_admin'
	) then
		drop policy "crm_prospects_insert_sales_or_admin" on public.crm_prospects;
	end if;

	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_prospects'
			and policyname = 'crm_prospects_insert_admin_manage'
	) then
		drop policy "crm_prospects_insert_admin_manage" on public.crm_prospects;
	end if;

	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_prospects'
			and policyname = 'crm_prospects_update_visible'
	) then
		drop policy "crm_prospects_update_visible" on public.crm_prospects;
	end if;

	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_prospects'
			and policyname = 'crm_prospects_delete_creator_or_admin'
	) then
		drop policy "crm_prospects_delete_creator_or_admin" on public.crm_prospects;
	end if;

	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_prospects'
			and policyname = 'crm_prospects_delete_assigned_or_admin'
	) then
		drop policy "crm_prospects_delete_assigned_or_admin" on public.crm_prospects;
	end if;
end
$$;

create policy "crm_prospects_select_visible"
	on public.crm_prospects
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

create policy "crm_prospects_insert_admin_manage"
	on public.crm_prospects
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

create policy "crm_prospects_update_visible"
	on public.crm_prospects
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

create policy "crm_prospects_delete_assigned_or_admin"
	on public.crm_prospects
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