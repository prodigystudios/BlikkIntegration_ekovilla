create table if not exists public.crm_calls (
	id uuid primary key default gen_random_uuid(),
	prospect_id uuid not null references public.crm_prospects(id) on delete cascade,
	user_id uuid not null references public.profiles(id) on delete cascade,
	outcome text not null check (outcome in ('no_answer', 'follow_up', 'positive', 'negative')),
	summary text not null,
	next_step text,
	call_at timestamptz not null default now(),
	created_at timestamptz not null default now()
);

create index if not exists crm_calls_prospect_call_at_idx on public.crm_calls(prospect_id, call_at desc);
create index if not exists crm_calls_user_call_at_idx on public.crm_calls(user_id, call_at desc);

alter table public.crm_calls enable row level security;

grant select, insert on table public.crm_calls to authenticated;

do $$
begin
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_calls' and policyname = 'crm_calls_select_visible') then
		drop policy "crm_calls_select_visible" on public.crm_calls;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_calls' and policyname = 'crm_calls_insert_visible') then
		drop policy "crm_calls_insert_visible" on public.crm_calls;
	end if;
end
$$;

create policy "crm_calls_select_visible"
	on public.crm_calls
	for select
	using (
		user_id = auth.uid()
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
			exists (
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
