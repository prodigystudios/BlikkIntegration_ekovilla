do $$
begin
	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_ai_prospect_suggestions'
			and policyname = 'crm_ai_prospect_suggestions_select_visible'
	) then
		drop policy "crm_ai_prospect_suggestions_select_visible" on public.crm_ai_prospect_suggestions;
	end if;

	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_ai_prospect_suggestions'
			and policyname = 'crm_ai_prospect_suggestions_insert_sales_or_admin'
	) then
		drop policy "crm_ai_prospect_suggestions_insert_sales_or_admin" on public.crm_ai_prospect_suggestions;
	end if;

	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_ai_prospect_suggestions'
			and policyname = 'crm_ai_prospect_suggestions_insert_admin_only'
	) then
		drop policy "crm_ai_prospect_suggestions_insert_admin_only" on public.crm_ai_prospect_suggestions;
	end if;

	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_ai_prospect_suggestions'
			and policyname = 'crm_ai_prospect_suggestions_update_sales_or_admin'
	) then
		drop policy "crm_ai_prospect_suggestions_update_sales_or_admin" on public.crm_ai_prospect_suggestions;
	end if;

	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_ai_prospect_suggestions'
			and policyname = 'crm_ai_prospect_suggestions_update_admin_only'
	) then
		drop policy "crm_ai_prospect_suggestions_update_admin_only" on public.crm_ai_prospect_suggestions;
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
				and p.role = 'admin'
		)
	);

create policy "crm_ai_prospect_suggestions_insert_admin_only"
	on public.crm_ai_prospect_suggestions
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

create policy "crm_ai_prospect_suggestions_update_admin_only"
	on public.crm_ai_prospect_suggestions
	for update
	using (
		exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role = 'admin'
		)
	)
	with check (
		exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role = 'admin'
		)
	);
