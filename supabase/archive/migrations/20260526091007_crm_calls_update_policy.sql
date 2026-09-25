grant update on table public.crm_calls to authenticated;

do $$
begin
	if exists (
		select 1
		from pg_policies
		where schemaname = 'public'
			and tablename = 'crm_calls'
			and policyname = 'crm_calls_update_visible'
	) then
		drop policy "crm_calls_update_visible" on public.crm_calls;
	end if;
end
$$;

create policy "crm_calls_update_visible"
	on public.crm_calls
	for update
	using (
		user_id = auth.uid()
		or exists (
			select 1
			from public.profiles profile
			where profile.id = auth.uid()
				and profile.role = 'admin'
		)
	)
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
