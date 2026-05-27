create table if not exists public.crm_goals (
	id uuid primary key default gen_random_uuid(),
	user_id uuid not null references public.profiles(id) on delete cascade,
	period_type text not null check (period_type in ('week')),
	period_start date not null,
	calls_target integer not null default 0 check (calls_target >= 0),
	quotes_target integer not null default 0 check (quotes_target >= 0),
	quote_value_target numeric(12,2) not null default 0 check (quote_value_target >= 0),
	created_by uuid not null references public.profiles(id) on delete cascade,
	updated_by uuid not null references public.profiles(id) on delete cascade,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	unique(user_id, period_type, period_start)
);

create index if not exists crm_goals_period_type_period_start_idx
	on public.crm_goals(period_type, period_start);

create index if not exists crm_goals_user_period_idx
	on public.crm_goals(user_id, period_type, period_start);

alter table public.crm_goals enable row level security;

grant select, insert, update on table public.crm_goals to authenticated;

do $$
begin
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_goals' and policyname = 'crm_goals_select_visible') then
		drop policy "crm_goals_select_visible" on public.crm_goals;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_goals' and policyname = 'crm_goals_insert_admin_only') then
		drop policy "crm_goals_insert_admin_only" on public.crm_goals;
	end if;
	if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'crm_goals' and policyname = 'crm_goals_update_admin_only') then
		drop policy "crm_goals_update_admin_only" on public.crm_goals;
	end if;
end
$$;

create policy "crm_goals_select_visible"
	on public.crm_goals
	for select
	using (
		user_id = auth.uid()
		or exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role = 'admin'
		)
	);

create policy "crm_goals_insert_admin_only"
	on public.crm_goals
	for insert
	to authenticated
	with check (
		exists (
			select 1
			from public.profiles p
			where p.id = auth.uid()
				and p.role = 'admin'
		)
	);

create policy "crm_goals_update_admin_only"
	on public.crm_goals
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

create or replace function public.set_timestamp_crm_goals()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

drop trigger if exists set_timestamp_crm_goals on public.crm_goals;
create trigger set_timestamp_crm_goals
before update on public.crm_goals
for each row execute procedure public.set_timestamp_crm_goals();
