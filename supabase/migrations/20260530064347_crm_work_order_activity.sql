create table if not exists public.crm_work_order_time_entries (
	id uuid primary key default gen_random_uuid(),
	work_order_id uuid not null references public.crm_work_orders(id) on delete cascade,
	user_id uuid not null references public.profiles(id) on delete restrict,
	work_date date not null default current_date,
	hours numeric(6, 2) not null check (hours > 0 and hours <= 24),
	note text,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);

create index if not exists crm_work_order_time_entries_work_order_idx on public.crm_work_order_time_entries(work_order_id, work_date desc);
create index if not exists crm_work_order_time_entries_user_idx on public.crm_work_order_time_entries(user_id, work_date desc);

create table if not exists public.crm_work_order_comments (
	id uuid primary key default gen_random_uuid(),
	work_order_id uuid not null references public.crm_work_orders(id) on delete cascade,
	created_by uuid not null references public.profiles(id) on delete restrict,
	body text not null,
	created_at timestamptz not null default now()
);

create index if not exists crm_work_order_comments_work_order_idx on public.crm_work_order_comments(work_order_id, created_at desc);

alter table public.crm_work_order_time_entries enable row level security;
alter table public.crm_work_order_comments enable row level security;

grant select, insert, update, delete on table public.crm_work_order_time_entries to authenticated;
grant select, insert, delete on table public.crm_work_order_comments to authenticated;

drop policy if exists crm_work_order_time_entries_select_visible on public.crm_work_order_time_entries;
create policy crm_work_order_time_entries_select_visible
	on public.crm_work_order_time_entries
	for select
	using (
		user_id = auth.uid()
		or exists (
			select 1
			from public.crm_work_orders work_order
			where work_order.id = work_order_id
				and (
					work_order.assigned_to = auth.uid()
					or exists (
						select 1
						from public.profiles p
						where p.id = auth.uid()
							and p.role = 'admin'
					)
				)
		)
	);

drop policy if exists crm_work_order_time_entries_insert_self on public.crm_work_order_time_entries;
create policy crm_work_order_time_entries_insert_self
	on public.crm_work_order_time_entries
	for insert
	to authenticated
	with check (
		user_id = auth.uid()
		and exists (
			select 1
			from public.crm_work_orders work_order
			where work_order.id = work_order_id
				and (
					work_order.assigned_to = auth.uid()
					or exists (
						select 1
						from public.profiles p
						where p.id = auth.uid()
							and p.role = 'admin'
					)
				)
		)
	);

drop policy if exists crm_work_order_time_entries_update_self_or_visible on public.crm_work_order_time_entries;
create policy crm_work_order_time_entries_update_self_or_visible
	on public.crm_work_order_time_entries
	for update
	using (
		user_id = auth.uid()
		or exists (
			select 1
			from public.crm_work_orders work_order
			where work_order.id = work_order_id
				and (
					work_order.assigned_to = auth.uid()
					or exists (
						select 1
						from public.profiles p
						where p.id = auth.uid()
							and p.role = 'admin'
					)
				)
		)
	)
	with check (
		user_id = auth.uid()
		and exists (
			select 1
			from public.crm_work_orders work_order
			where work_order.id = work_order_id
				and (
					work_order.assigned_to = auth.uid()
					or exists (
						select 1
						from public.profiles p
						where p.id = auth.uid()
							and p.role = 'admin'
					)
				)
		)
	);

drop policy if exists crm_work_order_time_entries_delete_self_or_visible on public.crm_work_order_time_entries;
create policy crm_work_order_time_entries_delete_self_or_visible
	on public.crm_work_order_time_entries
	for delete
	using (
		user_id = auth.uid()
		or exists (
			select 1
			from public.crm_work_orders work_order
			where work_order.id = work_order_id
				and (
					work_order.assigned_to = auth.uid()
					or exists (
						select 1
						from public.profiles p
						where p.id = auth.uid()
							and p.role = 'admin'
					)
				)
		)
	);

drop policy if exists crm_work_order_comments_select_visible on public.crm_work_order_comments;
create policy crm_work_order_comments_select_visible
	on public.crm_work_order_comments
	for select
	using (
		created_by = auth.uid()
		or exists (
			select 1
			from public.crm_work_orders work_order
			where work_order.id = work_order_id
				and (
					work_order.assigned_to = auth.uid()
					or exists (
						select 1
						from public.profiles p
						where p.id = auth.uid()
							and p.role = 'admin'
					)
				)
		)
	);

drop policy if exists crm_work_order_comments_insert_self on public.crm_work_order_comments;
create policy crm_work_order_comments_insert_self
	on public.crm_work_order_comments
	for insert
	to authenticated
	with check (
		created_by = auth.uid()
		and exists (
			select 1
			from public.crm_work_orders work_order
			where work_order.id = work_order_id
				and (
					work_order.assigned_to = auth.uid()
					or exists (
						select 1
						from public.profiles p
						where p.id = auth.uid()
							and p.role = 'admin'
					)
				)
		)
	);

drop policy if exists crm_work_order_comments_delete_self_or_visible on public.crm_work_order_comments;
create policy crm_work_order_comments_delete_self_or_visible
	on public.crm_work_order_comments
	for delete
	using (
		created_by = auth.uid()
		or exists (
			select 1
			from public.crm_work_orders work_order
			where work_order.id = work_order_id
				and (
					work_order.assigned_to = auth.uid()
					or exists (
						select 1
						from public.profiles p
						where p.id = auth.uid()
							and p.role = 'admin'
					)
				)
		)
	);

create or replace function public.set_timestamp_crm_work_order_time_entries()
returns trigger
language plpgsql
as $$
begin
	new.updated_at = now();
	return new;
end;
$$;

drop trigger if exists set_timestamp_crm_work_order_time_entries on public.crm_work_order_time_entries;
create trigger set_timestamp_crm_work_order_time_entries
	before update on public.crm_work_order_time_entries
	for each row execute procedure public.set_timestamp_crm_work_order_time_entries();
